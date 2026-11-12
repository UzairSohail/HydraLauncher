import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
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
import {
  coverImage,
  getCategory,
  searchCatalogue,
  type CatalogueCategory,
  type CatalogueGame,
} from "../../lib/api";
import { useLink } from "../../lib/link-context";
import { openGame } from "../../lib/navigation";

const CATEGORIES: { id: CatalogueCategory; label: string }[] = [
  { id: "hot", label: "Popular" },
  { id: "weekly", label: "This week" },
  { id: "achievements", label: "Achievements" },
];

export default function CatalogueScreen() {
  const { sourceIds } = useLink();
  const { width } = useWindowDimensions();
  const [category, setCategory] = useState<CatalogueCategory>("hot");
  const [search, setSearch] = useState("");
  const [games, setGames] = useState<CatalogueGame[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const columns = width > 600 ? 5 : 3;
  const cardWidth = (width - 16 * 2 - 10 * (columns - 1)) / columns;
  const query = search.trim();

  const load = useCallback(
    async (skip: number) => {
      const requestId = ++requestRef.current;
      setLoading(true);
      try {
        if (query) {
          const result = await searchCatalogue(query, skip, sourceIds);
          if (requestId !== requestRef.current) return;
          setGames((previous) =>
            skip === 0 ? result.edges : [...previous, ...result.edges]
          );
          setCount(result.count);
        } else {
          const result = await getCategory(category, sourceIds);
          if (requestId !== requestRef.current) return;
          setGames(result);
          setCount(result.length);
        }
        setError(null);
      } catch (cause) {
        if (requestId !== requestRef.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (requestId === requestRef.current) setLoading(false);
      }
    },
    [query, category, sourceIds]
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(0), query ? 400 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <Screen>
      <View style={{ padding: 16, paddingBottom: 8, gap: 12 }}>
        <TextInput
          style={styles.input}
          placeholder="Search games"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search games"
        />
        {!query && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {CATEGORIES.map((item) => (
                <Chip
                  key={item.id}
                  label={item.label}
                  selected={category === item.id}
                  onPress={() => setCategory(item.id)}
                />
              ))}
            </View>
          </ScrollView>
        )}
      </View>
      <ErrorBanner message={error} />
      <FlatList
        key={columns}
        data={games}
        numColumns={columns}
        keyExtractor={(game) => `${game.shop}:${game.objectId}`}
        contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 14 }}
        columnWrapperStyle={{ gap: 10 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (query && !loading && games.length < count) void load(games.length);
        }}
        ListEmptyComponent={
          loading ? undefined : (
            <Empty
              title={query ? "No games found" : "Nothing here yet"}
              detail={
                sourceIds.length === 0
                  ? "Open Nacho on a computer once so the phone knows your download sources."
                  : undefined
              }
            />
          )
        }
        ListFooterComponent={
          loading ? <ActivityIndicator color={colors.accent} style={{ margin: 16 }} /> : undefined
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openGame(item)}
            style={{ width: cardWidth, gap: 6 }}
            accessibilityRole="button"
            accessibilityLabel={item.title}
          >
            <Cover uri={coverImage(item)} width={cardWidth} height={cardWidth * 1.5} />
            <Text numberOfLines={2} style={{ color: colors.text, fontSize: 13 }}>
              {item.title}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}
