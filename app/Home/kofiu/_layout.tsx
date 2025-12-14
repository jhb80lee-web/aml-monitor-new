// app/Home/kofiu/_layout.tsx
import { Stack } from "expo-router";
import React from "react";
import { StyleSheet } from "react-native";

// 헤더는 어차피 숨길 거라 색은 거의 영향 없음
const BG = "#020617";

export default function KofiuLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false, // 👈 모든 KoFIU 화면에서 상단 헤더 숨기기
        contentStyle: { backgroundColor: BG },
      }}
    >
      {/* /Home/kofiu/index.tsx */}
      <Stack.Screen name="index" />

      {/* /Home/kofiu/vasp.tsx */}
      <Stack.Screen name="vasp" />

      {/* /Home/kofiu/restricted.tsx */}
      <Stack.Screen name="restricted" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  // 필요하면 나중에 확장
});
