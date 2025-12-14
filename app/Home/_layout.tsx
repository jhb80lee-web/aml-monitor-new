// app/Home/_layout.tsx
import { Stack } from "expo-router";

export default function HomeLayout() {
  return (
    <Stack>
      {/* 홈 메인 화면 */}
      <Stack.Screen
        name="index"
        options={{ headerShown: false }}
      />

      {/* KoFIU 화면 */}
      <Stack.Screen
        name="kofiu/index"
        options={{ title: "KoFIU 공지" }}
      />

      {/* OFAC 화면 */}
      <Stack.Screen
        name="ofac/index"
        options={{ title: "OFAC 제재 리스트" }}
      />

      {/* UN 화면 */}
      <Stack.Screen
        name="un/index"
        options={{ title: "UN 제재 리스트" }}
      />
    </Stack>
  );
}
