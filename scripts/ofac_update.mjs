// aml-monitor-new/scripts/ofac_update.mjs
import { XMLParser } from "fast-xml-parser";

/**
 * ✅ Worker 주소
 */
const WORKER_BASE = "https://orange-bread-2e13.jhb80lee-793.workers.dev";

/**
 * ✅ Worker ADMIN_KEY
 */
const ADMIN_KEY = "aml-admin-key-2025";

/**
 * OFAC SDN XML
 */
const OFAC_XML_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml";

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function safeStr(v) {
  if (v === undefined || v === null) return "";
  return String(v);
}

/**
 * ✅ 정협님 룰:
 * - 북한/DPRK 무조건 제외
 * - south + korea 인접일 때만 한국(허용: "Korea, South" / "South Korea" / "Korea South" / "South, Korea")
 */
function isSouthKoreaRelatedText(text) {
  const s = safeStr(text);

  const deny = [
    /\bdprk\b/i,
    /\bnorth\s+korea\b/i,
    /\bkorea\s*,?\s*north\b/i,
    /\bdemocratic\s+people'?s\s+republic\s+of\s+korea\b/i,
    /\bpyongyang\b/i,
  ];
  if (deny.some((re) => re.test(s))) return false;

  // "멀리 떨어진 south ... korea"는 이 정규식에 안 걸립니다(인접만)
  const allow = /\b(?:south\s*,?\s*korea|korea\s*,?\s*south)\b/i;
  return allow.test(s);
}

function joinNonEmpty(arr, sep = " ") {
  return (arr || []).map((x) => safeStr(x).trim()).filter(Boolean).join(sep);
}

function buildName(e) {
  if (e?.lastName && e?.firstName) return `${safeStr(e.lastName)} ${safeStr(e.firstName)}`.trim();
  return safeStr(e?.sdnName || e?.lastName || e?.firstName || "").trim();
}

function buildAkaText(e) {
  const akaArr = asArray(e?.akaList?.aka);
  if (!akaArr.length) return "";
  const names = akaArr
    .map((a) => {
      const n = safeStr(a?.akaName || a?.lastName || a?.firstName || "").trim();
      const t = safeStr(a?.akaType || "").trim();
      return t ? `${n} (${t})` : n;
    })
    .filter(Boolean);

  return names.length ? names.join("; ") : "";
}

function buildAddressText(e) {
  const addrArr = asArray(e?.addressList?.address);
  if (!addrArr.length) return "";

  const lines = addrArr.map((a) => {
    const parts = [
      a?.address1,
      a?.address2,
      a?.address3,
      a?.city,
      a?.stateOrProvince,
      a?.postalCode,
      a?.country,
    ];
    return joinNonEmpty(parts, ", ");
  }).filter(Boolean);

  return lines.join("\n");
}

function buildIdText(e) {
  const ids = asArray(e?.idList?.id);
  if (!ids.length) return "";

  const lines = ids.map((id) => {
    const type = safeStr(id?.idType || "").trim();
    const num = safeStr(id?.idNumber || "").trim();
    const country = safeStr(id?.idCountry || "").trim();
    const issued = safeStr(id?.issueDate || "").trim();
    const exp = safeStr(id?.expirationDate || "").trim();

    const parts = [];
    if (type) parts.push(type);
    if (num) parts.push(num);
    if (country) parts.push(country);
    if (issued) parts.push(`ISSUE:${issued}`);
    if (exp) parts.push(`EXP:${exp}`);

    return parts.length ? parts.join(" | ") : "";
  }).filter(Boolean);

  return lines.join("\n");
}

function buildProgramText(e) {
  const programs = asArray(e?.programList?.program).map((p) => safeStr(p).trim()).filter(Boolean);
  return programs.length ? programs.join(", ") : "";
}

function buildDobText(e) {
  const dobArr = asArray(e?.dateOfBirthList?.dateOfBirthItem);
  const vals = dobArr.map((d) => safeStr(d?.dateOfBirth).trim()).filter(Boolean);
  return vals.length ? vals.join("; ") : "";
}

function buildRemarksText(e) {
  // OFAC XML 구조에 따라 remarks가 문자열/객체/배열일 수 있어 안전하게 처리
  const r = e?.remarks;
  if (!r) return "";
  if (typeof r === "string") return r.trim();
  if (Array.isArray(r)) return r.map((x) => safeStr(x)).join(" ").trim();
  // 객체면 값들을 대충 이어붙임
  return Object.values(r).map((x) => safeStr(x)).join(" ").trim();
}

function buildFullText(e) {
  const uid = safeStr(e?.uid);
  const type = safeStr(e?.sdnType || "Unknown").trim();
  const name = buildName(e);

  const dob = buildDobText(e);
  const aka = buildAkaText(e);
  const addr = buildAddressText(e);
  const ids = buildIdText(e);
  const prog = buildProgramText(e);
  const remarks = buildRemarksText(e);

  const lines = [];
  if (uid) lines.push(`UID: ${uid}`);
  if (type) lines.push(`TYPE: ${type}`);
  if (name) lines.push(`NAME: ${name}`);
  if (aka) lines.push(`AKA: ${aka}`);
  if (dob) lines.push(`DOB: ${dob}`);
  if (prog) lines.push(`PROGRAM: ${prog}`);

  if (addr) {
    lines.push(`ADDRESS:\n${addr}`);
  }

  if (ids) {
    lines.push(`IDS:\n${ids}`);
  }

  if (remarks) {
    lines.push(`REMARKS:\n${remarks}`);
  }

  return lines.join("\n\n");
}

async function main() {
  console.log("1) Downloading OFAC SDN XML...");

  const xmlRes = await fetch(OFAC_XML_URL, {
    headers: { "User-Agent": "aml-monitor/1.0 (local uploader)" },
  });

  if (!xmlRes.ok) {
    const text = await xmlRes.text().catch(() => "");
    throw new Error(`OFAC XML fetch failed: ${xmlRes.status}\n${text}`);
  }

  const xml = await xmlRes.text();

  console.log("2) Parsing XML...");

  const parser = new XMLParser({
    ignoreAttributes: true,
  });

  const parsed = parser.parse(xml);
  const root = parsed?.sdnList;
  if (!root) throw new Error("Parsed XML missing 'sdnList' root");

  const entries = asArray(root?.sdnEntry);

  const publishDate =
    root?.publshInformation?.Publish_Date ||
    root?.publshInformation?.PublishDate ||
    null;

  console.log(`3) Transforming entries... (count=${entries.length})`);

  let koreaRelatedCount = 0;

  const data = entries.map((e) => {
    const uid = safeStr(e?.uid);
    const type = safeStr(e?.sdnType || "Unknown");

    const name = buildName(e);

    const birth = buildDobText(e);

    const addrArr = asArray(e?.addressList?.address);
    const firstAddr = addrArr[0] || {};
    const country = safeStr(firstAddr?.country || "");

    // ✅ 원문 전체(앱에서 팝업에 그대로 보여줄 텍스트)
    const fullText = buildFullText(e);

    // ✅ 한국 관련 판단은 "원문 전체"를 대상으로 (정협님 룰 적용)
    const isKorea = isSouthKoreaRelatedText(fullText);

    if (isKorea) koreaRelatedCount++;

    return {
      uid,
      id: uid,
      type,
      name,
      birth,
      country,
      isKorea,

      // ✅ 팝업용 원문 전체
      fullText,
      // remarks만 따로도 쓰고 싶으면 유지 (선택)
      remark: buildRemarksText(e),
    };
  });

  console.log(`   ✅ koreaRelated(count) = ${koreaRelatedCount}`);

  const payload = {
    source: "ofac_xml",
    updatedAt: publishDate ? new Date(publishDate).toISOString() : new Date().toISOString(),
    total: data.length,
    data,
  };

  console.log("4) Uploading to Worker internal endpoint...");

  const upRes = await fetch(`${WORKER_BASE}/internal/ofac/sdn/update`, {
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

  console.log("5) Verifying latest...");

  const checkRes = await fetch(`${WORKER_BASE}/ofac/sdn/latest`);
  if (!checkRes.ok) {
    const t = await checkRes.text().catch(() => "");
    throw new Error(`Verify failed: ${checkRes.status}\n${t}`);
  }

  const checkJson = await checkRes.json();
  console.log("✅ OFAC latest total =", checkJson.total);
  console.log(
    "✅ OFAC latest koreaRelated (server isKorea) =",
    (checkJson.data || []).filter((x) => x?.isKorea).length
  );
}

main().catch((e) => {
  console.error("❌ ERROR:", e?.message || e);
  process.exit(1);
});
