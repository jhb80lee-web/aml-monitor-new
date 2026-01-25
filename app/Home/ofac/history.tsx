// app/Home/ofac/history.tsx
import React, { useCallback, useEffect, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { API_BASE_URL } from "../../../constants/api";
import BottomTabBar from "../../../components/BottomTabBar";

type SnapshotRaw = {
  updatedAt: string;
  total: number;
  totalKorea?: number;
  addedCount?: number;
  removedCount?: number;
};

type HistoryResponseRaw = {
  snapshots: SnapshotRaw[];
};

type SnapshotView = {
  label: string;
  totalCount: number;
  krCount: number;
  totalDiff: number;
  krDiff: number;
  addedCount: number;
  removedCount: number;
};

function formatSnapshotLabel(updatedAt: string, index: number) {
  if (!updatedAt) return `스냅샷 ${index + 1}`;
  const d = new Date(updatedAt);
  if (isNaN(d.getTime())) return `${updatedAt} 기준`;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min} 기준`;
}

export default function OfacHistoryScreen() {
  const [snapshots, setSnapshots] = useState<SnapshotView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`${API_BASE_URL}/ofac/sdn/history`);
      if (!res.ok) throw new Error(`OFAC 히스토리 조회 실패 (HTTP ${res.status})`);

      const json = (await res.json()) as HistoryResponseRaw;
const raw = json?.snapshots ?? [];

// ✅ 최신(updatedAt) 내림차순 정렬 (최신이 위로)
const sorted = [...raw].sort((a, b) => {
  const ta = new Date(a.updatedAt).getTime();
  const tb = new Date(b.updatedAt).getTime();

  // updatedAt이 이상한 값일 경우도 안전 처리
  const na = Number.isFinite(ta) ? ta : 0;
  const nb = Number.isFinite(tb) ? tb : 0;

  return nb - na;
});

const views: SnapshotView[] = sorted.map((s, idx) => {
  const prev = sorted[idx + 1]; // ✅ 다음(더 과거) 스냅샷
  const kr = s.totalKorea ?? 0;
  const prevKr = prev?.totalKorea ?? 0;

  return {
    label: formatSnapshotLabel(s.updatedAt, idx),
    totalCount: s.total ?? 0,
    krCount: kr,
    totalDiff: (s.total ?? 0) - (prev?.total ?? 0),
    krDiff: kr - prevKr,
    addedCount: s.addedCount ?? 0,
    removedCount: s.removedCount ?? 0,
  };
});

setSnapshots(views);

    } catch (e: any) {
      setError(e?.message ?? "OFAC 히스토리 조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.appName}>AML MONITOR</Text>
          <Text style={styles.title}>OFAC 히스토리</Text>
          <Text style={styles.subtitle}>OFAC SDN 스냅샷 변동을 확인합니다.</Text>
        </View>

        {loading && (
          <View style={styles.card}>
            <Text style={styles.cardSub}>불러오는 중…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.card}>
            <Text style={[styles.cardSub, { color: "#FF6B6B" }]}>{error}</Text>
          </View>
        )}

        {!loading && !error && (
          <View style={styles.card}>
            {snapshots.map((s, idx) => {
              const isLast = idx === snapshots.length - 1;

              return (
                <View key={idx} style={[styles.rowWrap, isLast && { borderBottomWidth: 0, paddingBottom: 2 }]}>
                  <Text style={styles.snapshotLabel}>{s.label}</Text>

                  <View style={styles.snapshotRow}>
                    <View style={styles.rowCard}>
                      <Text style={styles.rowCardTitle}>전체</Text>
                      <Text style={styles.rowCardValue}>{s.totalCount.toLocaleString()}</Text>
                      <Text
                        style={[
                          styles.rowCardDiff,
                          s.totalDiff > 0 ? styles.diffUp : s.totalDiff < 0 ? styles.diffDown : null,
                        ]}
                      >
                        {s.totalDiff > 0 ? `+${s.totalDiff}` : `${s.totalDiff}`}
                      </Text>
                    </View>

                    <View style={styles.rowCard}>
                      <Text style={styles.rowCardTitle}>대한민국</Text>
                      <Text style={styles.rowCardValue}>{s.krCount.toLocaleString()}</Text>
                      <Text
                        style={[styles.rowCardDiff, s.krDiff > 0 ? styles.diffUp : s.krDiff < 0 ? styles.diffDown : null]}
                      >
                        {s.krDiff > 0 ? `+${s.krDiff}` : `${s.krDiff}`}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <Text style={styles.metaText}>
                      추가 {s.addedCount.toLocaleString()} · 제거 {s.removedCount.toLocaleString()}
                    </Text>
                  </View>
                </View>
              );
            })}

            {snapshots.length === 0 && <Text style={styles.emptyText}>아직 저장된 히스토리 스냅샷이 없습니다.</Text>}
          </View>
        )}
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

/**
 * ✅ ofac/index.tsx 와 1:1로 맞춘 스타일 (배경/헤더/카드 톤 동일)
 */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  scroll: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 130 },

  header: { paddingBottom: 10 },
  appName: { fontSize: 11, letterSpacing: 3, color: "rgba(234,240,255,0.55)", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#EAF0FF" },
  subtitle: { marginTop: 6, fontSize: 13, color: "rgba(234,240,255,0.70)", lineHeight: 18 },

  // ✅ index.tsx card 톤
  card: {
    marginTop: 12,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  cardSub: { color: "rgba(234,240,255,0.65)", fontSize: 12, marginTop: 4 },

  // 히스토리 각 스냅샷 블록 (card 내부에서 구분선)
  rowWrap: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148, 163, 184, 0.10)",
  },

  snapshotLabel: { fontSize: 12, color: "rgba(234,240,255,0.65)", marginBottom: 10 },

  snapshotRow: { flexDirection: "row", gap: 10 },

  // ✅ index.tsx row 톤
  rowCard: {
    flex: 1,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.10)",
  },
  rowCardTitle: { fontSize: 12, color: "rgba(234,240,255,0.65)", marginBottom: 4 },
  rowCardValue: { fontSize: 18, fontWeight: "900", color: "#EAF0FF", marginBottom: 2 },
  rowCardDiff: { fontSize: 11, color: "rgba(234,240,255,0.65)" },

  diffUp: { color: "#3CCB7F" },
  diffDown: { color: "#FF6B6B" },

  metaRow: { marginTop: 10 },
  metaText: { fontSize: 11, color: "rgba(234,240,255,0.55)" },

  emptyText: { paddingVertical: 10, fontSize: 12, textAlign: "center", color: "rgba(234,240,255,0.55)" },
});
