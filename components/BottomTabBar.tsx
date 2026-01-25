import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";

type Props = {
  /** watchlist(검색) 탭이 "이미 활성"일 때 눌렀을 때 실행할 동작 (예: resetToIdle) */
  onPressSearchWhenActive?: () => void;
};

type Tab = {
  key: "watchlist" | "kofiu" | "ofac" | "un" | "settings";
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
  isActive: (pathname: string) => boolean;
};

const TABS: Tab[] = [
  {
    key: "watchlist",
    label: "검색",
    icon: "search",
    href: "/Home/watchlist",
    isActive: (p) => p.startsWith("/Home/watchlist"),
  },
  {
    key: "kofiu",
    label: "KoFIU",
    icon: "people",
    href: "/Home/kofiu",
    isActive: (p) => p.startsWith("/Home/kofiu"),
  },
  {
    key: "ofac",
    label: "OFAC",
    icon: "shield-checkmark",
    href: "/Home/ofac",
    isActive: (p) => p.startsWith("/Home/ofac"),
  },
  {
    key: "un",
    label: "UN",
    icon: "globe-outline",
    href: "/Home/un",
    isActive: (p) => p.startsWith("/Home/un"),
  },
  {
    key: "settings",
    label: "설정",
    icon: "settings-outline",
    href: "/Home/settings",
    isActive: (p) => p.startsWith("/Home/settings"),
  },
];

export default function BottomTabBar({ onPressSearchWhenActive }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const active = t.isActive(pathname);

        return (
          <Pressable
            key={t.key}
            onPress={() => {
              // ✅ 검색 탭이 이미 활성일 때만 "초기화" 같은 커스텀 동작 허용
              if (t.key === "watchlist" && active && onPressSearchWhenActive) {
                onPressSearchWhenActive();
                return;
              }

              // ✅ "딱딱 전환" = replace
              router.replace(t.href as any);
            }}
            style={({ pressed }) => [
              styles.tabItem,
              pressed && { opacity: 0.9 },
              active && styles.tabItemActive,
            ]}
          >
            <Ionicons
              name={t.icon}
              size={20}
              color={active ? "#9CC2FF" : "#6E86B8"}
            />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
              {t.label}
            </Text>

            {/* ✅ 작은 네모(activeMark) 제거: 연하게 감싸는 효과(tabItemActive)만 사용 */}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 14,
    height: 74,
    borderRadius: 22,
    backgroundColor: "#0F172A", // ✅ 불투명(반투명 제거)
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 8,
  },
  tabItem: {
    width: 66, // ✅ 5개 탭 대응
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  tabItemActive: {
    backgroundColor: "rgba(37, 99, 235, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(156, 194, 255, 0.22)",
  },
  tabLabel: { fontSize: 11, fontWeight: "800", color: "#6E86B8" },
  tabLabelActive: { color: "#9CC2FF" },
});
