import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  Button,
  Chip,
  colors,
  Cover,
  Empty,
  ErrorBanner,
  formatBytes,
  Screen,
  styles,
} from "../../../components/ui";
import {
  coverImage,
  getAssets,
  getDownloadOptions,
  type CatalogueGame,
  type Repack,
} from "../../../lib/api";
import { ANY_DEVICE } from "../../../../../src/shared/companion";
import { queueDownload } from "../../../lib/link";
import { useLink } from "../../../lib/link-context";

const formatDate = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
};

export default function GameScreen() {
  const params = useLocalSearchParams<{
    shop: string;
    objectId: string;
    title?: string;
  }>();
  const shop = String(params.shop);
  const objectId = String(params.objectId);
  const { devices, sourceIds, setCompanion } = useLink();
  const { width } = useWindowDimensions();

  const [assets, setAssets] = useState<CatalogueGame | null>(null);
  const [repacks, setRepacks] = useState<Repack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState<string | null>(null);

  const targets = useMemo(
    () => devices.filter((device) => device.acceptsRequests),
    [devices]
  );
  const [target, setTarget] = useState<string>(ANY_DEVICE);
  useEffect(() => {
    // Default to the computer seen most recently.
    if (target === ANY_DEVICE && targets.length > 0) setTarget(targets[0].id);
    // Only when the list first arrives.
  }, [targets.length]);

  const title = assets?.title || params.title || "Game";

  useEffect(() => {
    let cancelled = false;
    getAssets(shop, objectId)
      .then((result) => !cancelled && setAssets(result))
      .catch(() => undefined);
    getDownloadOptions(shop, objectId, sourceIds)
      .then((result) => {
        if (cancelled) return;
        setRepacks(result.filter((repack) => repack.uris?.length > 0));
      })
      .catch((cause) => {
        if (cancelled) return;
        setRepacks([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [shop, objectId, sourceIds]);

  const onDevices = devices.flatMap((device) => {
    const game = device.library.find(
      (entry) => entry.shop === shop && entry.objectId === objectId
    );
    return game ? [{ name: device.name, installed: Boolean(game.installed) }] : [];
  });

  const targetName =
    target === ANY_DEVICE
      ? "the first computer to open Nacho"
      : targets.find((device) => device.id === target)?.name ?? "this computer";

  const queue = (repack: Repack) => {
    Alert.alert(
      "Queue this download?",
      `${repack.title}\n\nIt starts on ${targetName} the next time Nacho is open there.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Queue",
          onPress: async () => {
            setQueueing(repack.id);
            try {
              const next = await queueDownload(
                {
                  target,
                  shop,
                  objectId,
                  title,
                  repack: {
                    id: repack.id,
                    title: repack.title,
                    fileSize: repack.fileSize,
                    uris: repack.uris,
                    uriGroups: repack.uriGroups,
                    unavailableUris: repack.unavailableUris,
                    uploadDate: repack.uploadDate,
                    downloadSourceId: repack.downloadSourceId,
                    downloadSourceName: repack.downloadSourceName,
                    createdAt: repack.createdAt,
                  },
                },
                devices.map((device) => device.id)
              );
              setCompanion(next);
              router.navigate("/downloads");
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              setQueueing(null);
            }
          },
        },
      ]
    );
  };

  const coverWidth = Math.min(140, width * 0.32);

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <Cover
            uri={coverImage({ shop, objectId, ...assets })}
            width={coverWidth}
            height={coverWidth * 1.5}
          />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontWeight: "700" }}>
              {title}
            </Text>
            {onDevices.length === 0 ? (
              <Text style={styles.small}>Not in your library yet</Text>
            ) : (
              onDevices.map((entry) => (
                <Text
                  key={entry.name}
                  style={[styles.small, entry.installed && { color: colors.success }]}
                >
                  {entry.installed ? "Installed" : "In library"} on {entry.name}
                </Text>
              ))
            )}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Download on</Text>
          {targets.length === 0 ? (
            <Text style={styles.small}>
              No computer is taking downloads from the phone yet. Open Nacho on
              one signed in to the same Google account.
            </Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {targets.map((device) => (
                <Chip
                  key={device.id}
                  label={`${device.name} · ${formatBytes(device.freeBytes)} free`}
                  selected={target === device.id}
                  onPress={() => setTarget(device.id)}
                />
              ))}
              {targets.length > 1 && (
                <Chip
                  label="First to open Nacho"
                  selected={target === ANY_DEVICE}
                  onPress={() => setTarget(ANY_DEVICE)}
                />
              )}
            </View>
          )}
        </View>

        <ErrorBanner message={error} />

        <View style={{ gap: 10 }}>
          <Text style={styles.title}>Download options</Text>
          {repacks === null ? (
            <ActivityIndicator color={colors.accent} />
          ) : repacks.length === 0 ? (
            <Empty
              title="No download options"
              detail="None of your download sources list this game."
            />
          ) : (
            repacks.map((repack) => (
              <View key={repack.id} style={styles.card}>
                <Text style={styles.body}>{repack.title}</Text>
                <Text style={styles.small}>
                  {[
                    repack.downloadSourceName,
                    repack.fileSize,
                    formatDate(repack.uploadDate),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
                <Button
                  title="Queue download"
                  disabled={targets.length === 0}
                  loading={queueing === repack.id}
                  onPress={() => queue(repack)}
                  style={{ marginTop: 6, minHeight: 42 }}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
