// app/Home/kofiu/restricted.tsx
import React, { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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
  rawText?: string;
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
  const normalized = String(value).trim();
  const direct = normalized.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];

  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "-";
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

export default function RestrictedScreen() {
  const router = useRouter();
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
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace("/Home/kofiu" as any);
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backBtnText}>KoFIU 목록</Text>
        </Pressable>
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
              <Text style={styles.name}>{formatRestrictedName(item.name)}</Text>
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
  backBtn: {
    alignSelf: "flex-start",
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },
  backBtnText: { color: "#9CC2FF", fontWeight: "800", fontSize: 12 },
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
