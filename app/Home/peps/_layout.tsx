import { Stack } from "expo-router";
import React from "react";

const BG = "#020617";

export default function PepsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: BG },
        animation: "none",
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[countryCode]" />
    </Stack>
  );
}
