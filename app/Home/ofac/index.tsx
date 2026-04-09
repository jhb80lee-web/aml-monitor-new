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

// ✅ "표시용" 한국 관련 키워드(하이라이트/칩)
//    (중요) 이건 설명/표시용일 뿐, isKorea 판정 로직은 건드리지 않음
const KOREA_TERMS = [
  "Korea",
  "South Korea",
  "Republic of Korea",
  "Korea, South",
  "Korea, Republic of",
  "Seoul",
  "Busan",
  "Incheon",
  "Daegu",
  "Daejeon",
  "Gwangju",
  "Cheongju",
  "Chungcheong",
  "Gyeonggi",
  "Gangwon",
  "Jeju",
  "KOR",
  "KR",
  "ROK",
  "대한민국",
  "한국",
  "서울",
  "부산",
  "인천",
  "대구",
  "대전",
  "광주",
  "충청",
  "경기",
  "강원",
  "제주",
];

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqKeepOrder(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

function findKoreaHits(p: Person | null) {
  if (!p) return [];
  const blob = `${p.name ?? ""}\n${p.country ?? ""}\n${p.remark ?? ""}\n${p.fullText ?? ""}`.toLowerCase();

  const hits: string[] = [];
  for (const term of KOREA_TERMS) {
    if (!term) continue;
    if (blob.includes(term.toLowerCase())) hits.push(term);
  }
  // 너무 많으면 UI가 지저분해지니 상위 일부만
  return uniqKeepOrder(hits).slice(0, 12);
}

function HighlightedText({
  text,
  terms,
  normalStyle,
  highlightStyle,
}: {
  text: string;
  terms: string[];
  normalStyle: any;
  highlightStyle: any;
}) {
  if (!text) return null;
  if (!terms || terms.length === 0) return <Text style={normalStyle}>{text}</Text>;

  // 긴 키워드를 먼저 매칭해서 부분 겹침을 줄임
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${sorted.map(escapeRegExp).join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <Text style={normalStyle}>
      {parts.map((part, idx) => {
        // split 패턴의 캡처 그룹이므로 매칭된 토큰은 그대로 들어옴
        const isHit = sorted.some((t) => t.toLowerCase() === part.toLowerCase());
        if (isHit) {
          return (
            <Text key={idx} style={highlightStyle}>
              {part}
            </Text>
          );
        }
        return <Text key={idx}>{part}</Text>;
      })}
    </Text>
  );
}

export default function OfacScreen() {
  const [json, setJson] = useState<LatestResponse<Person> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ 검색창 UI 비활성화(숨김) — 로직은 유지
  const SEARCH_DISABLED = true;

  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

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
    // ✅ (원래대로) isKorea === true 만 사용 (리스트/판정 절대 건드리지 않음)
    const base = (json?.data ?? []).filter((p) => p.isKorea === true);

    if (SEARCH_DISABLED) return base;

    const q = keyword.trim().toLowerCase();
    if (!q) return base;

    return base.filter((p) => {
      const text = `${p.name ?? ""} ${p.birth ?? ""} ${p.country ?? ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [json, keyword, SEARCH_DISABLED]);

  const koreaHits = useMemo(() => findKoreaHits(selected), [selected]);

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
              <Text style={styles.cardSub}>
                기준일: {(json?.updatedAt ? String(json.updatedAt).slice(0, 10) : "-")}
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

        {/* Search (DISABLED) */}
        {!SEARCH_DISABLED && (
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
        )}

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

      {/* ✅ 모달: 내부 스크롤 + 닫기 고정 + 한국 관련 키워드 표시/하이라이트 */}
      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.modalDim} onPress={() => setSelected(null)} />

        <View style={styles.modalCard}>
          {/* 상단(고정) */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{selected?.name}</Text>
            <Text style={styles.modalSub}>
              {selected?.birth ? `식별/생년: ${selected?.birth}\n` : ""}
              국가: {selected?.country ?? "-"}
            </Text>
          </View>

          {/* 본문(스크롤) */}
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            showsVerticalScrollIndicator
          >
            {!!selected?.remark && (
              <HighlightedText
                text={selected.remark}
                terms={koreaHits}
                normalStyle={styles.modalBody}
                highlightStyle={styles.hl}
              />
            )}

            {!!selected?.fullText && (
              <HighlightedText
                text={selected.fullText}
                terms={koreaHits}
                normalStyle={styles.modalBody}
                highlightStyle={styles.hl}
              />
            )}
          </ScrollView>

          {/* 하단(고정) */}
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

  modalDim: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
  },

  modalCard: {
    position: "absolute",
    left: 18,
    right: 18,
    top: "12%",
    maxHeight: "76%",
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },

  modalHeader: { paddingBottom: 8 },
  modalTitle: { color: "#EAF0FF", fontSize: 16, fontWeight: "900", marginBottom: 6 },
  modalSub: { color: "rgba(234,240,255,0.70)", fontSize: 12, lineHeight: 18 },

  // ✅ "왜 한국 관련?" 영역
  reasonWrap: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.10)",
  },
  reasonLabel: { color: "rgba(234,240,255,0.75)", fontSize: 12, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },

  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(253, 224, 71, 0.16)", // 노란 계열
    borderWidth: 1,
    borderColor: "rgba(253, 224, 71, 0.30)",
  },
  chipText: { color: "rgba(253, 224, 71, 0.95)", fontSize: 12, fontWeight: "900" },

  chipMuted: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(148, 163, 184, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },
  chipMutedText: { color: "rgba(234,240,255,0.55)", fontSize: 12, fontWeight: "800" },

  modalScroll: { flexGrow: 0, marginTop: 6, marginBottom: 12 },
  modalScrollContent: { paddingBottom: 6 },

  modalBody: { marginTop: 10, color: "rgba(234,240,255,0.65)", fontSize: 12, lineHeight: 18 },

  // ✅ 노란 하이라이트
  hl: {
    backgroundColor: "rgba(253, 224, 71, 0.22)",
    color: "rgba(253, 224, 71, 0.95)",
    fontWeight: "900",
  },

  modalClose: {
    height: 44,
    borderRadius: 14,
    backgroundColor: "#2B57D6",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: { color: "#EAF0FF", fontSize: 14, fontWeight: "900" },
});
