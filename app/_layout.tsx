// app/_layout.tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";

const BG = "#020617";
const HEADER_BG = "#020617";
const HEADER_TEXT = "#F9FAFB";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: HEADER_BG },
          headerTintColor: HEADER_TEXT,
          headerTitleStyle: { fontSize: 16, fontWeight: "600" },
          contentStyle: { backgroundColor: BG },
        }}
      >
        {/* ✅ 홈: 헤더 보이게 */}
        <Stack.Screen
          name="Home/index"
          options={{
            title: "AML Monitor 홈",
            headerShown: true,
          }}
        />

        {/* ✅ KoFIU 그룹: 헤더 안 보이게 */}
        <Stack.Screen
          name="Home/kofiu"
          options={{
            headerShown: false,
          }}
        />

        {/* ✅ OFAC 그룹: 헤더 안 보이게 */}
        <Stack.Screen
          name="Home/ofac"
          options={{
            headerShown: false,
          }}
        />

        {/* ✅ UN 그룹: 헤더 안 보이게 */}
        <Stack.Screen
          name="Home/un"
          options={{
            headerShown: false,
          }}
        />
      </Stack>
    </>
  );
}
