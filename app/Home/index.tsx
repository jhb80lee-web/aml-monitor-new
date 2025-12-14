// app/Home/index.tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Link } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE_URL } from "../../constants/api";
import {
  initNotifications,
  sendLocalNotification,
  setAppBadgeCount,
} from "../notificationsConfig";

type KofiuLatestResponse = {
  updatedAt: string;
  total: number;
};

const STORAGE_KEYS = {
  lastVaspUpdatedAt: "@aml:lastVaspUpdatedAt",
  lastRestrictedUpdatedAt: "@aml:lastRestrictedUpdatedAt",
  badgeCount: "@aml:badgeCount",
};

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [badgeCount, setBadgeCountState] = useState(0);
  const [vaspUpdated, setVaspUpdated] = useState(false);
  const [restrictedUpdated, setRestrictedUpdated] = useState(false);

  // 배지 상태 로드
  const loadBadgeFromStorage = useCallback(async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEYS.badgeCount);
    const parsed = stored ? Number(stored) : 0;
    setBadgeCountState(parsed);
    await setAppBadgeCount(parsed);
  }, []);

  // KoFIU 최신 데이터 확인 + 알림
  const checkKofiuUpdates = useCallback(async () => {
    try {
      setLoading(true);

      const [vaspRes, restrictedRes] = await Promise.all([
        fetch(`${API_BASE_URL}/kofiu/vasp/latest`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/kofiu/restricted/latest`).then((r) => r.json()),
      ]);

      const vasp = vaspRes as KofiuLatestResponse;
      const restricted = restrictedRes as KofiuLatestResponse;

      const [storedVasp, storedRestricted, storedBadge] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.lastVaspUpdatedAt),
        AsyncStorage.getItem(STORAGE_KEYS.lastRestrictedUpdatedAt),
        AsyncStorage.getItem(STORAGE_KEYS.badgeCount),
      ]);

      let badge = storedBadge ? Number(storedBadge) : 0;
      let hasVaspUpdate = false;
      let hasRestrictedUpdate = false;

      // 최초 실행인 경우: 기록만 저장하고 알림은 보내지 않기
      if (!storedVasp) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.lastVaspUpdatedAt,
          vasp.updatedAt
        );
      } else if (storedVasp !== vasp.updatedAt) {
        hasVaspUpdate = true;
        badge += 1;
        await AsyncStorage.setItem(
          STORAGE_KEYS.lastVaspUpdatedAt,
          vasp.updatedAt
        );
        await sendLocalNotification(
          "KoFIU VASP 리스트 업데이트",
          "가상자산사업자 신고현황 데이터가 갱신되었습니다."
        );
      }

      if (!storedRestricted) {
        await AsyncStorage.setItem(
          STORAGE_KEYS.lastRestrictedUpdatedAt,
          restricted.updatedAt
        );
      } else if (storedRestricted !== restricted.updatedAt) {
        hasRestrictedUpdate = true;
        badge += 1;
        await AsyncStorage.setItem(
          STORAGE_KEYS.lastRestrictedUpdatedAt,
          restricted.updatedAt
        );
        await sendLocalNotification(
          "금융거래제한대상자 리스트 업데이트",
          "금융거래 등 제한대상자 데이터가 갱신되었습니다."
        );
      }

      // 상태 반영
      setVaspUpdated(hasVaspUpdate);
      setRestrictedUpdated(hasRestrictedUpdate);
      setBadgeCountState(badge);
      await AsyncStorage.setItem(STORAGE_KEYS.badgeCount, String(badge));
      await setAppBadgeCount(badge);
    } catch (e) {
      console.log("⚠️ KoFIU 업데이트 체크 실패", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // 알림 초기화 + Badge 로드 + 업데이트 체크
  useEffect(() => {
    (async () => {
      const ok = await initNotifications();
      if (ok) {
        await loadBadgeFromStorage();
        await checkKofiuUpdates();
      }
    })();
  }, [checkKofiuUpdates, loadBadgeFromStorage]);

  // 사용자가 KoFIU 메뉴에 실제로 들어가면 “읽음 처리”한다고 가정
  const clearKofiuBadges = async () => {
    setVaspUpdated(false);
    setRestrictedUpdated(false);
    // KoFIU 두 항목만큼 배지 감소 (최소 0까지)
    const storedBadge = await AsyncStorage.getItem(STORAGE_KEYS.badgeCount);
    let badge = storedBadge ? Number(storedBadge) : 0;
    const minus =
      (vaspUpdated ? 1 : 0) + (restrictedUpdated ? 1 : 0);
    badge = Math.max(badge - minus, 0);
    setBadgeCountState(badge);
    await AsyncStorage.setItem(STORAGE_KEYS.badgeCount, String(badge));
    await setAppBadgeCount(badge);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>AML Monitor</Text>
        <Text style={styles.subtitle}>
          KoFIU · OFAC · UN · WatchList 통합 도우미
        </Text>

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>최신 데이터 확인 중...</Text>
          </View>
        )}

        {/* KoFIU 카드 */}
        <Link href="/Home/kofiu" asChild>
          <Pressable style={styles.card} onPress={clearKofiuBadges}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>KoFIU</Text>
              {(vaspUpdated || restrictedUpdated) && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>NEW</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardDescription}>
              · 가상자산사업자 신고현황 (VASP){"\n"}
              · 금융거래 등 제한대상자
            </Text>
          </Pressable>
        </Link>

        {/* OFAC 카드 */}
        <Link href="/Home/ofac" asChild>
          <Pressable style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>OFAC 제재 리스트</Text>
            </View>
            <Text style={styles.cardDescription}>
              미국 재무부 OFAC SDN 중 한국 관련 제재 대상 조회
            </Text>
          </Pressable>
        </Link>

        {/* UN 카드 */}
        <Link href="/Home/un" asChild>
          <Pressable style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>UN 제재 리스트</Text>
            </View>
            <Text style={styles.cardDescription}>
              UN 안보리 제재 대상 중 한국 관련 제재 대상 조회
            </Text>
          </Pressable>
        </Link>

        {/* WatchList 통합 검색 카드 */}
        <Link href="/Home/watchlist" asChild>
          <Pressable style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>WatchList 통합 검색</Text>
              {badgeCount > 0 && (
                <View style={styles.badgeCircle}>
                  <Text style={styles.badgeText}>{badgeCount}</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardDescription}>
              이름/키워드로 VASP · 금융거래제한 · OFAC · UN을{"\n"}
              한 번에 검색하고, 어디에 몇 건 있는지 확인
            </Text>
          </Pressable>
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617", // 매우 진한 네이비(다크 모드)
  },
  scrollContent: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#E5E7EB",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#9CA3AF",
    marginBottom: 16,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  loadingText: {
    marginLeft: 8,
    color: "#9CA3AF",
    fontSize: 13,
  },
  card: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#F9FAFB",
  },
  cardDescription: {
    fontSize: 13,
    color: "#9CA3AF",
    lineHeight: 18,
  },
  badge: {
    backgroundColor: "#DC2626",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeCircle: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#F9FAFB",
    fontSize: 11,
    fontWeight: "700",
  },
});
