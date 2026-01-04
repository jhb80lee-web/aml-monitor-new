// aml-monitor-new/scripts/un_update.mjs
import { XMLParser } from "fast-xml-parser";

const WORKER_BASE = "https://orange-bread-2e13.jhb80lee-793.workers.dev";
const ADMIN_KEY = "aml-admin-key-2025";

// ✅ UN 원본 URL 교체(기존 scsanctions 경로 404)
const UN_XML_URL =
  "https://unsolprodfiles.blob.core.windows.net/publiclegacyxmlfiles/EN/consolidatedLegacyByNAME.xml";

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function s(v) {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function joinNames(parts) {
  return parts.map(s).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function extractCountriesFromAddresses(addrList) {
  const addrs = asArray(addrList?.ADDRESS);
  const countries = [];
  for (const a of addrs) {
    // XML에 따라 COUNTRY / COUNTRY_OF_ADDRESS 같은 필드가 섞일 수 있어 넓게 받음
    const c =
      s(a?.COUNTRY) ||
      s(a?.COUNTRY_OF_ADDRESS) ||
      s(a?.COUNTRY_NAME) ||
      "";
    if (c) countries.push(c);
  }
  return countries;
}

/**
 * ✅ OFAC와 동일 룰:
 * - 북한/DPRK 무조건 제외
 * - south + korea 인접일 때만 한국(허용: "Korea, South" / "South Korea" / "Korea South" / "South, Korea")
 */
function isSouthKoreaRelatedText(text) {
  const ss = String(text ?? "");

  const deny = [
    /\bdprk\b/i,
    /\bnorth\s+korea\b/i,
    /\bkorea\s*,?\s*north\b/i,
    /\bdemocratic\s+people'?s\s+republic\s+of\s+korea\b/i,
    /\bpyongyang\b/i,
  ];
  if (deny.some((re) => re.test(ss))) return false;

  // "멀리 떨어진 south ... korea"는 이 정규식에 안 걸립니다(인접만)
  const allow = /\b(?:south\s*,?\s*korea|korea\s*,?\s*south)\b/i;
  return allow.test(ss);
}

async function main() {
  console.log("1) Downloading UN consolidated XML...");

  const xmlRes = await fetch(UN_XML_URL, {
    headers: { "User-Agent": "aml-monitor/1.0 (local uploader)" },
  });

  if (!xmlRes.ok) {
    const text = await xmlRes.text().catch(() => "");
    throw new Error(`UN XML fetch failed: ${xmlRes.status}\n${text}`);
  }

  const xml = await xmlRes.text();
  const httpLastModified = xmlRes.headers.get("last-modified") || "";

  console.log("2) Parsing XML...");

  // ✅ dateGenerated="..." 속성을 읽기 위해 ignoreAttributes=false
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  // 루트는 보통 CONSOLIDATED_LIST
  const root =
    parsed?.CONSOLIDATED_LIST ||
    parsed?.ConsolidatedList ||
    parsed?.consolidatedList;

  if (!root) throw new Error("Parsed XML missing CONSOLIDATED_LIST root");

  // 생성일(있으면) — 이번 XML은 <CONSOLIDATED_LIST ... dateGenerated="...">
  const updatedAt =
    s(root?.DATE_GENERATED) ||
    s(root?.dateGenerated) ||
    s(root?.["@_dateGenerated"]) || // ✅ 루트 attribute
    s(root?.GENERATED_ON) ||
    (httpLastModified ? new Date(httpLastModified).toISOString() : "") ||
    "";

  const individuals = asArray(root?.INDIVIDUALS?.INDIVIDUAL);
  const entities = asArray(root?.ENTITIES?.ENTITY);

  console.log(
    `3) Transforming... (individuals=${individuals.length}, entities=${entities.length})`
  );

  const data = [];

  // Individuals
  for (const ind of individuals) {
    const ref = s(ind?.REFERENCE_NUMBER) || s(ind?.DATAID) || "";
    const name = joinNames([
      ind?.FIRST_NAME,
      ind?.SECOND_NAME,
      ind?.THIRD_NAME,
      ind?.FOURTH_NAME,
    ]);

    // DOB는 여러 개일 수 있음
    const dobs = asArray(ind?.INDIVIDUAL_DATE_OF_BIRTH?.DATE_OF_BIRTH);
    const dobStr = dobs
      .map((d) => {
        const y = s(d?.YEAR);
        const t = s(d?.TYPE_OF_DATE); // EXACT/APPROXIMATELY 등
        // YEAR만 있는 케이스가 많아서 단순화
        if (t && y) return `${t} ${y}`;
        if (y) return y;
        return s(d);
      })
      .filter(Boolean);

    const birth = dobStr[0] || "";

    // country: 보통 NATIONALITY의 VALUE를 우선, 없으면 주소의 country
    const nats = asArray(ind?.NATIONALITY?.VALUE).map(s).filter(Boolean);
    const addrCountries = extractCountriesFromAddresses(ind?.INDIVIDUAL_ADDRESS);
    const country = nats[0] || addrCountries[0] || "";

    // ✅ OFAC와 동일하게: "전체 텍스트"를 만들어서 그걸로 판정
    const fullText = [country, ...nats, ...addrCountries, name].join(" ").trim();
    const isKorea = isSouthKoreaRelatedText(fullText);

    data.push({
      uid: ref,
      id: ref,
      type: "Individual",
      name,
      birth,
      country,
      isKorea,
      // fullText,
    });
  }

  // Entities
  for (const ent of entities) {
    const ref = s(ent?.REFERENCE_NUMBER) || s(ent?.DATAID) || "";
    const name =
      s(ent?.ENTITY_NAME) ||
      joinNames([ent?.FIRST_NAME, ent?.SECOND_NAME, ent?.THIRD_NAME]) ||
      "";

    const addrCountries = extractCountriesFromAddresses(ent?.ENTITY_ADDRESS);
    const country = addrCountries[0] || "";

    const fullText = [country, ...addrCountries, name].join(" ").trim();
    const isKorea = isSouthKoreaRelatedText(fullText);

    data.push({
      uid: ref,
      id: ref,
      type: "Entity",
      name,
      birth: "",
      country,
      isKorea,
      // fullText,
    });
  }

  const payload = {
    source: "un_xml",
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : new Date().toISOString(),
    total: data.length,
    data,
  };

  console.log("4) Uploading to Worker internal endpoint...");

  const upRes = await fetch(`${WORKER_BASE}/internal/un/sdn/update`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-key": ADMIN_KEY,
    },
    body: JSON.stringify(payload),
  });

  const upText = await upRes.text();
  if (!upRes.ok) {
    throw new Error(`Upload failed: ${upRes.status}\n${upText}`);
  }

  console.log("✅ Upload OK:", upText);

  console.log("5) Verifying /un/sdn/latest total...");

  const checkRes = await fetch(`${WORKER_BASE}/un/sdn/latest`);
  const checkJson = await checkRes.json();
  console.log("✅ UN latest total =", checkJson.total);
  console.log(
    "✅ UN latest koreaRelated (server isKorea) =",
    (checkJson.data || []).filter((x) => x?.isKorea).length
  );
}

main().catch((e) => {
  console.error("❌ ERROR:", e?.message || e);
  process.exit(1);
});
