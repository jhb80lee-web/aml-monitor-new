// app/Home/kofiu/restricted.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { API_BASE_URL } from "../../../constants/api";
import BottomTabBar from "../../../components/BottomTabBar";

type RestrictedItem = {
  name: string;
  birth?: string;
  country?: string;
};

type RestrictedLatestResponse = {
  updatedAt?: string;
  total?: number;
  data: RestrictedItem[];
};

function formatDateOnly(value?: string) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "-";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function RestrictedScreen() {
  console.warn("🚨🚨🚨 RestrictedScreen RENDER", Date.now());

  const [data, setData] = useState<RestrictedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");

  // ✅ 기준일(yyyy-mm-dd)
  const [baseDate, setBaseDate] = useState<string>("-");

  const fetchRestricted = useCallback(async () => {
    try {
      setLoading(true);

      console.log("[Restricted] API_BASE_URL =", API_BASE_URL);

      // ✅ 캐시 무력화 (CDN/프록시/기기 캐시 의심 시 가장 확실)
      const url = `${API_BASE_URL}/kofiu/restricted/latest?ts=${Date.now()}`;
      console.log("[Restricted] GET =", url);

      const res = await fetch(url);
      console.log(
        "[Restricted] status =",
        res.status,
        "content-type =",
        res.headers.get("content-type")
      );

      // ✅ 응답이 JSON이 아닐 때(HTML/에러문구)도 내용 앞부분을 볼 수 있게 raw로 먼저 받기
      const raw = await res.text();
      console.log("[Restricted] raw head =", raw.slice(0, 200));

      const json = JSON.parse(raw) as RestrictedLatestResponse;
      console.log(
        "[Restricted] parsed updatedAt =",
        json?.updatedAt,
        "total =",
        json?.total,
        "len =",
        json?.data?.length
      );

      setBaseDate(formatDateOnly(json?.updatedAt));
      setData(Array.isArray(json?.data) ? json.data : []);
    } catch (err) {
      console.error("Restricted fetch error:", err);
      setBaseDate("-");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ (핵심) 화면 “포커스” 될 때마다 새로고침
  useFocusEffect(
    useCallback(() => {
      console.warn("🚨🚨🚨 RestrictedScreen FOCUS -> refetch");
      fetchRestricted();
      return () => {};
    }, [fetchRestricted])
  );

  const filtered = useMemo(() => {
    const lower = keyword.toLowerCase().trim();
    if (!lower) return data;
    return data.filter((item) => (item.name ?? "").toLowerCase().includes(lower));
  }, [keyword, data]);

  return (
    <SafeAreaView style={styles.container}>
      {/* ✅ 헤더 */}
      <View style={styles.header}>
        <Text style={styles.appName}>AML MONITOR</Text>
        <Text style={styles.title}>금융거래 등 제한 대상자</Text>
        <Text style={styles.subtitle}>
          KoFIU 공지사항 기반으로{"\n"}
          금융거래제한 대상자(테러·제재 관련)를 요약해서 보여줍니다.
        </Text>

        {/* ✅ 기준일 + 검색결과 */}
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>기준일 {baseDate}</Text>
          <Text style={styles.summaryText}>
            검색 결과 {filtered.length.toLocaleString()}명
          </Text>
        </View>

        <TextInput
          style={styles.search}
          placeholder="이름으로 검색"
          placeholderTextColor="#63708D"
          value={keyword}
          onChangeText={setKeyword}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={loading ? [] : filtered}
        keyExtractor={(_, index) => index.toString()}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const birth = item.birth?.trim();
          const country = item.country?.trim();

          const hasBirth = !!birth && birth !== "-";
          const hasCountry = !!country && country !== "-";

          const metaParts: string[] = [];
          if (hasBirth) metaParts.push(`생년월일 ${birth}`);
          if (hasCountry) metaParts.push(country);

          return (
            <View style={styles.rowCard}>
              <Text style={styles.name}>{item.name}</Text>
              {metaParts.length > 0 && <Text style={styles.meta}>{metaParts.join(" · ")}</Text>}
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          loading ? (
            <View style={styles.listLoading}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>불러오는 중…</Text>
            </View>
          ) : (
            <View style={styles.listLoading}>
              <Text style={styles.loadingText}>표시할 항목이 없습니다.</Text>
            </View>
          )
        }
      />

      {/* ✅ 여기서 active prop 절대 넣지 말기 */}
      <BottomTabBar />
    </SafeAreaView>
  );
}

const BG = "#020617";
const CARD_BG = "#0B1120";
const CARD_BORDER = "#1F2937";
const TEXT_PRIMARY = "#F9FAFB";
const TEXT_SECONDARY = "#9CA3AF";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  header: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 10 },
  appName: { fontSize: 11, letterSpacing: 3, color: "rgba(234,240,255,0.55)", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "900", color: "#EAF0FF" },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: "rgba(234,240,255,0.70)",
    lineHeight: 18,
    marginBottom: 10,
  },

  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  summaryText: { fontSize: 12, color: "rgba(234,240,255,0.65)", fontWeight: "700" },

  search: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: TEXT_PRIMARY,
  },

  listContent: { paddingHorizontal: 18, paddingBottom: 130, paddingTop: 4 },

  listLoading: { paddingVertical: 24, alignItems: "center" },
  loadingText: { marginTop: 10, fontSize: 14, color: TEXT_SECONDARY },

  rowCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  name: { fontSize: 15, fontWeight: "600", color: TEXT_PRIMARY, marginBottom: 2 },
  meta: { fontSize: 12, color: TEXT_SECONDARY },
  separator: { height: 6 },
});
