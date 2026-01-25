// app/Home/ofac/index.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "expo-router";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE_URL } from "../../../constants/api";
import BottomTabBar from "../../../components/BottomTabBar";

type Person = {
  id: string;
  uid?: string;
  type?: string;
  name: string;
  birth?: string;
  country?: string;
  isKorea?: boolean;
  remark?: string;
  fullText?: string;
};

type LatestResponse<T> = {
  updatedAt: string;
  total: number;
  data: T[];
};

function isSouthKoreaEntry(p: Person): boolean {
  const text = `${p.country ?? ""} ${p.name ?? ""}`.toLowerCase();
  if (!text.includes("korea")) return false;

  const hasSouth =
    text.includes("korea, south") ||
    text.includes("south korea") ||
    text.includes("republic of korea") ||
    text.includes("seoul");

  const isNorth =
    text.includes("korea, north") ||
    text.includes("north korea") ||
    text.includes("democratic people's republic of korea");

  return hasSouth && !isNorth;
}

export default function OfacScreen() {
  const [json, setJson] = useState<LatestResponse<Person> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // ✅ 전체가 아니라 “korea endpoint”가 있다면 그걸 써도 됨.
      // 여기서는 latest를 받아서 한국 관련만 필터하는 방식으로 구현
      const res = await fetch(`${API_BASE_URL}/ofac/sdn/latest`);
      if (!res.ok) throw new Error(`OFAC 최신 데이터 조회 실패 (HTTP ${res.status})`);

      const data = (await res.json()) as LatestResponse<Person>;
      setJson(data);
    } catch (e: any) {
      setError(e?.message ?? "OFAC 최신 데이터 조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const krList = useMemo(() => {
    const base = (json?.data ?? []).filter((p) => p.isKorea === true || isSouthKoreaEntry(p));
    const q = keyword.trim().toLowerCase();
    if (!q) return base;

    return base.filter((p) => {
      const text = `${p.name ?? ""} ${p.birth ?? ""} ${p.country ?? ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [json, keyword]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.appName}>AML MONITOR</Text>
          <Text style={styles.title}>OFAC SDN</Text>
          <Text style={styles.subtitle}>
            OFAC SDN List 기준으로{"\n"}
            대한민국 관련 항목만 요약해서 보여줍니다.
          </Text>

          <View style={styles.navRow}>
            <View style={{ flex: 1 }} />
            <Link href="/Home/ofac/history" asChild>
              <Pressable style={styles.historyBtn}>
                <Text style={styles.historyBtnText}>히스토리 보기</Text>
              </Pressable>
            </Link>
          </View>
        </View>

        <View style={styles.card}>
          {loading ? (
            <View style={styles.centerRow}>
              <ActivityIndicator />
              <Text style={styles.cardSub}>불러오는 중…</Text>
            </View>
          ) : error ? (
            <Text style={[styles.cardSub, { color: "#FF6B6B" }]}>{error}</Text>
          ) : (
            <>
              <Text style={styles.cardTitle}>요약</Text>
              <Text style={styles.cardSub}>기준일: {(json?.updatedAt ? String(json.updatedAt).slice(0, 10) : "-")}
              </Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>전체</Text>
                <Text style={styles.summaryValue}>{json?.total?.toLocaleString() ?? 0}건</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>대한민국 관련</Text>
                <Text style={styles.summaryValue}>{krList.length.toLocaleString()}건</Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color="#8BA4D6" />
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="이름/키워드 검색"
            placeholderTextColor="#63708D"
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {keyword.trim().length > 0 && (
            <Pressable onPress={() => setKeyword("")} hitSlop={10}>
              <Ionicons name="close-circle" size={20} color="#8BA4D6" />
            </Pressable>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>대한민국 관련 리스트</Text>

          {!loading && !error && krList.length === 0 && (
            <Text style={styles.emptyText}>표시할 항목이 없습니다.</Text>
          )}

          {krList.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => setSelected(p)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.rowTitle}>{p.name}</Text>
              <Text style={styles.rowSub}>
                {p.birth ? `(${p.birth}) ` : ""}
                {p.country ?? ""}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <BottomTabBar />

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalDim} onPress={() => setSelected(null)} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{selected?.name}</Text>
          <Text style={styles.modalSub}>
            {selected?.birth ? `식별/생년: ${selected?.birth}\n` : ""}
            국가: {selected?.country ?? "-"}
          </Text>

          {!!selected?.remark && <Text style={styles.modalBody}>{selected.remark}</Text>}
          {!!selected?.fullText && <Text style={styles.modalBody}>{selected.fullText}</Text>}

          <Pressable onPress={() => setSelected(null)} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>닫기</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  scroll: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 130 },

  header: { paddingBottom: 10 },
  appName: { fontSize: 11, letterSpacing: 3, color: "rgba(234,240,255,0.55)", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#EAF0FF" },
  subtitle: { marginTop: 6, fontSize: 13, color: "rgba(234,240,255,0.70)", lineHeight: 18 },

  navRow: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  historyBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },
  historyBtnText: { color: "#9CC2FF", fontWeight: "800", fontSize: 12 },

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
  centerRow: { flexDirection: "row", alignItems: "center", gap: 10 },

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

  searchWrap: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, color: "#EAF0FF", fontSize: 14, paddingVertical: 4 },

  section: { marginTop: 16 },
  sectionTitle: { color: "#EAF0FF", fontSize: 14, fontWeight: "900", marginBottom: 10 },
  emptyText: { color: "rgba(234,240,255,0.55)", fontSize: 12 },

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

  modalDim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)" },
  modalCard: {
    position: "absolute",
    left: 18,
    right: 18,
    top: "20%",
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },
  modalTitle: { color: "#EAF0FF", fontSize: 16, fontWeight: "900", marginBottom: 6 },
  modalSub: { color: "rgba(234,240,255,0.70)", fontSize: 12, lineHeight: 18 },
  modalBody: { marginTop: 10, color: "rgba(234,240,255,0.65)", fontSize: 12, lineHeight: 18 },
  modalClose: {
    marginTop: 14,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#2B57D6",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: { color: "#EAF0FF", fontSize: 14, fontWeight: "900" },
});
