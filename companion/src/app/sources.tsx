import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";

import {
  Button,
  colors,
  Empty,
  ErrorBanner,
  Screen,
  styles,
} from "../components/ui";
import { registerDownloadSource } from "../lib/api";
import { useLink } from "../lib/link-context";
import {
  addSource,
  loadSources,
  removeSource,
  type SyncedSource,
} from "../lib/sources";

export default function SourcesScreen() {
  const { rememberSourceId } = useLink();
  const [sources, setSources] = useState<SyncedSource[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSources(await loadSources());
      setError(null);
    } catch (cause) {
      setSources([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      setError("Enter the source's full link, starting with https://");
      return;
    }
    if (sources?.some((source) => source.url === trimmed)) {
      setError("That source is already in the list.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // The catalogue checks the link and gives back its name and ID.
      const registered = await registerDownloadSource(trimmed);
      await addSource({ name: registered.name || trimmed, url: trimmed });
      if (registered.id) await rememberSourceId(registered.id);
      setUrl("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = (source: SyncedSource) =>
    Alert.alert(
      `Remove ${source.name}?`,
      "It's removed from every computer the next time each one syncs its settings.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeSource(source.url);
              await load();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          },
        },
      ]
    );

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={styles.small}>
          Changes reach each computer the next time Nacho Launcher syncs its settings
          there, which happens when it opens and every 15 minutes.
        </Text>
        <View style={{ gap: 8 }}>
          <TextInput
            style={styles.input}
            placeholder="https://example.com/source.json"
            placeholderTextColor={colors.muted}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Source link"
          />
          <Button title="Add source" onPress={add} loading={busy} />
        </View>
        <ErrorBanner message={error} />
        {sources !== null && sources.length === 0 && !error && (
          <Empty title="No sources yet" />
        )}
        {sources?.map((source) => (
          <View key={source.url} style={styles.card}>
            <Text style={styles.title}>{source.name}</Text>
            <Text style={styles.small} numberOfLines={1}>
              {source.url}
            </Text>
            <Button
              title="Remove"
              kind="danger"
              onPress={() => remove(source)}
              style={{ marginTop: 6, minHeight: 40 }}
            />
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
