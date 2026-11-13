import { useState } from "react";
import { Alert, FlatList, RefreshControl, Text, View } from "react-native";

import {
  Button,
  colors,
  Empty,
  ErrorBanner,
  Screen,
  styles,
} from "../../components/ui";
import {
  ANY_DEVICE,
  isRemovalRequest,
} from "../../../../src/shared/companion";
import { removeRequests } from "../../lib/link";
import { useLink } from "../../lib/link-context";
import {
  describeState,
  isFinished,
  requestStatus,
} from "../../lib/request-status";

export default function DownloadsScreen() {
  const { companion, devices, loading, refresh, error, setCompanion } = useLink();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = [...companion.requests]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((request) => {
      const view = requestStatus(request, devices);
      const target =
        request.target === ANY_DEVICE
          ? view.device?.name ?? "the first computer"
          : devices.find((device) => device.id === request.target)?.name ??
            "a computer that's gone";
      return { request, view, target };
    });
  const finished = rows.filter((row) => isFinished(row.view));

  const remove = async (ids: string[]) => {
    setBusy(true);
    setActionError(null);
    try {
      setCompanion(
        await removeRequests(
          ids,
          devices.map((device) => device.id)
        )
      );
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = (id: string, started: boolean) => {
    if (!started) {
      void remove([id]);
      return;
    }
    Alert.alert(
      "Remove from this list?",
      "This only removes it from your phone. A download that already started keeps going on the computer.",
      [
        { text: "Keep", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void remove([id]) },
      ]
    );
  };

  return (
    <Screen>
      <ErrorBanner message={actionError ?? error} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.request.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          finished.length > 0 ? (
            <Button
              title={`Clear ${finished.length} finished`}
              kind="secondary"
              loading={busy}
              onPress={() => void remove(finished.map((row) => row.request.id))}
              style={{ marginBottom: 6 }}
            />
          ) : undefined
        }
        ListEmptyComponent={
          <Empty
            title="Nothing queued"
            detail="Pick a game in the catalogue and choose which computer should download it."
          />
        }
        renderItem={({ item: { request, view, target } }) => {
          const finishedRow = isFinished(view);
          const progress =
            view.state === "downloading" || view.state === "queued"
              ? Math.round((view.progress ?? 0) * 100)
              : null;
          return (
            <View style={styles.card}>
              <Text style={styles.title} numberOfLines={2}>
                {request.title}
              </Text>
              <Text style={styles.small} numberOfLines={1}>
                {isRemovalRequest(request)
                  ? request.action === "uninstall"
                    ? "Uninstall · cloud saves are kept"
                    : "Remove from library · cloud saves are kept"
                  : `${request.repack.downloadSourceName} · ${request.repack.title}`}
              </Text>
              <Text
                style={[
                  styles.body,
                  view.state === "failed" && { color: colors.danger },
                  view.state === "done" && { color: colors.success },
                ]}
              >
                {describeState(view, target, request)}
                {progress !== null && progress > 0 ? ` · ${progress}%` : ""}
              </Text>
              {progress !== null && (
                <View
                  style={{
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: colors.surfaceRaised,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      width: `${progress}%`,
                      height: 4,
                      backgroundColor: colors.accent,
                    }}
                  />
                </View>
              )}
              <Button
                title={finishedRow ? "Remove" : "Cancel request"}
                kind={finishedRow ? "secondary" : "danger"}
                disabled={busy}
                onPress={() =>
                  confirmRemove(
                    request.id,
                    !finishedRow &&
                      view.state !== "waiting" &&
                      !isRemovalRequest(request)
                  )
                }
                style={{ marginTop: 6, minHeight: 40 }}
              />
            </View>
          );
        }}
      />
    </Screen>
  );
}
