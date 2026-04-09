import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import BottomTabBar from "../../../components/BottomTabBar";
import { CIA_PEPS_LATEST_URL } from "../../../constants/api";
import {
  CiaPepEntry,
  CiaPepLatestResponse,
  fetchCiaPepsLatest,
  normalizeCountryCode,
} from "../../../constants/ciaPeps";

export default function PepsCountryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ countryCode?: string }>();
  const countryCode = normalizeCountryCode(params.countryCode);

  const [json, setJson] = useState<CiaPepLatestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLatest = useCallback(async (force = false) => {
    try {
      setLoading(true);
      setError(null);

      const data = (await fetchCiaPepsLatest(CIA_PEPS_LATEST_URL, {
        force,
      })) as CiaPepLatestResponse;
      setJson(data);
    } catch (e: any) {
      setError(e?.message ?? "CIA PEP 최신 데이터 조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const countryMeta = useMemo(
    () => (json?.countries ?? []).find((item) => item.code === countryCode) ?? null,
    [json, countryCode]
  );

  const entries = useMemo(
    () =>
      (json?.data ?? [])
        .filter((item: CiaPepEntry) => item.countryCode === countryCode)
        .sort((a, b) => a.name.localeCompare(b.name, "en")),
    [json, countryCode]
  );

  const title = countryMeta?.name ?? countryCode ?? "국가";
  const invalidCountryCode = !loading && !error && !!json && !!countryCode && !countryMeta;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
                return;
              }
              router.replace("/Home/peps" as any);
            }}
            style={styles.backBtn}
          >
            <Text style={styles.backBtnText}>국가 목록</Text>
          </Pressable>

          <Text style={styles.appName}>AML MONITOR</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            CIA World Leaders 기준으로{"\n"}
            {title}의 PEP 항목을 보여줍니다.
          </Text>
        </View>

        <View style={styles.card}>
          {loading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator />
              <Text style={styles.cardSub}>불러오는 중…</Text>
            </View>
          ) : error ? (
            <>
              <Text style={[styles.cardSub, styles.errorText]}>{error}</Text>
              <Pressable onPress={() => loadLatest(true)} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>다시 불러오기</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>요약</Text>
              <Text style={styles.cardSub}>
                기준일: {json?.updatedAt ? String(json.updatedAt).slice(0, 10) : "-"}
              </Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>국가 코드</Text>
                <Text style={styles.summaryValue}>{countryCode || "-"}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>인물 수</Text>
                <Text style={styles.summaryValue}>{entries.length.toLocaleString()}명</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>리더 및 직함</Text>
            {!loading && !error && (
              <Text style={styles.sectionMeta}>{entries.length.toLocaleString()}명</Text>
            )}
          </View>

          {invalidCountryCode && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>해당 국가 코드를 찾을 수 없습니다.</Text>
              <Pressable onPress={() => router.replace("/Home/peps" as any)} style={styles.retryBtn}>
                <Text style={styles.retryBtnText}>국가 목록으로 돌아가기</Text>
              </Pressable>
            </View>
          )}

          {!loading && !error && !invalidCountryCode && entries.length === 0 && (
            <Text style={styles.emptyText}>표시할 항목이 없습니다.</Text>
          )}

          {!invalidCountryCode &&
            entries.map((item) => (
              <View key={item.id} style={styles.row}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowSub}>{item.title || "-"}</Text>
              </View>
            ))}
        </View>
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  scroll: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 130 },

  header: { paddingBottom: 10 },
  backBtn: {
    alignSelf: "flex-start",
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },
  backBtnText: { color: "#9CC2FF", fontWeight: "800", fontSize: 12 },
  appName: { fontSize: 11, letterSpacing: 3, color: "rgba(234,240,255,0.55)", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#EAF0FF" },
  subtitle: { marginTop: 6, fontSize: 13, color: "rgba(234,240,255,0.70)", lineHeight: 18 },

  card: {
    marginTop: 12,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  cardTitle: { color: "#EAF0FF", fontSize: 14, fontWeight: "900", marginBottom: 6 },
  cardSub: { color: "rgba(234,240,255,0.65)", fontSize: 12, marginTop: 4 },
  errorText: { color: "#FF6B6B" },
  centerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  retryBtn: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(37, 99, 235, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(156, 194, 255, 0.22)",
  },
  retryBtnText: { color: "#9CC2FF", fontWeight: "800", fontSize: 12 },

  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.10)",
  },
  summaryLabel: { color: "rgba(234,240,255,0.70)", fontSize: 12, fontWeight: "700" },
  summaryValue: { color: "#EAF0FF", fontSize: 12, fontWeight: "900" },

  section: { marginTop: 16 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: { color: "#EAF0FF", fontSize: 14, fontWeight: "900" },
  sectionMeta: { color: "rgba(234,240,255,0.55)", fontSize: 11, fontWeight: "700" },
  emptyText: { color: "rgba(234,240,255,0.55)", fontSize: 12 },
  emptyCard: {
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.10)",
  },

  row: {
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.10)",
  },
  rowTitle: { color: "#EAF0FF", fontSize: 14, fontWeight: "900", marginBottom: 4 },
  rowSub: { color: "rgba(234,240,255,0.65)", fontSize: 12, lineHeight: 16 },
});
