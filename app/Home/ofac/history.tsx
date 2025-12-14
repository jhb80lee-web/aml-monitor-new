// app/Home/ofac/history.tsx
import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { OFAC_HISTORY_URL } from "../../../constants/api";

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
  if (isNaN(d.getTime())) {
    return `${updatedAt} 기준`;
  }
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

      const res = await fetch(OFAC_HISTORY_URL);
if (!res.ok) throw new Error(`HTTP ${res.status}`);


      const json = (await res.json()) as HistoryResponseRaw;
      console.log("OFAC history 응답:", json);

      const raw = json.snapshots || [];

      // 연속 스냅샷 기준 증감 계산
      const views: SnapshotView[] = raw.map((s, idx) => {
        const prev = idx > 0 ? raw[idx - 1] : null;

        const totalPrev = prev ? prev.total ?? 0 : s.total ?? 0;
        const totalDiff = (s.total ?? 0) - totalPrev;

        const krNow = s.totalKorea ?? 0;
        const krPrev = prev ? prev.totalKorea ?? 0 : krNow;
        const krDiff = krNow - krPrev;

        return {
          label: formatSnapshotLabel(s.updatedAt, idx),
          totalCount: s.total ?? 0,
          krCount: krNow,
          totalDiff,
          krDiff,
          addedCount: s.addedCount ?? 0,
          removedCount: s.removedCount ?? 0,
        };
      });

      setSnapshots(views);
    } catch (e) {
      console.log("OFAC history fetch 에러:", e);
      setError("히스토리 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.appName}>AML MONITOR</Text>
          <Text style={styles.title}>OFAC 히스토리</Text>
          <Text style={styles.subtitle}>
            스냅샷별 제재 대상 수와{"\n"}대한민국 관련 대상 증감 추이를 확인합니다.
          </Text>
        </View>

        {/* 👉 화살표 / 새로고침 네비 영역 제거됨 */}

        {/* 상태 */}
        {loading && (
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              히스토리 데이터를 불러오는 중입니다…
            </Text>
          </View>
        )}

        {error && !loading && (
          <View style={[styles.infoCard, styles.errorCard]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* 타임라인 */}
        {!loading && !error && (
          <View style={styles.timelineCard}>
            {snapshots.map((s, idx) => (
              <View key={`${s.label}-${idx}`} style={styles.timelineRow}>
                <View style={styles.timelineLeft}>
                  <View className="bulletOuter" style={styles.bulletOuter}>
                    <View style={styles.bulletInner} />
                  </View>
                  {idx !== snapshots.length - 1 && (
                    <View style={styles.bulletLine} />
                  )}
                </View>

                <View style={styles.timelineRight}>
                  <Text style={styles.snapshotLabel}>{s.label}</Text>

                  <View style={styles.snapshotRow}>
                    <View style={styles.snapshotBox}>
                      <Text style={styles.snapshotTitle}>전체 대상 수</Text>
                      <Text style={styles.snapshotNumber}>
                        {s.totalCount.toLocaleString()}건
                      </Text>
                      <Text
                        style={[
                          styles.snapshotDiff,
                          s.totalDiff > 0 && styles.diffUp,
                          s.totalDiff < 0 && styles.diffDown,
                        ]}
                      >
                        {s.totalDiff >= 0 ? "+" : ""}
                        {s.totalDiff.toLocaleString()}건
                      </Text>
                    </View>

                    <View style={styles.snapshotBox}>
                      <Text style={styles.snapshotTitle}>대한민국 관련</Text>
                      <Text style={styles.snapshotNumber}>
                        {s.krCount.toLocaleString()}건
                      </Text>
                      <Text
                        style={[
                          styles.snapshotDiff,
                          s.krDiff > 0 && styles.diffUp,
                          s.krDiff < 0 && styles.diffDown,
                        ]}
                      >
                        {s.krDiff >= 0 ? "+" : ""}
                        {s.krDiff.toLocaleString()}건
                      </Text>
                    </View>
                  </View>

                  {/* 필요 시 추가/삭제 텍스트 표시 가능 */}
                  {/* <Text style={styles.smallNote}>
                    신규 {s.addedCount.toLocaleString()}건 / 삭제{" "}
                    {s.removedCount.toLocaleString()}건
                  </Text> */}
                </View>
              </View>
            ))}

            {snapshots.length === 0 && (
              <Text style={styles.emptyText}>
                아직 저장된 히스토리 스냅샷이 없습니다.
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const CARD_BG = "#05060B";
const CARD_BORDER = "#262A3D";
const TEXT_PRIMARY = "#F5F7FF";
const TEXT_SECONDARY = "#A4ACC5";
const ACCENT = "#4F8CFF";
const ERROR = "#FF6B6B";
const UP = "#3CCB7F";
const DOWN = "#FF6B6B";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020308" },
  scrollInner: { paddingHorizontal: 20, paddingBottom: 40 },
  header: { paddingTop: 18, paddingBottom: 12 },
  appName: {
    fontSize: 12,
    letterSpacing: 3,
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  subtitle: { fontSize: 13, color: TEXT_SECONDARY, lineHeight: 18 },

  infoCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 12,
    marginBottom: 12,
  },
  infoText: { fontSize: 13, color: TEXT_SECONDARY },
  errorCard: { borderColor: ERROR },
  errorText: { fontSize: 13, color: ERROR },

  timelineCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  timelineRow: { flexDirection: "row", paddingBottom: 14 },
  timelineLeft: { width: 24, alignItems: "center" },
  bulletOuter: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: ACCENT,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 3,
  },
  bulletInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACCENT,
  },
  bulletLine: {
    flex: 1,
    width: 2,
    backgroundColor: "#1B1E2C",
    marginTop: 2,
  },
  timelineRight: { flex: 1, paddingLeft: 6 },
  snapshotLabel: { fontSize: 12, color: TEXT_SECONDARY, marginBottom: 6 },
  snapshotRow: { flexDirection: "row", gap: 10 },
  snapshotBox: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#070914",
  },
  snapshotTitle: { fontSize: 12, color: TEXT_SECONDARY, marginBottom: 4 },
  snapshotNumber: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    marginBottom: 2,
  },
  snapshotDiff: { fontSize: 11, color: TEXT_SECONDARY },
  diffUp: { color: UP },
  diffDown: { color: DOWN },
  emptyText: {
    paddingVertical: 10,
    fontSize: 12,
    textAlign: "center",
    color: TEXT_SECONDARY,
  },
  smallNote: {
    marginTop: 4,
    fontSize: 11,
    color: TEXT_SECONDARY,
  },
});
