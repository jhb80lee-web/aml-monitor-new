import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { API_BASE_URL } from "../../../constants/api";

// 정상 사업자
type VaspItem = {
  no: number;
  service: string;
  company: string;
  ceo?: string;
};

// 미갱신 사업자
type VaspExpiredItem = {
  no: number;
  service: string;
  company: string;
};

type VaspApiResponse = {
  source?: string;
  updatedAt?: string;
  total?: number;
  normal?: VaspItem[];
  expired?: VaspExpiredItem[];
  expiredNote?: string;
};

export default function VaspScreen() {
  const [normal, setNormal] = useState<VaspItem[]>([]);
  const [expired, setExpired] = useState<VaspExpiredItem[]>([]);
  const [meta, setMeta] = useState({
    updatedAt: "",
    total: 0,
    source: "",
  });

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/kofiu/vasp/latest`);
        const json: VaspApiResponse = await res.json();

        setNormal(json.normal || []);
        setExpired(json.expired || []);

        setMeta({
          updatedAt: json.updatedAt || "",
          total: json.total || 0,
          source: json.source || "",
        });
      } catch (err: any) {
        setError(err?.message || "데이터 로드 실패");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const filteredNormal = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return normal;

    return normal.filter(
      (v) =>
        v.company.toLowerCase().includes(q) ||
        v.service.toLowerCase().includes(q)
    );
  }, [search, normal]);

  const filteredExpired = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return expired;

    return expired.filter(
      (v) =>
        v.company.toLowerCase().includes(q) ||
        v.service.toLowerCase().includes(q)
    );
  }, [search, expired]);

  const renderNormalRow = (item: VaspItem) => (
    <View key={item.no} style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.companyText}>{item.company}</Text>
        {item.ceo ? (
          <Text style={styles.ceoText}>대표자 {item.ceo}</Text>
        ) : null}
      </View>
      <Text style={styles.serviceText}>{item.service}</Text>
    </View>
  );

  const renderExpiredRow = (item: VaspExpiredItem) => (
    <View key={item.no} style={styles.row}>
      <Text style={styles.expiredCompanyText}>
        {item.company}
        {item.service ? ` · ${item.service}` : ""}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.inner}>
        {/* 상단 요약 카드 */}
        <View style={styles.headerCard}>
          <Text style={styles.appName}>AML MONITOR</Text>
          <Text style={styles.title}>가상자산사업자 신고현황</Text>
          {meta.updatedAt ? (
            <Text style={styles.subText}>
              기준일 {meta.updatedAt.slice(0, 10)}
            </Text>
          ) : null}
          <Text style={styles.subText}>총 {meta.total}개사</Text>
        </View>

        {/* 검색 */}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="회사명 / 서비스명 검색"
          placeholderTextColor={TEXT_SECONDARY}
          style={styles.search}
        />

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
            <Text style={styles.loadingText}>불러오는 중…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && (
          <>
            {/* ✅ 정상 신고 카드 */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>정상 신고</Text>
                <Text style={styles.sectionCount}>
                  {filteredNormal.length.toLocaleString()}개사
                </Text>
              </View>

              <View style={styles.sectionBody}>
                {filteredNormal.map(renderNormalRow)}
              </View>
            </View>

            {/* ✅ 미갱신 카드 (위 카드와 여백으로 구분) */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>미갱신 사업자</Text>
                <Text style={styles.sectionCount}>
                  {filteredExpired.length.toLocaleString()}개사
                </Text>
              </View>

              <View style={styles.sectionBody}>
                {filteredExpired.map(renderExpiredRow)}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ===== 색상 팔레트 (짙은 남색 계열) =====
const BG = "#020617";
const CARD_BG = "#0B1120";
const CARD_BORDER = "#1F2937";
const TEXT_PRIMARY = "#F9FAFB";
const TEXT_SECONDARY = "#9CA3AF";
const ACCENT = "#4F8CFF";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },
  inner: { padding: 16, paddingBottom: 24 },

  headerCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  appName: {
    fontSize: 11,
    letterSpacing: 3,
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  title: { color: TEXT_PRIMARY, fontSize: 18, fontWeight: "700" },
  subText: { color: TEXT_SECONDARY, marginTop: 4, fontSize: 12 },

  search: {
    backgroundColor: BG,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    color: TEXT_PRIMARY,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    marginBottom: 16,
    fontSize: 14,
  },

  // 섹션 카드 (정상 / 미갱신 공통)
  sectionCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12, // 이 여백이 사실상의 "구분선" 역할
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitle: {
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "700",
  },
  sectionCount: {
    color: TEXT_SECONDARY,
    fontSize: 12,
  },
  sectionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CARD_BORDER,
    marginTop: 6,
  },

  // 각 row
  row: {
    paddingVertical: 6, // 컴팩트하게
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CARD_BORDER,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  companyText: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    fontWeight: "600",
    flex: 1,
    marginRight: 6,
  },
  ceoText: {
    color: TEXT_SECONDARY,
    fontSize: 11,
  },
  serviceText: {
    color: TEXT_SECONDARY,
    fontSize: 12,
    marginTop: 2,
  },
  expiredCompanyText: {
    color: TEXT_SECONDARY,
    fontSize: 12,
  },

  center: { alignItems: "center", marginTop: 40 },
  loadingText: { color: TEXT_SECONDARY, marginTop: 8, fontSize: 13 },
  errorText: { color: "#F97373", fontSize: 13 },
});
