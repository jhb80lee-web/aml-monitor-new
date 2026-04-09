// app/Home/watchlist/index.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";

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
import { Ionicons } from "@expo/vector-icons";
import { API_BASE_URL } from "../../../constants/api";
import BottomTabBar from "../../../components/BottomTabBar";

type BaseEntry = {
  id: string;
  uid?: string;
  type?: string;
  name: string;
  rawText?: string;
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

// VASP 최신 응답 (normal/expired 분리)
type VaspLatestResponse = {
  updatedAt: string;
  total: number;
  normal?: BaseEntry[];
  expired?: BaseEntry[];
};

const FUZZY_MATCH_THRESHOLD = 0.9;

// South Korea 판별 (UN/OFAC 공통)
function isSouthKoreaEntry(entry: BaseEntry): boolean {
  const text = `${entry.country ?? ""} ${entry.name ?? ""}`.toLowerCase();
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

const makeEmptyResults = (): SearchResultBySource => ({
  vasp: [],
  restricted: [],
  ofac: [],
  un: [],
});

/**
 * ✅ 검색 정규화: 대소문자/공백/하이픈/쉼표/괄호 등 특수문자 무시
 * - 가능한 경우: 모든 유니코드 "문자/숫자"만 남김
 * - 환경이 유니코드 Property Escape(\p{L})를 지원하지 않으면 fallback 정규식 사용
 */
let NON_WORD_RE: RegExp;
try {
  NON_WORD_RE = new RegExp("[^\\p{L}\\p{N}]+", "gu");
} catch {
  // fallback: 영문/숫자/한글 외 문자 제거 (구형 엔진 대비)
  NON_WORD_RE = /[^a-z0-9가-힣]+/gi;
}

function normalizeForSearch(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(NON_WORD_RE, ""); // 공백/특수문자 제거
}

function splitRawTerms(value: string) {
  return String(value ?? "")
    .split(/[\s,./()\-_[\]{}]+/g)
    .map((part) => normalizeForSearch(part))
    .filter(Boolean);
}

function buildSearchCandidates(values: (string | undefined)[]) {
  const out = new Set<string>();

  for (const value of values) {
    const full = normalizeForSearch(value ?? "");
    if (full) out.add(full);

    const terms = splitRawTerms(value ?? "");
    for (const term of terms) {
      if (term) out.add(term);
    }
  }

  return [...out];
}

function buildBigramCounts(value: string) {
  const counts = new Map<string, number>();
  if (value.length < 2) return counts;

  for (let i = 0; i < value.length - 1; i += 1) {
    const key = value.slice(i, i + 2);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function diceCoefficient(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const aCounts = buildBigramCounts(a);
  const bCounts = buildBigramCounts(b);
  let overlap = 0;

  for (const [key, countA] of aCounts.entries()) {
    const countB = bCounts.get(key) ?? 0;
    overlap += Math.min(countA, countB);
  }

  return (2 * overlap) / ((a.length - 1) + (b.length - 1));
}

function isFuzzyCandidateMatch(query: string, candidate: string, threshold = FUZZY_MATCH_THRESHOLD) {
  if (!query || !candidate) return false;
  if (candidate.includes(query) || query.includes(candidate)) return true;

  if (query.length < 3 || candidate.length < 3) {
    return false;
  }

  return diceCoefficient(query, candidate) >= threshold;
}

function createSearchMatcher(rawQuery: string, threshold = FUZZY_MATCH_THRESHOLD) {
  const query = normalizeForSearch(rawQuery);

  return (values: (string | undefined)[]) => {
    const candidates = buildSearchCandidates(values);
    return candidates.some((candidate) =>
      isFuzzyCandidateMatch(query, candidate, threshold)
    );
  };
}

function formatRestrictedName(value?: string) {
  let t = String(value || "")
    .replace(/\r/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!t) return "-";

  t = t.replace(/^\d+\.\s*/, "").trim();

  const hardCutPatterns = [
    /\s*;\s*(?=DOB\b|alt\.\s*DOB\b|POB\b|nationality\b|citizen\b|Gender\b|Passport\b|National ID\b)/i,
    /\s*;\s*(?=Business Registration Number\b|Registration Number\b|Tax ID\b|Company Number\b)/i,
    /\s*;\s*(?=Website\b|SWIFT\/BIC\b|Organization Established Date\b|Target Type\b)/i,
    /\s*\(\s*(?=a\.k\.a\.?\b|aka\b|f\.k\.a\.?\b|formerly known as\b|d\.b\.a\.?\b|trading as\b|linked to\b|linked with\b)/i,
    /\.\s*(?=Identification Number\b|Taken part\b|Maintained by\b|Managed by\b|Operated by\b|Owned by\b|Run by\b|Affiliated with\b|Located at\b|Located in\b)/i,
  ];

  for (const re of hardCutPatterns) {
    const m = t.match(re);
    if (m && m.index != null) {
      t = t.slice(0, m.index).trim();
    }
  }

  t = t
    .replace(
      /\s*\((?:a\.k\.a\.?\b|aka\b|f\.k\.a\.?\b|formerly known as\b|d\.b\.a\.?\b|trading as\b|linked to\b|linked with\b)[^)]*\)\s*$/gi,
      ""
    )
    .replace(/(?:\s*\[[^\]]+\]\s*\.?)+$/g, "")
    .replace(/\s*\((?:individual|entity|vessel|aircraft)\)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const corpSuffixRe =
    /^(?:llc|l\.l\.c\.|limited|ltd|l\.t\.d\.|inc|inc\.|incorporated|corp|corp\.|corporation|co|co\.|company|plc|p\.l\.c\.|sa|s\.a\.|ag|gmbh|pte|pte\.|lp|l\.p\.|llp|l\.l\.p\.|nv|n\.v\.|spa|s\.p\.a\.)$/i;
  const addressLeadRe =
    /^(?:\d|p\.?\s*o\.?\s*box\b|post office box\b|room\b|suite\b|ste\.?\b|floor\b|building\b|bldg\.?\b|house\b|apartment\b|apt\.?\b|office\b|unit\b|no\.?\b|street\b|st\.?\b|road\b|rd\.?\b|avenue\b|ave\.?\b|boulevard\b|blvd\.?\b|lane\b|ln\.?\b|drive\b|dr\.?\b|parkway\b|pkwy\b|way\b|plaza\b|tower\b|center\b|centre\b|highway\b|hwy\b)/i;
  const locationLikeRe =
    /^(?:[A-Z][A-Za-z.'-]*|[A-Z]{2,})(?:\s+(?:[A-Z][A-Za-z.'-]*|[A-Z]{2,})){0,5}$/;
  const nameHasEntityKwRe =
    /\b(?:llc|limited|ltd|inc|corp|corporation|company|companies|group|groups|foundation|foundations|fund|funds|bank|banks|exchange|exchanges|telecommunication|telecommunications|communication|communications|trading|investment|investments|holding|holdings|organization|organizations|enterprise|enterprises|service|services|industry|industries|committee|bureau|agency|administration|center|centre|association|trust|trusts|movement|movements|front|army|network|networks|telephone|telephones|remittance|remittances)\b/i;

  const commaParts = t.split(/\s*,\s*/).filter(Boolean);
  const prefixBeforeComma = commaParts[0] || "";
  const prefixTokenCount = prefixBeforeComma.trim().split(/\s+/).filter(Boolean).length;
  const secondCommaPart = (commaParts[1] || "").trim();
  const secondIsCorpSuffix = corpSuffixRe.test(secondCommaPart);
  const secondLooksAddress = addressLeadRe.test(secondCommaPart) || /\d/.test(secondCommaPart);
  const secondHasEntityKw = nameHasEntityKwRe.test(secondCommaPart);
  const secondLooksPersonName =
    !!secondCommaPart &&
    !secondIsCorpSuffix &&
    !secondLooksAddress &&
    !secondHasEntityKw &&
    /^[A-Z][A-Za-z' .-]+(?:\s+[A-Z][A-Za-z' .-]+){0,8}$/.test(secondCommaPart);
  const looksLikePerson =
    /^[A-Z][A-Z' .-]+,\s*[A-Z]/.test(t) &&
    prefixTokenCount > 0 &&
    prefixTokenCount <= 4 &&
    !nameHasEntityKwRe.test(prefixBeforeComma) &&
    secondLooksPersonName;
  if (looksLikePerson) {
    if (commaParts.length > 2) {
      t = `${commaParts[0]}, ${commaParts[1]}`.trim();
    }
  } else {
    const semiParts = t.split(/\s*;\s*/).filter(Boolean);
    if (semiParts.length > 1) {
      t = semiParts[0].trim();
    }

    const nonPersonCommaParts = t.split(/\s*,\s*/).filter(Boolean);
    if (nonPersonCommaParts.length > 1) {
      const kept = [nonPersonCommaParts[0]];
      for (let i = 1; i < nonPersonCommaParts.length; i += 1) {
        const seg = nonPersonCommaParts[i].trim();
        const remainCount = nonPersonCommaParts.length - i - 1;
        if (!seg) continue;

        if (corpSuffixRe.test(seg)) {
          kept.push(seg);
          continue;
        }

        if (addressLeadRe.test(seg) || /\d/.test(seg)) break;

        const isLocationLike = locationLikeRe.test(seg) && !nameHasEntityKwRe.test(seg);
        if (isLocationLike && (remainCount >= 1 || nameHasEntityKwRe.test(kept.join(", ")))) break;

        kept.push(seg);
      }
      t = kept.join(", ").trim();
    }
  }

  t = t.replace(/[.;,:(\s]+$/g, "").trim();
  return t || "-";
}

export default function WatchlistSearchScreen() {
  const scrollRef = useRef<ScrollView>(null);

  // ✅ 검색 진행 중인 요청 무효화 토큰
  const searchTokenRef = useRef(0);

  const [query, setQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [results, setResults] = useState<SearchResultBySource>(makeEmptyResults);

  const totalCount =
    results.vasp.length +
    results.restricted.length +
    results.ofac.length +
    results.un.length;

  // ✅ "첫 화면으로 복귀"
  const resetToIdle = useCallback(() => {
    searchTokenRef.current += 1;

    setQuery("");
    setHasSearched(false);
    setLoading(false);
    setErrorMessage("");
    setResults(makeEmptyResults());

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, []);

  // ✅ 검색창을 "완전히 비우면" 자동으로 첫 화면 복귀
  useEffect(() => {
    if (hasSearched && query.trim().length === 0) {
      resetToIdle();
    }
  }, [query, hasSearched, resetToIdle]);

  // ✅ 이 화면으로 들어올 때마다 초기화
  useFocusEffect(
    useCallback(() => {
      resetToIdle();
    }, [resetToIdle])
  );

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const myToken = ++searchTokenRef.current;

    try {
      setHasSearched(true);
      setLoading(true);
      setErrorMessage("");
      Keyboard.dismiss();

      const [vaspRes, restrictedRes, ofacRes, unRes] = await Promise.all([
        fetch(`${API_BASE_URL}/kofiu/vasp/latest`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/kofiu/restricted/latest`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/ofac/sdn/latest`).then((r) => r.json()),
fetch(`${API_BASE_URL}/un/sdn/latest`).then((r) => r.json()),
      ]);

      if (myToken !== searchTokenRef.current) return;

      // ✅ 공백/특수문자/대소문자 무시 검색 키
      const matches = createSearchMatcher(trimmed);

      const nextResults: SearchResultBySource = {
        vasp: [],
        restricted: [],
        ofac: [],
        un: [],
      };

      // ✅ VASP: normal + expired 합쳐서 검색
      const vaspLatest = vaspRes as VaspLatestResponse;
      const vaspCombined = [
        ...(vaspLatest.normal ?? []),
        ...(vaspLatest.expired ?? []),
      ].map((item, idx) => ({
        ...item,
        id: String(item.id ?? item.uid ?? item.no ?? idx),
      }));

      nextResults.vasp = vaspCombined.filter((item) => {
        return matches([item.service, item.company, item.ceo]);
      });

      // ✅ restricted/ofac/un은 data 배열에서 꺼내기
      const restrictedData =
        (restrictedRes as LatestResponse<BaseEntry>).data || [];
      const ofacDataRaw = (ofacRes as LatestResponse<BaseEntry>).data || [];
      const unDataRaw = (unRes as LatestResponse<BaseEntry>).data || [];

      nextResults.restricted = restrictedData.filter((item) => {
        return matches([formatRestrictedName(item.name)]);
      });

      const ofacData = ofacDataRaw.filter(isSouthKoreaEntry);
      nextResults.ofac = ofacData.filter((item) => {
        return matches([item.name]);
      });

      const unData = unDataRaw.filter(isSouthKoreaEntry);
      nextResults.un = unData.filter((item) => {
        return matches([item.name]);
      });

      if (myToken !== searchTokenRef.current) return;

      setResults(nextResults);
    } catch (e) {
      console.log("🔍 WatchList 검색 실패", e);
      setResults(makeEmptyResults());
      setErrorMessage("검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      if (myToken === searchTokenRef.current) {
        setLoading(false);
      }
    }
  }, [query]);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, styles.scrollResult]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>WatchList 통합검색</Text>
          <Text style={styles.heroSub}>
            이름/키워드로 VASP · 금융거래제한 · OFAC · UN을{"\n"}
            한 번에 검색합니다.
          </Text>

          {/* Search Pill */}
          <View style={styles.searchPill}>
            <Ionicons
              name="search"
              size={18}
              color="#8BA4D6"
              style={styles.searchIcon}
            />

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="이름 또는 키워드를 입력하세요..."
              placeholderTextColor="#63708D"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />

            {/* 오른쪽 X */}
            {query.trim().length > 0 && (
              <Pressable
                onPress={resetToIdle}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={({ pressed }) => [
                  styles.clearBtn,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Ionicons name="close-circle" size={20} color="#8BA4D6" />
              </Pressable>
            )}

            {/* 검색 버튼 */}
            <Pressable
              onPress={handleSearch}
              style={({ pressed }) => [
                styles.searchBtn,
                pressed && { opacity: 0.85 },
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#EAF0FF" />
              ) : (
                <Text style={styles.searchBtnText}>검색</Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* 검색 결과 */}
        {hasSearched && (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>검색 결과</Text>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>전체</Text>
                <Text style={styles.summaryValue}>{totalCount}건</Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>VASP</Text>
                <Text style={styles.summaryValue}>
                  {results.vasp.length}건
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>금융거래제한</Text>
                <Text style={styles.summaryValue}>
                  {results.restricted.length}건
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>OFAC</Text>
                <Text style={styles.summaryValue}>
                  {results.ofac.length}건
                </Text>
              </View>

              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>UN</Text>
                <Text style={styles.summaryValue}>
                  {results.un.length}건
                </Text>
              </View>

              {!!errorMessage && !loading && (
                <Text style={styles.errorHint}>{errorMessage}</Text>
              )}

              {!errorMessage && totalCount === 0 && !loading && (
                <Text style={styles.emptyHint}>검색 결과가 없습니다.</Text>
              )}
            </View>

            <Section
              title="VASP (가상자산사업자 신고현황)"
              count={results.vasp.length}
              entries={results.vasp}
              renderLine={(item) =>
                `No.${item.no ?? "-"}  ${item.service ?? ""} / ${item.company ?? ""} / 대표: ${item.ceo ?? "-"}`
              }
            />

            <Section
              title="금융거래 등 제한대상자"
              count={results.restricted.length}
              entries={results.restricted}
              renderTitle={(item) => formatRestrictedName(item.name)}
              renderLine={(item) =>
                `${item.birth ? "(" + item.birth + ")" : ""} ${item.country ?? ""}`.trim()
              }
            />

            <Section
              title="OFAC SDN"
              count={results.ofac.length}
              entries={results.ofac}
              renderLine={(item) =>
                `${item.name ?? ""} ${item.birth ? "(" + item.birth + ")" : ""} ${item.country ?? ""}`
              }
            />

            <Section
              title="UN 제재 리스트"
              count={results.un.length}
              entries={results.un}
              renderLine={(item) =>
                `${item.name ?? ""} ${item.birth ? "(" + item.birth + ")" : ""} ${item.country ?? ""}`
              }
            />
          </>
        )}
      </ScrollView>

      {/* ✅ 공통 탭바 사용 (작은 네모 없음) */}
      <BottomTabBar onPressSearchWhenActive={resetToIdle} />
    </SafeAreaView>
  );
}

type SectionProps = {
  title: string;
  count: number;
  entries: BaseEntry[];
  renderTitle?: (item: BaseEntry) => string;
  renderLine: (item: BaseEntry) => string;
};

function Section({ title, count, entries, renderTitle, renderLine }: SectionProps) {
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
            <Text style={styles.rowTitle}>{renderTitle ? renderTitle(item) : item.name}</Text>
            <Text style={styles.rowDetail}>{renderLine(item)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },
  scroll: {
    paddingHorizontal: 18,
    paddingBottom: 130, // ✅ 탭바 가림 방지
  },
  scrollResult: {
    paddingTop: 18,
  },

  hero: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 18,
  },
  heroTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: "#EAF0FF",
    letterSpacing: 0.2,
    marginBottom: 10,
  },
  heroSub: {
    fontSize: 14,
    color: "rgba(234, 240, 255, 0.70)",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 18,
  },

  searchPill: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
    borderRadius: 999,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 10,
  },
  searchIcon: {
    marginRight: 5,
  },
  input: {
    flex: 1,
    color: "#EAF0FF",
    fontSize: 15,
    paddingVertical: 6,
  },

  clearBtn: {
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
    marginRight: 13,
  },

  searchBtn: {
    minWidth: 52,
    height: 38,
    borderRadius: 999,
    backgroundColor: "#2B57D6",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  searchBtnText: {
    color: "#EAF0FF",
    fontSize: 15,
    fontWeight: "700",
  },

  summaryCard: {
    marginTop: 10,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  summaryTitle: {
    color: "#EAF0FF",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.10)",
  },
  summaryLabel: {
    color: "rgba(234, 240, 255, 0.70)",
    fontSize: 12,
    fontWeight: "600",
  },
  summaryValue: {
    color: "#EAF0FF",
    fontSize: 12,
    fontWeight: "700",
  },
  emptyHint: {
    marginTop: 10,
    color: "rgba(234, 240, 255, 0.55)",
    fontSize: 12,
    textAlign: "center",
  },
  errorHint: {
    marginTop: 10,
    color: "#FCA5A5",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },

  section: {
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    color: "#EAF0FF",
    fontSize: 14,
    fontWeight: "800",
  },
  sectionCount: {
    color: "rgba(234, 240, 255, 0.55)",
    fontSize: 12,
    fontWeight: "700",
  },
  sectionEmpty: {
    color: "rgba(234, 240, 255, 0.55)",
    fontSize: 12,
  },

  row: {
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.10)",
  },
  rowTitle: {
    color: "#EAF0FF",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 4,
  },
  rowDetail: {
    color: "rgba(234, 240, 255, 0.65)",
    fontSize: 12,
    lineHeight: 16,
  },
});
