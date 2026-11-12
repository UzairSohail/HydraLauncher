import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router/js-tabs";
import type { ComponentProps } from "react";

import { colors } from "../../components/ui";
import { useLink } from "../../lib/link-context";
import { isFinished, requestStatus } from "../../lib/request-status";

type IconName = ComponentProps<typeof Ionicons>["name"];

const icon =
  (name: IconName) =>
  ({ color, size }: { color: unknown; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );

export default function TabsLayout() {
  const { companion, devices } = useLink();
  const active = companion.requests.filter(
    (request) => !isFinished(requestStatus(request, devices))
  ).length;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Catalogue", tabBarIcon: icon("search") }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: "Library", tabBarIcon: icon("albums") }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: "Downloads",
          tabBarIcon: icon("cloud-download"),
          tabBarBadge: active > 0 ? active : undefined,
        }}
      />
      <Tabs.Screen
        name="devices"
        options={{ title: "Computers", tabBarIcon: icon("desktop") }}
      />
    </Tabs>
  );
}
