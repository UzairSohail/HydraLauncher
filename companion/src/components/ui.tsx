import { Image } from "expo-image";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export const colors = {
  background: "#0d0d0f",
  surface: "#17171b",
  surfaceRaised: "#202026",
  border: "#2c2c33",
  text: "#f1f1f3",
  muted: "#9a9aa3",
  accent: "#f5a524",
  accentText: "#1a1205",
  success: "#3ecf8e",
  danger: "#ef5f5f",
};

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isPrimary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.accentText : colors.text} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            isPrimary && { color: colors.accentText },
            kind === "danger" && { color: colors.danger },
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Cover({
  uri,
  width,
  height,
}: {
  uri: string | null | undefined;
  width: number;
  height: number;
}) {
  return (
    <View style={[styles.cover, { width, height }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width, height }}
          contentFit="cover"
          transition={150}
        />
      ) : null}
    </View>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.muted}>{detail}</Text> : null}
    </View>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || bytes === undefined) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

export const formatAgo = (time: number) => {
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
};

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonText: { color: colors.text, fontWeight: "600", fontSize: 15 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextSelected: { color: colors.accentText, fontWeight: "600" },
  cover: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.surfaceRaised,
  },
  empty: { padding: 32, alignItems: "center", gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
  muted: { color: colors.muted, fontSize: 14, textAlign: "center" },
  errorBanner: {
    margin: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#3a1717",
  },
  errorText: { color: "#ffd2d2", fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: "600" },
  body: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 13 },
  input: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: 14,
    fontSize: 15,
  },
});
