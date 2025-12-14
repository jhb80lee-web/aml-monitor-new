// app/Home/watchlist/index.tsx
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { API_BASE_URL } from "../../../constants/api";

type BaseEntry = {
  id: string;
  uid?: string;
  type?: string;
  name: string;
  birth?: string;
  country?: string;
  isKorea?: boolean;
  // VASP 전용
  no?: number;
  service?: string;
  company?: string;
  ceo?: string;
};

type SourceKey = "vasp" | "restricted" | "ofac" | "un";

type SearchResultBySource = Record<SourceKey, BaseEntry[]>;

type LatestResponse<T> = {
  updatedAt: string;
  total: number;
  data: T[];
};

// 🔹 여기 추가!
type VaspLatestResponse = {
  updatedAt: string;
  total: number;
  normal?: BaseEntry[];
  expired?: BaseEntry[];
};

// South Korea 판별 (UN/OFAC 공통)
function isSouthKoreaEntry(entry: BaseEntry): boolean {
  const text =
    `${entry.country ?? ""} ${entry.name ?? ""}`.toLowerCase();

  if (!text.includes("korea")) return false;

  const hasSouthKorea =
    text.includes("korea, south") ||
    text.includes("south korea") ||
    text.includes("republic of korea") ||
    text.includes("seoul");

  const isNorthKorea =
    text.includes("korea, north") ||
    text.includes("north korea") ||
    text.includes("democratic people's republic of korea");

  return hasSouthKorea && !isNorthKorea;
}

export default function WatchlistSearchScreen() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResultBySource>({
    vasp: [],
    restricted: [],
    ofac: [],
    un: [],
  });
  const [updatedAt, setUpdatedAt] = useState<
    Partial<Record<SourceKey, string>>
  >({});

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    try {
      setLoading(true);
      Keyboard.dismiss();

      const [vaspRes, restrictedRes, ofacRes, unRes] = await Promise.all([
        fetch(`${API_BASE_URL}/kofiu/vasp/latest`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/kofiu/restricted/latest`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/ofac/sdn/korea`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/un/korea`).then((r) => r.json()),
      ]);

      const q = trimmed.toLowerCase();

            const nextResults: SearchResultBySource = {
        vasp: [],
        restricted: [],
        ofac: [],
        un: [],
      };

      // 🔹 VASP: normal + expired를 합쳐서 검색
      const vaspLatest = vaspRes as VaspLatestResponse;
      const vaspCombined = [
        ...(vaspLatest.normal ?? []),
        ...(vaspLatest.expired ?? []),
      ].map((item, idx) => ({
  ...item,
  // 마지막에 오는 id가 최종 값이 됨
  id: String(item.id ?? item.uid ?? item.no ?? idx),
}));

      nextResults.vasp = vaspCombined.filter((item) => {
        const text = `${item.service ?? ""} ${item.company ?? ""} ${
          item.ceo ?? ""
        }`.toLowerCase();
        return text.includes(q);
      });

      // 🔹 나머지 세 개는 기존처럼 data 배열에서 꺼내기
      const restrictedData =
        (restrictedRes as LatestResponse<BaseEntry>).data || [];
      const ofacDataRaw =
        (ofacRes as LatestResponse<BaseEntry>).data || [];
      const unDataRaw =
        (unRes as LatestResponse<BaseEntry>).data || [];

      // 금융거래제한 대상자
      nextResults.restricted = restrictedData.filter((item) => {
        const text = `${item.name ?? ""} ${item.birth ?? ""} ${
          item.country ?? ""
        }`.toLowerCase();
        return text.includes(q);
      });

      // OFAC – South Korea만 남기고 검색
      const ofacData = ofacDataRaw.filter(isSouthKoreaEntry);
      nextResults.ofac = ofacData.filter((item) => {
        const text = `${item.name ?? ""} ${item.birth ?? ""} ${
          item.country ?? ""
        }`.toLowerCase();
        return text.includes(q);
      });

      // UN – South Korea만 남기고 검색
      const unData = unDataRaw.filter(isSouthKoreaEntry);
      nextResults.un = unData.filter((item) => {
        const text = `${item.name ?? ""} ${item.birth ?? ""} ${
          item.country ?? ""
        }`.toLowerCase();
        return text.includes(q);
      });


      setResults(nextResults);
      setUpdatedAt({
        vasp: (vaspRes as LatestResponse<BaseEntry>).updatedAt,
        restricted: (restrictedRes as LatestResponse<BaseEntry>).updatedAt,
        ofac: (ofacRes as LatestResponse<BaseEntry>).updatedAt,
        un: (unRes as LatestResponse<BaseEntry>).updatedAt,
      });
    } catch (e) {
      console.log("🔍 WatchList 검색 실패", e);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const totalCount =
    results.vasp.length +
    results.restricted.length +
    results.ofac.length +
    results.un.length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>WatchList 통합 검색</Text>
        <Text style={styles.subtitle}>
          이름 / 서비스명 / 회사명 / 국가 키워드로{"\n"}
          VASP · 금융거래제한 · OFAC · UN을 한 번에 조회합니다.
        </Text>

        <View style={styles.searchBox}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="예: 홍길동, 업비트, Seoul, Republic of Korea"
            placeholderTextColor="#6B7280"
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleSearch}
          />
          <Pressable
            style={styles.searchButton}
            onPress={handleSearch}
          >
            {loading ? (
              <ActivityIndicator />
            ) : (
              <Text style={styles.searchButtonText}>검색</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>검색 결과 요약</Text>
          <Text style={styles.summaryText}>
            전체: <Text style={styles.summaryNumber}>{totalCount}</Text> 건
          </Text>
          <Text style={styles.summaryText}>
            · VASP:{" "}
            <Text style={styles.summaryNumber}>
              {results.vasp.length}
            </Text>{" "}
            건{updatedAt.vasp ? `  (기준일: ${updatedAt.vasp})` : ""}
          </Text>
          <Text style={styles.summaryText}>
            · 금융거래제한대상자:{" "}
            <Text style={styles.summaryNumber}>
              {results.restricted.length}
            </Text>{" "}
            건
            {updatedAt.restricted
              ? `  (기준일: ${updatedAt.restricted})`
              : ""}
          </Text>
          <Text style={styles.summaryText}>
            · OFAC (South Korea):{" "}
            <Text style={styles.summaryNumber}>
              {results.ofac.length}
            </Text>{" "}
            건{updatedAt.ofac ? `  (기준일: ${updatedAt.ofac})` : ""}
          </Text>
          <Text style={styles.summaryText}>
            · UN (South Korea):{" "}
            <Text style={styles.summaryNumber}>
              {results.un.length}
            </Text>{" "}
            건{updatedAt.un ? `  (기준일: ${updatedAt.un})` : ""}
          </Text>
        </View>

        <Section
          title="VASP (가상자산사업자 신고현황)"
          count={results.vasp.length}
          entries={results.vasp}
          renderLine={(item) =>
            `No.${item.no ?? "-"}  ${item.service ?? ""} / ${
              item.company ?? ""
            } / 대표: ${item.ceo ?? "-"}`
          }
        />

        <Section
          title="금융거래 등 제한대상자 (KoFIU)"
          count={results.restricted.length}
          entries={results.restricted}
          renderLine={(item) =>
            `${item.name ?? ""} ${
              item.birth ? "(" + item.birth + ")" : ""
            }  ${item.country ?? ""}`
          }
        />

        <Section
          title="OFAC SDN (South Korea 관련)"
          count={results.ofac.length}
          entries={results.ofac}
          renderLine={(item) =>
            `${item.name ?? ""} ${
              item.birth ? "(" + item.birth + ")" : ""
            }  ${item.country ?? ""}`
          }
        />

        <Section
          title="UN 제재 리스트 (South Korea 관련)"
          count={results.un.length}
          entries={results.un}
          renderLine={(item) =>
            `${item.name ?? ""} ${
              item.birth ? "(" + item.birth + ")" : ""
            }  ${item.country ?? ""}`
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}

type SectionProps = {
  title: string;
  count: number;
  entries: BaseEntry[];
  renderLine: (item: BaseEntry) => string;
};

function Section({ title, count, entries, renderLine }: SectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}건</Text>
      </View>
      {entries.length === 0 ? (
        <Text style={styles.sectionEmpty}>검색 결과가 없습니다.</Text>
      ) : (
        entries.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowDetail}>{renderLine(item)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#F9FAFB",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#9CA3AF",
    marginBottom: 16,
    lineHeight: 18,
  },
  searchBox: {
    flexDirection: "row",
    marginBottom: 12,
  },
  input: {
    flex: 1,
    backgroundColor: "#0F172A",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#F9FAFB",
    fontSize: 14,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  searchButton: {
    width: 80,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  searchButtonText: {
    color: "#F9FAFB",
    fontSize: 14,
    fontWeight: "600",
  },
  summaryCard: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#E5E7EB",
    marginBottom: 4,
  },
  summaryText: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  summaryNumber: {
    fontWeight: "700",
    color: "#FACC15",
  },
  section: {
    backgroundColor: "#020617",
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#E5E7EB",
  },
  sectionCount: {
    fontSize: 13,
    color: "#9CA3AF",
  },
  sectionEmpty: {
    fontSize: 12,
    color: "#6B7280",
  },
  row: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#111827",
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#F9FAFB",
    marginBottom: 2,
  },
  rowDetail: {
    fontSize: 11,
    color: "#9CA3AF",
    lineHeight: 16,
  },
});
