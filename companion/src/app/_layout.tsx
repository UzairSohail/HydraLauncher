import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Text, View } from "react-native";

import { Button, colors, ErrorBanner, styles } from "../components/ui";
import { LinkProvider, useLink } from "../lib/link-context";

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    primary: colors.accent,
    text: colors.text,
    border: colors.border,
  },
};

function SignInGate() {
  const { account, restoring, signIn, error } = useLink();

  if (restoring) {
    return (
      <View style={[styles.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!account) {
    return (
      <View style={[styles.screen, { justifyContent: "center", padding: 24, gap: 16 }]}>
        <Text style={{ color: colors.text, fontSize: 28, fontWeight: "700" }}>
          Nacho
        </Text>
        <Text style={styles.body}>
          Sign in with the same Google account your launcher uses for cloud
          saves. Your phone and your computers talk through that account's
          Google Drive, so there's nothing else to set up.
        </Text>
        <Button title="Sign in with Google" onPress={signIn} />
        <ErrorBanner message={error} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="game/[shop]/[objectId]" options={{ title: "" }} />
      <Stack.Screen name="sources" options={{ title: "Download sources" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider value={theme}>
      <LinkProvider>
        <StatusBar style="light" />
        <SignInGate />
      </LinkProvider>
    </ThemeProvider>
  );
}
