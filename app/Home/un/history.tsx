// app/Home/un/history.tsx
import React, { useCallback, useEffect, useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { UN_SDN_HISTORY_URL } from "../../../constants/api";
import { fetchJson } from "../../../constants/fetchJson";
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

export default function UnHistoryScreen() {
  const [snapshots, setSnapshots] = useState<SnapshotView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const json = await fetchJson<HistoryResponseRaw>(UN_SDN_HISTORY_URL, { timeoutMs: 8000 });
      const raw = json?.snapshots ?? [];

      // ✅ 최신(updatedAt) 내림차순 정렬 (최신이 위)
      const sorted = [...raw].sort((a, b) => {
        const ta = new Date(a.updatedAt).getTime();
        const tb = new Date(b.updatedAt).getTime();
        const na = Number.isFinite(ta) ? ta : 0;
        const nb = Number.isFinite(tb) ? tb : 0;
        return nb - na;
      });

      const views: SnapshotView[] = sorted.map((s, idx) => {
        const prev = sorted[idx + 1]; // ✅ 바로 아래(과거)와 비교
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
      setError(e?.message ?? "히스토리 조회 중 오류가 발생했습니다.");
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
          <Text style={styles.title}>UN 히스토리</Text>
          <Text style={styles.subtitle}>UN 제재 리스트 스냅샷 변동을 확인합니다.</Text>
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
                <View key={idx} style={[styles.timelineRow, isLast && { paddingBottom: 2 }]}>
                  <View style={styles.timelineLeft}>
                    <View style={styles.bulletOuter}>
                      <View style={styles.bulletInner} />
                    </View>
                    {!isLast && <View style={styles.bulletLine} />}
                  </View>

                  <View style={styles.timelineRight}>
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
                          style={[
                            styles.rowCardDiff,
                            s.krDiff > 0 ? styles.diffUp : s.krDiff < 0 ? styles.diffDown : null,
                          ]}
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
                </View>
              );
            })}

            {snapshots.length === 0 && (
              <Text style={styles.emptyText}>아직 저장된 히스토리 스냅샷이 없습니다.</Text>
            )}
          </View>
        )}
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

/**
 * ✅ OFAC index.tsx 톤과 동일하게 통일
 */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  scroll: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 130 },

  header: { paddingBottom: 10 },
  appName: { fontSize: 11, letterSpacing: 3, color: "rgba(234,240,255,0.55)", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#EAF0FF" },
  subtitle: { marginTop: 6, fontSize: 13, color: "rgba(234,240,255,0.70)", lineHeight: 18 },

  // 메인 카드 톤
  card: {
    marginTop: 12,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  cardSub: { color: "rgba(234,240,255,0.65)", fontSize: 12, marginTop: 4 },

  // 타임라인
  timelineRow: { flexDirection: "row", paddingTop: 12, paddingBottom: 14 },

  timelineLeft: { width: 24, alignItems: "center" },

  // ✅ 포인트 컬러: index.tsx의 history 버튼 텍스트 컬러와 통일
  bulletOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#9CC2FF",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 3,
  },
  bulletInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#9CC2FF" },
  bulletLine: { flex: 1, width: 2, backgroundColor: "rgba(148, 163, 184, 0.10)", marginTop: 2 },

  timelineRight: { flex: 1, paddingLeft: 6 },

  snapshotLabel: { fontSize: 12, color: "rgba(234,240,255,0.65)", marginBottom: 10 },
  snapshotRow: { flexDirection: "row", gap: 10 },

  // 내부 카드(전체/대한민국)도 index.tsx row 톤
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
