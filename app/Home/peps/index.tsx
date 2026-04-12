import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
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
  CIA_PEP_ALPHABET,
  CiaPepCountry,
  CiaPepLatestResponse,
  fetchCiaPepsLatest,
} from "../../../constants/ciaPeps";

export default function PepsIndexScreen() {
  const router = useRouter();
  const [json, setJson] = useState<CiaPepLatestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLetter, setSelectedLetter] = useState("A");

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

  useEffect(() => {
    if (!json?.letters?.length) return;
    if (!json.letters.includes(selectedLetter)) {
      setSelectedLetter(json.letters[0]);
    }
  }, [json, selectedLetter]);

  const countries = useMemo(() => {
    const all = json?.countries ?? [];
    return all.filter((country) => country.letter === selectedLetter);
  }, [json, selectedLetter]);

  const totalCountries = json?.countries?.length ?? 0;
  const totalEntries = json?.total ?? 0;
  const canShowCountries = !loading && !error && !!json;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.appName}>AML MONITOR</Text>
          <Text style={styles.title}>CIA PEPs</Text>
          <Text style={styles.subtitle}>
            CIA World Leaders 기준으로{"\n"}
            국가별 PEP 목록을 알파벳 순서로 탐색합니다.
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
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>전체 국가</Text>
                <Text style={styles.summaryValue}>{totalCountries.toLocaleString()}개</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>전체 인물</Text>
                <Text style={styles.summaryValue}>{totalEntries.toLocaleString()}명</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>알파벳 탐색</Text>
            {!!json && <Text style={styles.sectionMeta}>{json.letters.length}개 구간</Text>}
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.lettersRow}
          >
            {CIA_PEP_ALPHABET.map((letter) => {
              const available = !!json?.letters?.includes(letter);
              const active = selectedLetter === letter;

              return (
                <Pressable
                  key={letter}
                  onPress={() => {
                    if (!available) return;
                    setSelectedLetter(letter);
                  }}
                  style={({ pressed }) => [
                    styles.letterChip,
                    active && styles.letterChipActive,
                    !available && styles.letterChipDisabled,
                    pressed && available && { opacity: 0.9 },
                  ]}
                >
                  <Text
                    style={[
                      styles.letterChipText,
                      active && styles.letterChipTextActive,
                      !available && styles.letterChipTextDisabled,
                    ]}
                  >
                    {letter}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{selectedLetter} 국가</Text>
            {canShowCountries && (
              <Text style={styles.sectionMeta}>{countries.length.toLocaleString()}개 국가</Text>
            )}
          </View>

          {!loading && !error && countries.length === 0 && (
            <Text style={styles.emptyText}>이 알파벳에 해당하는 국가가 없습니다.</Text>
          )}

          {countries.map((country: CiaPepCountry) => {
            const title = country.code === country.name ? country.name : `${country.name} (${country.code})`;
            const updatedAt = formatDateOnly(country.lastUpdated);

            return (
              <Pressable
                key={country.code}
                onPress={() => router.push(`/Home/peps/${country.code}` as any)}
                style={({ pressed }) => [styles.countryCard, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.countryTitle}>{title}</Text>
                <Text style={styles.countrySub}>{country.count.toLocaleString()}명</Text>
                <Text style={styles.countryMeta}>최신 업데이트 {updatedAt}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

function formatDateOnly(value?: string) {
  if (!value) return "-";

  const direct = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];

  const date = new Date(String(value).trim());
  if (Number.isNaN(date.getTime())) return "-";

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  scroll: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 130 },

  header: { paddingBottom: 10 },
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
  retryBtnText: { color: "#9CC2FF", fontSize: 12, fontWeight: "800" },

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

  lettersRow: { gap: 8, paddingRight: 12 },
  letterChip: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  letterChipActive: {
    backgroundColor: "rgba(37, 99, 235, 0.22)",
    borderColor: "rgba(156, 194, 255, 0.26)",
  },
  letterChipDisabled: {
    backgroundColor: "rgba(15, 23, 42, 0.38)",
    borderColor: "rgba(148, 163, 184, 0.08)",
  },
  letterChipText: { color: "#8BA4D6", fontSize: 13, fontWeight: "900" },
  letterChipTextActive: { color: "#EAF0FF" },
  letterChipTextDisabled: { color: "rgba(139,164,214,0.32)" },

  countryCard: {
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.10)",
  },
  countryTitle: { color: "#EAF0FF", fontSize: 14, fontWeight: "900", marginBottom: 4 },
  countrySub: { color: "rgba(234,240,255,0.65)", fontSize: 12, lineHeight: 16 },
  countryMeta: { color: "rgba(156,194,255,0.72)", fontSize: 11, marginTop: 4 },
});
