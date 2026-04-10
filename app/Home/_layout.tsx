// aml_app/aml-monitor-new/app/Home/_layout.tsx
import React, { useEffect } from "react";
import { View, StyleSheet, Platform } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";

import { initNotifications } from "../notificationsConfig";
import InAppUpdateBanner from "../../components/InAppUpdateBanner";

const APP_BG = "#020617";

// ✅ ChatGPT iOS 알림 배너 정도 높이
const BANNER_HEIGHT = 86; // 배너 박스(약 68~72) + 여백 포함 느낌
const TOP_GAP = -8; // ✅ 배너를 더 위로 (기존 8)

export default function HomeLayout() {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    void initNotifications();
  }, []);

  // ✅ "배너가 차지하는 실제 터치 영역"을 상단으로만 제한
  //    (이 영역 밖은 오버레이가 없으니 터치가 절대 안 막힘)
  const overlayH = insets.top + TOP_GAP + BANNER_HEIGHT;

  const BannerLayer = (
    <View
      style={[
        styles.overlay,
        { height: overlayH, paddingTop: insets.top + TOP_GAP },
      ]}
    >
      {/* 배너만 터치/스와이프 먹고, 나머지는 overlay 영역 밖이라 영향 없음 */}
      <InAppUpdateBanner />
    </View>
  );

  return (
    <View style={styles.root}>
      {/* ✅ 헤더/화면 레이아웃은 원복: 절대 건드리지 않음 */}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: APP_BG },
          animation: "none",
          gestureEnabled: true,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="watchlist/index" />
        <Stack.Screen name="kofiu" />

        <Stack.Screen name="ofac/index" />
        <Stack.Screen name="ofac/history" />

        <Stack.Screen name="un/index" />
        <Stack.Screen name="un/history" />

        <Stack.Screen name="peps" />

        <Stack.Screen name="settings/index" />
      </Stack>

      {/* ✅ 배너는 무조건 최상단.
          iOS: FullWindowOverlay로 네이티브 헤더/스크린 위에 올림
          Android: RN absolute로도 충분히 최상단 */}
      {Platform.OS === "ios" ? (
        <FullWindowOverlay>{BannerLayer}</FullWindowOverlay>
      ) : (
        BannerLayer
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: APP_BG },

  // ✅ 화면 전체를 덮지 말고 "상단 배너 영역만" 덮는다 (터치 문제 방지)
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,

    zIndex: 999999,
    elevation: 999999,

    // 배경은 투명. (배너 자체만 보임)
    backgroundColor: "transparent",
  },
});
