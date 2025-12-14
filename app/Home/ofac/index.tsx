// app/Home/ofac/index.tsx
import { Link } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE_URL, OFAC_SDN_LATEST_URL } from "../../../constants/api";

type Person = {
  id: string;
  uid: string;
  name: string;
  birth: string;
  country: string;
  type: string;
  isKorea: boolean;
  remark?: string;
  fullText?: string;
};

type OfacLatestApi = {
  updatedAt: string;
  total: number;
  data: Person[];
};

type OfacDiffApi = {
  updatedAt: string;
  currentTotal: number;
  previousTotal: number;
  addedCount: number;
  removedCount: number;
  added: Person[];
  removed: Person[];
  note?: string;
};

type OfacView = {
  lastUpdated: string;
  prevSnapshotLabel: string;
  curSnapshotLabel: string;
  prevTotalCount: number;
  curTotalCount: number;
  prevKrCount: number;
  curKrCount: number;
  krCurrent: Person[];
};

// 🔹 isKorea 판정에 쓰였을 법한 한국 관련 키워드
const KOREA_KEYWORDS = [
  "south korea",
  "republic of korea",
  "korea, south",
  "south korean",
  "seoul",
];

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlighted(text?: string) {
  if (!text) return null;
  const lowerKeywords = KOREA_KEYWORDS.map((k) => k.toLowerCase());
  const regex = new RegExp(
    `(${lowerKeywords.map(escapeRegExp).join("|")})`,
    "gi"
  );

  const parts = text.split(regex);

  return parts.map((part, idx) => {
    const lower = part.toLowerCase();
    const shouldHighlight = lowerKeywords.includes(lower);
    return (
      <Text
        key={idx}
        style={shouldHighlight ? styles.highlightText : undefined}
      >
        {part}
      </Text>
    );
  });
}

export default function OfacScreen() {
  const [data, setData] = useState<OfacView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Person | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

    // 1) latest
const resLatest = await fetch(OFAC_SDN_LATEST_URL);
if (!resLatest.ok) throw new Error(`latest HTTP ${resLatest.status}`);
const latestJson = (await resLatest.json()) as OfacLatestApi;



      // 서버가 준 isKorea 플래그 기준으로 필터
      const krCurrent = latestJson.data.filter((p) => p.isKorea);
      const curKrCount = krCurrent.length;

      let prevTotalCount = 0;
      let prevKrCount = 0;
      let prevSnapshotLabel = "-";
      const curSnapshotLabel = "현재 스냅샷";

      // 2) diff (이전 스냅샷 숫자만 계산용으로 사용)
      try {
        const resDiff = await fetch(`${API_BASE_URL}/ofac/sdn/diff`);
        if (resDiff.ok) {
          const diffJson = (await resDiff.json()) as OfacDiffApi;
          prevTotalCount = diffJson.previousTotal || 0;
          prevSnapshotLabel =
            diffJson.previousTotal && diffJson.previousTotal > 0
              ? "직전 스냅샷"
              : "-";

          const krAdded = (diffJson.added || []).filter((p) => p.isKorea);
          const krRemoved = (diffJson.removed || []).filter((p) => p.isKorea);

          prevKrCount = curKrCount - krAdded.length + krRemoved.length;
          if (prevKrCount < 0) prevKrCount = 0;
        }
      } catch (e) {
        console.log("OFAC diff 조회 실패 (무시 가능):", e);
      }

      setData({
        lastUpdated: latestJson.updatedAt,
        prevSnapshotLabel,
        curSnapshotLabel,
        prevTotalCount,
        curTotalCount: latestJson.total,
        prevKrCount,
        curKrCount,
        krCurrent,
      });
    } catch (e: any) {
      console.log("OFAC fetch 에러:", e);
      setError("실시간 데이터를 불러오지 못해~~");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollInner}
        showsVerticalScrollIndicator={false}
      >
        {/* 상단 타이틀 */}
        <View style={styles.header}>
          <Text style={styles.appName}>AML MONITOR</Text>
          <Text style={styles.title}>OFAC 제재 리스트</Text>
          <Text style={styles.subtitle}>
            미국 재무부 OFAC 제재 대상 중{"\n"}
            대한민국 관련 제재 현황을 요약해서 보여줍니다.
          </Text>
        </View>

        {/* 상단 네비: 오른쪽에만 버튼형 히스토리 */}
        <View style={styles.navRow}>
          <View style={{ flex: 1 }} />
          <Link href="/Home/ofac/history" style={styles.historyButton}>
            <Text style={styles.historyButtonText}>히스토리 보기</Text>
          </Link>
        </View>

        {/* 상태 영역 */}
        {loading && (
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              실시간 데이터를 불러오는 중입니다…
            </Text>
          </View>
        )}

        {error && !loading && (
          <View style={[styles.infoCard, styles.errorCard]}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={loadLatest} style={styles.retryBtn}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
          </View>
        )}

        {/* 실제 데이터 */}
        {data && !loading && !error && (
          <>
            {/* 요약 카드 */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>
                최종 업데이트: {data.lastUpdated}
              </Text>
              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryTitle}>전체 대상 수</Text>
                  <Text style={styles.summaryNumber}>
                    {data.curTotalCount.toLocaleString()}건
                  </Text>
                  <Text style={styles.summaryDiff}>
                    이전({data.prevSnapshotLabel}){" "}
                    {data.prevTotalCount.toLocaleString()}건
                  </Text>
                </View>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryTitle}>대한민국 관련</Text>
                  <Text style={styles.summaryNumber}>
                    {data.curKrCount.toLocaleString()}건
                  </Text>
                  <Text style={styles.summaryDiff}>
                    이전 {data.prevKrCount.toLocaleString()}건
                  </Text>
                </View>
              </View>
            </View>

            {/* 현재 KR 대상 – 이름만, 카드형으로 여유 있게 */}
            <Section
              title="현재 대한민국 관련 제재 대상"
              caption={`${data.curKrCount.toLocaleString()}건`}
            >
              {data.krCurrent.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  onPress={() => setSelected(p)}
                />
              ))}
              {data.krCurrent.length === 0 && (
                <Text style={styles.emptyText}>
                  현재 등록된 대상이 없습니다.
                </Text>
              )}
            </Section>
          </>
        )}
      </ScrollView>

      {/* 상세 모달 */}
      <Modal
        visible={!!selected}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {selected && (
              <>
                <Text style={styles.modalName}>{selected.name}</Text>
                <Text style={styles.modalField}>
                  구분: {selected.type || "-"}
                </Text>
                {selected.birth ? (
                  <Text style={styles.modalField}>
                    생년월일: {selected.birth}
                  </Text>
                ) : null}
                {selected.country ? (
                  <Text style={styles.modalField}>
                    국적/주소: {selected.country}
                  </Text>
                ) : null}

                {/* 🔹 한국 관련일 때만 OFAC 원문/remark 표시 + 키워드 하이라이트 */}
                {selected.isKorea && (selected.remark || selected.fullText) ? (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>OFAC 원문</Text>
                    {selected.remark ? (
                      <>
                        <Text style={styles.modalLabel}>Remarks</Text>
                        <Text style={styles.modalRemark}>
                          {renderHighlighted(selected.remark)}
                        </Text>
                      </>
                    ) : null}
                    {selected.fullText ? (
                      <>
                        <Text style={styles.modalLabel}>전체 텍스트</Text>
                        <Text style={styles.modalOriginal}>
                          {renderHighlighted(selected.fullText)}
                        </Text>
                      </>
                    ) : null}
                  </View>
                ) : null}

                <Pressable
                  onPress={() => setSelected(null)}
                  style={styles.modalCloseBtn}
                >
                  <Text style={styles.modalCloseText}>닫기</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** 섹션 공통 컴포넌트 */
type SectionProps = {
  title: string;
  caption?: string;
  children: React.ReactNode;
};

const Section = ({ title, caption, children }: SectionProps) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {caption && <Text style={styles.sectionCaption}>{caption}</Text>}
    </View>
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

type PersonRowProps = {
  person: Person;
  onPress: () => void;
};

// 🔹 리스트에서는 이름만, 카드형으로 여유 있게 보여주기
const PersonRow = ({ person, onPress }: PersonRowProps) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.personRow,
      pressed && styles.personRowPressed,
    ]}
  >
    <Text style={styles.personName}>{person.name}</Text>
  </Pressable>
);

// ===== 스타일 =====
const CARD_BG = "#05060B";
const CARD_BORDER = "#262A3D";
const TEXT_PRIMARY = "#F5F7FF";
const TEXT_SECONDARY = "#A4ACC5";
const ACCENT = "#4F8CFF";
const ERROR = "#FF6B6B";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020308",
  },
  scrollInner: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  header: {
    paddingTop: 18,
    paddingBottom: 12,
  },
  appName: {
    fontSize: 12,
    letterSpacing: 3,
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    lineHeight: 18,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    marginTop: 4,
  },
  historyButton: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  historyButtonText: {
    fontSize: 11,
    color: "#050816",
    fontWeight: "600",
  },
  infoCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 12,
    marginBottom: 12,
  },
  infoText: {
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
  errorCard: {
    borderColor: ERROR,
  },
  errorText: {
    fontSize: 13,
    color: ERROR,
    marginBottom: 8,
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: ERROR,
  },
  retryText: {
    fontSize: 12,
    color: "#000",
    fontWeight: "600",
  },
  summaryCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    marginBottom: 18,
  },
  summaryLabel: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 12,
  },
  summaryBox: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#070914",
  },
  summaryTitle: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  summaryNumber: {
    fontSize: 18,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    marginBottom: 3,
  },
  summaryDiff: {
    fontSize: 11,
    color: TEXT_SECONDARY,
  },
  section: {
    marginBottom: 18,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT_PRIMARY,
  },
  sectionCaption: {
    fontSize: 12,
    color: TEXT_SECONDARY,
  },
  sectionBody: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  personRow: {
    marginVertical: 5,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#070914",
    borderWidth: 1,
    borderColor: "#1B1E2C",
  },
  personRowPressed: {
    backgroundColor: "#0B1020",
  },
  personName: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT_PRIMARY,
  },
  emptyText: {
    paddingVertical: 8,
    textAlign: "center",
    fontSize: 12,
    color: TEXT_SECONDARY,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    width: "80%",
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
  },
  modalName: {
    fontSize: 18,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    marginBottom: 8,
  },
  modalField: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  modalSection: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#262A3D",
  },
  modalSectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  modalLabel: {
    fontSize: 11,
    color: TEXT_SECONDARY,
    marginTop: 4,
    marginBottom: 2,
  },
  modalRemark: {
    fontSize: 12,
    color: TEXT_PRIMARY,
    lineHeight: 18,
  },
  modalOriginal: {
    fontSize: 11,
    color: TEXT_SECONDARY,
    lineHeight: 16,
  },
  highlightText: {
    backgroundColor: "#facc15",
    color: "#000",
    fontWeight: "700",
  },
  modalCloseBtn: {
    marginTop: 14,
    alignSelf: "flex-end",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: ACCENT,
  },
  modalCloseText: {
    fontSize: 12,
    color: "#000",
    fontWeight: "600",
  },
});
