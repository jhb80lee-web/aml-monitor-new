// app/_layout.tsx
import React from "react";
import { Stack } from "expo-router";

const APP_BG = "#020617";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: APP_BG },
        animation: "none",
        gestureEnabled: false,
      }}
    />
  );
}
