// app/Home/un/index.tsx
import { Link } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE_URL } from "../../../constants/api";

type Person = {
  id: string;
  uid: string;
  type: string; // "Individual" | "Entity"
  name: string;
  birth: string;
  country: string;
  isKorea: boolean;
  remark?: string;
  fullText?: string;
};

type UnLatestApi = {
  updatedAt: string;
  total: number;
  data: Person[];
};

type UnView = {
  lastUpdated: string;
  totalCount: number;
  krCount: number;
  krList: Person[];
};

// 🔹 UN isKorea와 맞게 한국 관련 키워드
const KOREA_KEYWORDS = [
  "south korea",
  "republic of korea",
  "korea, south",
  "south korean",
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

export default function UnScreen() {
  const [data, setData] = useState<UnView | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Person | null>(null);

  const loadLatest = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

const res = await fetch(`${API_BASE_URL}/un/sdn/latest`);

if (!res.ok) {
  throw new Error(
    `UN 제재 리스트 조회에 실패했습니다. (HTTP ${res.status})`
  );
}
      const json = (await res.json()) as UnLatestApi;
      const krList = (json.data || []).filter((p) => p.isKorea);

      setData({
        lastUpdated: json.updatedAt,
        totalCount: json.total,
        krCount: krList.length,
        krList,
      });
    } catch (e: any) {
      console.log("UN latest fetch 에러:", e);
      setError(e?.message ?? "UN 제재 리스트 조회 중 오류가 발생했습니다.");
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
          <Text style={styles.title}>UN 제재 리스트</Text>
          <Text style={styles.subtitle}>
            UN 안보리 Consolidated Sanctions List 기준으로{"\n"}
            전체 / 대한민국 관련 제재 현황을 요약해서 보여줍니다.
          </Text>
        </View>

        {/* 상단 네비: 오른쪽에만 버튼형 "히스토리" */}
        <View style={styles.navRow}>
          <View style={{ flex: 1 }} />
          <Link href="/Home/un/history" style={styles.historyButton}>
            <Text style={styles.historyButtonText}>히스토리 보기</Text>
          </Link>
        </View>

        {/* 상태 영역 */}
        {loading && (
          <View style={styles.infoCard}>
            <ActivityIndicator />
            <Text style={[styles.infoText, { marginTop: 6 }]}>
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
                기준일시: {data.lastUpdated}
              </Text>
              <View style={styles.summaryRow}>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryTitle}>전체 UN 제재 대상</Text>
                  <Text style={styles.summaryNumber}>
                    {data.totalCount.toLocaleString()}건
                  </Text>
                  <Text style={styles.summaryDiff}>변동 정보 없음</Text>
                </View>
                <View style={styles.summaryBox}>
                  <Text style={styles.summaryTitle}>대한민국 관련</Text>
                  <Text style={styles.summaryNumber}>
                    {data.krCount.toLocaleString()}건
                  </Text>
                  <Text style={styles.summaryDiff}>변동 정보 없음</Text>
                </View>
              </View>
            </View>

            {/* 대한민국 관련 리스트 (이름만) */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>
                  대한민국 관련 UN 제재 대상
                </Text>
                <Text style={styles.sectionCaption}>
                  {data.krCount.toLocaleString()}건
                </Text>
              </View>

              <View style={styles.sectionBody}>
                {data.krCount === 0 && (
                  <Text style={styles.emptyText}>
                    현재 대한민국 관련으로 식별된 대상이 없습니다.
                  </Text>
                )}

                {data.krList.map((p) => (
                  <Pressable
                    key={p.uid}
                    onPress={() => setSelected(p)}
                    style={({ pressed }) => [
                      styles.personRow,
                      pressed && styles.personRowPressed,
                    ]}
                  >
                    <Text style={styles.personName}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
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
                <Text style={styles.modalField}>UID: {selected.uid}</Text>
                <Text style={styles.modalField}>구분: {selected.type}</Text>
                {selected.birth ? (
                  <Text style={styles.modalField}>
                    생년월일: {selected.birth}
                  </Text>
                ) : null}
                {selected.country ? (
                  <Text style={styles.modalField}>
                    국가/주소: {selected.country}
                  </Text>
                ) : null}

                {/* 🔹 한국 관련일 때만 UN 원문/코멘트 표시 + 하이라이트 */}
                {selected.isKorea && (selected.remark || selected.fullText) ? (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>UN 원문</Text>
                    {selected.remark ? (
                      <>
                        <Text style={styles.modalLabel}>
                          설명(Comments)
                        </Text>
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
    alignItems: "center",
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
    paddingVertical: 6,
  },
  personRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#1B1E2C",
  },
  personRowPressed: {
    backgroundColor: "#0B1020",
  },
  personName: {
    fontSize: 14,
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
