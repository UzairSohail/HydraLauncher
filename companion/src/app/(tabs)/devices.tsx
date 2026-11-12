import { router } from "expo-router";
import { useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, View } from "react-native";

import {
  Button,
  colors,
  Empty,
  ErrorBanner,
  formatAgo,
  formatBytes,
  Screen,
  styles,
} from "../../components/ui";
import { forgetDevice } from "../../lib/link";
import { useLink } from "../../lib/link-context";

const PLATFORMS: Record<string, string> = {
  win32: "Windows",
  linux: "Linux",
  darwin: "macOS",
};

export default function DevicesScreen() {
  const { account, devices, loading, refresh, error, signOut } = useLink();
  const [actionError, setActionError] = useState<string | null>(null);

  const forget = (id: string, name: string) =>
    Alert.alert(
      `Forget ${name}?`,
      "Use this for a computer you no longer use. If Nacho Launcher opens on it again it comes back.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: async () => {
            try {
              await forgetDevice(
                id,
                devices.map((device) => device.id)
              );
              await refresh();
            } catch (cause) {
              setActionError(cause instanceof Error ? cause.message : String(cause));
            }
          },
        },
      ]
    );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={colors.accent}
          />
        }
      >
        <ErrorBanner message={actionError ?? error} />
        {devices.length === 0 && !loading && (
          <Empty
            title="No computers yet"
            detail="Open Nacho Launcher on a computer signed in to the same Google account, and check Settings > Integrations > Nacho Companion there."
          />
        )}
        {devices.map((device) => (
          <View key={device.id} style={styles.card}>
            <Text style={styles.title}>{device.name}</Text>
            <Text style={styles.small}>
              {PLATFORMS[device.platform] ?? device.platform} · Nacho Launcher{" "}
              {device.appVersion} · seen {formatAgo(device.lastSeen)}
            </Text>
            <Text style={styles.body}>
              {formatBytes(device.freeBytes)} free in {device.downloadPath}
            </Text>
            <Text style={styles.small}>
              {device.library.length} games ·{" "}
              {device.library.filter((game) => game.installed).length} installed
            </Text>
            {!device.acceptsRequests && (
              <Text style={[styles.small, { color: colors.danger }]}>
                Downloads from the phone are turned off on this computer.
              </Text>
            )}
            <Button
              title="Forget"
              kind="secondary"
              onPress={() => forget(device.id, device.name)}
              style={{ marginTop: 6, minHeight: 40 }}
            />
          </View>
        ))}

        <View style={[styles.card, { marginTop: 8 }]}>
          <Text style={styles.title}>Download sources</Text>
          <Text style={styles.small}>
            Shared by all your computers through settings sync.
          </Text>
          <Button
            title="Manage sources"
            kind="secondary"
            onPress={() => router.push("/sources")}
            style={{ marginTop: 6 }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Google account</Text>
          <Text style={styles.small}>{account?.email}</Text>
          <Button
            title="Sign out"
            kind="secondary"
            onPress={() => void signOut()}
            style={{ marginTop: 6 }}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
