import { useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  Chip,
  colors,
  Cover,
  Empty,
  ErrorBanner,
  Screen,
  styles,
} from "../../components/ui";
import { coverImage } from "../../lib/api";
import { useLink } from "../../lib/link-context";
import { openGame } from "../../lib/navigation";

interface LibraryRow {
  key: string;
  shop: string;
  objectId: string;
  title: string;
  minutes: number;
  installedOn: string[];
  onDevices: string[];
}

const formatPlaytime = (minutes: number) => {
  if (minutes <= 0) return "Not played";
  if (minutes < 60) return `${minutes} min played`;
  return `${Math.round(minutes / 6) / 10} h played`;
};

export default function LibraryScreen() {
  const { devices, loading, refresh, error } = useLink();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const byGame = new Map<string, LibraryRow>();
    for (const device of devices) {
      if (deviceId && device.id !== deviceId) continue;
      for (const game of device.library) {
        const key = `${game.shop}:${game.objectId}`;
        const row = byGame.get(key) ?? {
          key,
          shop: game.shop,
          objectId: game.objectId,
          title: game.title,
          minutes: 0,
          installedOn: [],
          onDevices: [],
        };
        row.minutes = Math.max(row.minutes, game.minutes ?? 0);
        row.onDevices.push(device.name);
        if (game.installed) row.installedOn.push(device.name);
        byGame.set(key, row);
      }
    }
    const text = filter.trim().toLowerCase();
    return [...byGame.values()]
      .filter((row) => !text || row.title.toLowerCase().includes(text))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [devices, deviceId, filter]);

  return (
    <Screen>
      <View style={{ padding: 16, paddingBottom: 8, gap: 12 }}>
        <TextInput
          style={styles.input}
          placeholder="Filter your library"
          placeholderTextColor={colors.muted}
          value={filter}
          onChangeText={setFilter}
          autoCorrect={false}
          accessibilityLabel="Filter your library"
        />
        {devices.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Chip
                label="All computers"
                selected={deviceId === null}
                onPress={() => setDeviceId(null)}
              />
              {devices.map((device) => (
                <Chip
                  key={device.id}
                  label={device.name}
                  selected={deviceId === device.id}
                  onPress={() => setDeviceId(device.id)}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </View>
      <ErrorBanner message={error} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          loading ? undefined : (
            <Empty
              title={devices.length === 0 ? "No computers yet" : "No games"}
              detail={
                devices.length === 0
                  ? "Open Nacho Launcher on a computer signed in to the same Google account. It shows up here within a couple of minutes."
                  : undefined
              }
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openGame(item)}
            style={{ flexDirection: "row", gap: 12, alignItems: "center" }}
            accessibilityRole="button"
            accessibilityLabel={item.title}
          >
            <Cover uri={coverImage(item)} width={52} height={78} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.small}>{formatPlaytime(item.minutes)}</Text>
              <Text
                style={[
                  styles.small,
                  item.installedOn.length > 0 && { color: colors.success },
                ]}
                numberOfLines={1}
              >
                {item.installedOn.length > 0
                  ? `Installed on ${item.installedOn.join(", ")}`
                  : `In library on ${item.onDevices.join(", ")}`}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}
