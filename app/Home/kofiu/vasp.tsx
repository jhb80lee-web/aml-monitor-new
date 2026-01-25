// app/Home/kofiu/vasp.tsx
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
import BottomTabBar from "../../../components/BottomTabBar";

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
        {item.ceo ? <Text style={styles.ceoText}>대표자 {item.ceo}</Text> : null}
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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.inner}
        showsVerticalScrollIndicator={false}
      >
        {/* ✅ 상단 헤더 (KoFIU 홈과 동일 톤) */}
        <View style={styles.header}>
          <Text style={styles.appName}>AML MONITOR</Text>
          <Text style={styles.title}>가상자산사업자 신고현황</Text>

          {meta.updatedAt ? (
            <Text style={styles.subtitle}>기준일 {meta.updatedAt.slice(0, 10)}</Text>
          ) : null}
          {/* ✅ "총 OO개사" 삭제 */}
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
  <>
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>정상 신고</Text>
        <Text style={styles.sectionCount}>-</Text>
      </View>
      <View style={styles.sectionBody}>
        <View style={styles.listLoading}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>불러오는 중…</Text>
        </View>
      </View>
    </View>

    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>미갱신 사업자</Text>
        <Text style={styles.sectionCount}>-</Text>
      </View>
      <View style={styles.sectionBody}>
        <View style={styles.listLoading}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>불러오는 중…</Text>
        </View>
      </View>
    </View>
  </>
)}
        {!loading && error && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && (
          <>
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>정상 신고</Text>
                <Text style={styles.sectionCount}>
                  {filteredNormal.length.toLocaleString()}개사
                </Text>
              </View>
              <View style={styles.sectionBody}>{filteredNormal.map(renderNormalRow)}</View>
            </View>

            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>미갱신 사업자</Text>
                <Text style={styles.sectionCount}>
                  {filteredExpired.length.toLocaleString()}개사
                </Text>
              </View>
              <View style={styles.sectionBody}>{filteredExpired.map(renderExpiredRow)}</View>
            </View>
          </>
        )}
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

// ===== 색상 팔레트 =====
const BG = "#020617";
const CARD_BG = "#0B1120";
const CARD_BORDER = "#1F2937";
const TEXT_PRIMARY = "#F9FAFB";
const TEXT_SECONDARY = "#9CA3AF";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },
  inner: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 130 },
listLoading: { paddingVertical: 24, alignItems: "center" },
  // ✅ (추가) KoFIU/OFAC/UN과 동일한 헤더 톤
  header: { paddingBottom: 10 },
  appName: {
    fontSize: 11,
    letterSpacing: 3,
    color: "rgba(234,240,255,0.55)",
    marginBottom: 6,
  },
  title: { fontSize: 26, fontWeight: "900", color: "#EAF0FF" },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: "rgba(234,240,255,0.70)",
    lineHeight: 18,
  },

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

  sectionCard: {
    backgroundColor: CARD_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitle: { color: TEXT_PRIMARY, fontSize: 14, fontWeight: "700" },
  sectionCount: { color: TEXT_SECONDARY, fontSize: 12 },
  sectionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CARD_BORDER,
    marginTop: 6,
  },

  row: {
    paddingVertical: 6,
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
  ceoText: { color: TEXT_SECONDARY, fontSize: 11 },
  serviceText: { color: TEXT_SECONDARY, fontSize: 12, marginTop: 2 },
  expiredCompanyText: { color: TEXT_SECONDARY, fontSize: 12 },

  center: { alignItems: "center", marginTop: 40 },
  loadingText: { color: TEXT_SECONDARY, marginTop: 8, fontSize: 13 },
  errorText: { color: "#F97373", fontSize: 13 },
});
