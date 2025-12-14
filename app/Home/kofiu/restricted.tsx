// app/Home/kofiu/restricted.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { API_BASE_URL } from "../../../constants/api";

type RestrictedItem = {
  name: string;
  birth?: string;
  country?: string;
};

export default function RestrictedScreen() {
  const [data, setData] = useState<RestrictedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");

  const fetchRestricted = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/kofiu/restricted/latest`);
      const json = await res.json();

      if (Array.isArray(json.data)) {
        setData(json.data);
      } else {
        setData([]);
      }
    } catch (err) {
      console.error("Restricted fetch error:", err);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRestricted();
  }, []);

  const filtered = useMemo(() => {
    const lower = keyword.toLowerCase().trim();
    if (!lower) return data;
    return data.filter((item) => item.name.toLowerCase().includes(lower));
  }, [keyword, data]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>실시간 데이터를 불러오는 중입니다…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <Text style={styles.appName}>AML MONITOR</Text>
        <Text style={styles.title}>금융거래 등 제한 대상자</Text>
        <Text style={styles.subtitle}>
          KoFIU 공지사항 기반으로{"\n"}
          금융거래제한 대상자(테러·제재 관련)를 요약해서 보여줍니다.
        </Text>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            전체 {data.length.toLocaleString()}명
          </Text>
          <Text style={styles.summaryText}>
            검색 결과 {filtered.length.toLocaleString()}명
          </Text>
        </View>

        {/* 검색창 */}
        <TextInput
          style={styles.search}
          placeholder="이름으로 검색"
          placeholderTextColor="#6B7280"
          value={keyword}
          onChangeText={setKeyword}
        />
      </View>

      {/* 리스트 */}
      <FlatList
        data={filtered}
        keyExtractor={(_, index) => index.toString()}
        contentContainerStyle={styles.listContent}
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
              {metaParts.length > 0 && (
                <Text style={styles.meta}>{metaParts.join(" · ")}</Text>
              )}
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const BG = "#020617";            // 전체 배경 – 짙은 남색
const CARD_BG = "#0B1120";       // 카드 배경
const CARD_BORDER = "#1F2937";   // 카드 보더
const TEXT_PRIMARY = "#F9FAFB";  // 메인 텍스트
const TEXT_SECONDARY = "#9CA3AF"; // 서브 텍스트
const ACCENT = "#4F8CFF";        // 포인트 컬러

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: TEXT_SECONDARY,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  appName: {
    fontSize: 11,
    letterSpacing: 3,
    color: TEXT_SECONDARY,
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    lineHeight: 18,
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  summaryText: {
    fontSize: 12,
    color: TEXT_SECONDARY,
  },
  search: {
    backgroundColor: "#020617",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: TEXT_PRIMARY,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 4,
  },
  rowCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8, // 🔹 기존보다 더 컴팩트하게
  },
  name: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    marginBottom: 2,
  },
  meta: {
    fontSize: 12,
    color: TEXT_SECONDARY,
  },
  separator: {
    height: 6, // 🔹 카드 간격 줄이기
  },
});
