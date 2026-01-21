// scripts/check_updates.mjs
import fs from "node:fs";
import path from "node:path";
import axios from "axios";

const STATE_FILE = path.resolve(".aml_state.json");

const OFAC_XML_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml";

// ✅ UN URL 교체(기존 scsanctions 경로 404)
const UN_XML_URL =
  "https://unsolprodfiles.blob.core.windows.net/publiclegacyxmlfiles/EN/consolidatedLegacyByNAME.xml";

// --- KoFIU VASP: endpoints/params (kofiu_vasp_update.js에서 가져온 값과 동일) ---
const KOFIU_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.kofiu.go.kr/",
};
const KOFIU_NOTICE_URL = "https://www.kofiu.go.kr/kor/notification/notice.do";
const KOFIU_VASP_SECD = "0007";
const KOFIU_VASP_OR = "194";
const KOFIU_VASP_LIST_URL =
  "https://www.kofiu.go.kr/cmn/board/selectBoardListFile.do";
const KOFIU_VASP_FILE_URL =
  "https://www.kofiu.go.kr/cmn/board/selectBoardFile.do";

// --- KoFIU Restricted: endpoints/params (kofiu_restricted_update.js에서 가져온 값과 동일) ---
const KOFIU_ORIGIN = "https://www.kofiu.go.kr";
const KOFIU_RESTRICTED_SELECT_LAW_FILE_URL = `${KOFIU_ORIGIN}/cmn/board/selectLawFile.do`;
const KOFIU_RESTRICTED_LAW_ORDR_NO = "84";
const KOFIU_RESTRICTED_LAW_TY_SE_CD = "001";

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {
      ofac: { publishDate: "", etag: "", lastModified: "" },
      un: { dateGenerated: "", etag: "", lastModified: "" },
      kofiu_vasp: { ordrNo: "", fileId: "", fileSn: "" },
      kofiu_restricted: { fileOrdrNo: "", streFileNm: "", fileNm: "", fileSize: 0 },
    };
  }
}

function writeState(next) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n", "utf-8");
}

function setOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  fs.appendFileSync(out, `${name}=${String(value)}\n`);
}

function normHeader(v) {
  return (v || "").toString().trim();
}

async function fetchHead(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "aml-monitor-actions/1.0" },
    });
    if (!res.ok) return { ok: false, status: res.status, etag: "", lastModified: "" };
    return {
      ok: true,
      status: res.status,
      etag: normHeader(res.headers.get("etag")),
      lastModified: normHeader(res.headers.get("last-modified")),
    };
  } catch {
    return { ok: false, status: 0, etag: "", lastModified: "" };
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
  headers: {
      "User-Agent": "aml-monitor-actions/1.0",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function extractOfacPublishDate(xml) {
  const m =
    xml.match(/<Publish_Date>\s*([^<]+)\s*<\/Publish_Date>/i) ||
    xml.match(/<PublishDate>\s*([^<]+)\s*<\/PublishDate>/i);
  return m ? String(m[1]).trim() : "";
}

function extractUnDateGenerated(xml) {
  const src = String(xml || "");

  // ✅ 루트 속성: dateGenerated="..."
  const attr = src.match(/\bdateGenerated\s*=\s*"([^"]+)"/i);
  if (attr) return String(attr[1]).trim();

  // ✅ 기존 태그 방식도 유지
  const m =
    src.match(/<DATE_GENERATED>\s*([^<]+)\s*<\/DATE_GENERATED>/i) ||
    src.match(/<dateGenerated>\s*([^<]+)\s*<\/dateGenerated>/i) ||
    src.match(/<GENERATED_ON>\s*([^<]+)\s*<\/GENERATED_ON>/i);
  return m ? String(m[1]).trim() : "";
}

function buildSig({ primary, etag, lastModified }) {
  return [primary || "", etag || "", lastModified || ""].join("|");
}

// ================== KoFIU Cookie Jar (kofiu_vasp_update.js와 동일 방식) ==================
const cookieJar = new Map();
function storeSetCookies(setCookie) {
  if (!setCookie) return;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const sc of arr) {
    const part = String(sc).split(";")[0];
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) cookieJar.set(name, value);
  }
}
function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
async function axiosWithCookies(config) {
  config.headers = config.headers || {};
  const ck = cookieHeader();
  if (ck) config.headers.Cookie = ck;
  const res = await axios(config);
  storeSetCookies(res.headers?.["set-cookie"]);
  return res;
}

async function ensureKofiuSession() {
  const res = await axiosWithCookies({
    method: "GET",
    url: KOFIU_NOTICE_URL,
    headers: {
      ...KOFIU_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    throw new Error(`KoFIU session bootstrap failed: HTTP ${res.status}`);
  }
}

async function checkKofiuVaspSignature() {
  await ensureKofiuSession();

  // 1) 목록
  const payload = new URLSearchParams({
    seCd: KOFIU_VASP_SECD,
    or: KOFIU_VASP_OR,
    pageIndex: "1",
    searchCondition: "title",
    searchKeyword: "",
  }).toString();

  const listRes = await axiosWithCookies({
    method: "POST",
    url: KOFIU_VASP_LIST_URL,
    headers: {
      ...KOFIU_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/plain, */*",
    },
    data: payload,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (listRes.status !== 200) {
    throw new Error(`KoFIU VASP list failed: HTTP ${listRes.status}`);
  }

  const list = Array.isArray(listRes.data?.result) ? listRes.data.result : [];
  const target =
    list.find((x) => String(x?.nttSj || "").includes("가상자산사업자 신고 현황")) ||
    list[0];

  const ordrNo = String(target?.ntcnYardOrdrNo || "");
  if (!ordrNo) throw new Error("KoFIU VASP: ntcnYardOrdrNo not found");

  // 2) 첨부
  const payload2 = new URLSearchParams({
    ntcnYardOrdrNo: ordrNo,
    seCd: KOFIU_VASP_SECD,
  }).toString();

  const fileRes = await axiosWithCookies({
    method: "POST",
    url: KOFIU_VASP_FILE_URL,
    headers: {
      ...KOFIU_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/plain, */*",
    },
    data: payload2,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (fileRes.status !== 200) {
    throw new Error(`KoFIU VASP file list failed: HTTP ${fileRes.status}`);
  }

  const files = Array.isArray(fileRes.data?.result) ? fileRes.data.result : [];
  const f0 = files[0] || {};
  const fileId = String(f0?.fileId || "");
  const fileSn = String(f0?.fileSn || "1");

  if (!fileId) throw new Error("KoFIU VASP: fileId not found");

  return { ordrNo, fileId, fileSn };
}

// restricted normalize + rank (kofiu_restricted_update.js의 핵심 로직 그대로 사용)
function normalizeLawAttachment(item) {
  const fileNm =
    item.atchmnflOrginlNm ||
    item.fileNm ||
    item.orignlFileNm ||
    item.orgnlFileNm ||
    item.atchFileNm ||
    "";

  const streFileNm =
    item.streFileNm ||
    item.stre ||
    item.streFileName ||
    item.streFile ||
    "";

  const fileOrdrNo =
    item.fileOrdrNo ||
    item.atchmnflOrdrNo ||
    item.fileSn ||
    item.fileSeq ||
    "";

  const mime =
    item.contentType ||
    item.mime ||
    item.fileCn ||
    item.fileType ||
    "";

  const fileSize =
    Number(item.fileSize || item.size || item.fileMg || 0) || 0;

  return {
    fileNm: String(fileNm || ""),
    streFileNm: String(streFileNm || ""),
    fileOrdrNo: String(fileOrdrNo || ""),
    mime: String(mime || ""),
    fileSize,
  };
}

function rankAttachments(files) {
  const scoreOne = (f) => {
    const name = String(f.fileNm || "");
    const lname = name.toLowerCase();
    const mime = String(f.mime || "").toLowerCase();

    const hasStrongKw = name.includes("금융거래") || name.includes("제한대상");
    const isPdfLike = lname.endsWith(".pdf") || mime.includes("pdf");
    const isHwpxLike =
      lname.endsWith(".hwpx") || mime.includes("haansofthwpx") || mime.includes("hwpx");
    const isHwpLike = lname.endsWith(".hwp") || mime.includes("hwp");

    let typeScore = 0;
    if (isHwpxLike) typeScore = 600;
    else if (isPdfLike) typeScore = 450;
    else if (isHwpLike) typeScore = 200;

    const kwScore = hasStrongKw ? 700 : 0;
    const size = Number(f.fileSize || 0);
    const sizeScore = Math.min(size / 1024, 120);

    return kwScore + typeScore + sizeScore;
  };

  return [...files].sort((a, b) => scoreOne(b) - scoreOne(a));
}

async function checkKofiuRestrictedSignature() {
  const payload = new URLSearchParams({
    lawordInfoOrdrNo: KOFIU_RESTRICTED_LAW_ORDR_NO,
    seCd: KOFIU_RESTRICTED_LAW_TY_SE_CD,
    lawordInfoTySeCd: KOFIU_RESTRICTED_LAW_TY_SE_CD,
  }).toString();

  const res = await axios({
    method: "POST",
    url: KOFIU_RESTRICTED_SELECT_LAW_FILE_URL,
    headers: {
      ...KOFIU_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, text/plain, */*",
    },
    data: payload,
    timeout: 15000,
    validateStatus: () => true,
  });

  if (res.status !== 200) {
    throw new Error(`KoFIU Restricted list failed: HTTP ${res.status}`);
  }

  const raw = res.data;
  const list = Array.isArray(raw?.result) ? raw.result : [];
  const normalized = list.map(normalizeLawAttachment);

  const ranked = rankAttachments(normalized);
  const top = ranked[0];
  if (!top) throw new Error("KoFIU Restricted: attachment not found");

  return {
    fileOrdrNo: String(top.fileOrdrNo || ""),
    streFileNm: String(top.streFileNm || ""),
    fileNm: String(top.fileNm || ""),
    fileSize: Number(top.fileSize || 0),
  };
}

async function main() {
  const prev = readState();

  // ✅ FORCE 플래그
  const forceOfac = process.env.FORCE_OFAC === "1";
  const forceUn = process.env.FORCE_UN === "1";
  const forceVasp = process.env.FORCE_VASP === "1";
  const forceRestricted = process.env.FORCE_RESTRICTED === "1";

  console.log("🔎 Checking OFAC / UN / KoFIU source timestamps...");
  console.log("🧪 FORCE_OFAC      :", forceOfac ? "ON" : "OFF");
  console.log("🧪 FORCE_UN        :", forceUn ? "ON" : "OFF");
  console.log("🧪 FORCE_VASP      :", forceVasp ? "ON" : "OFF");
  console.log("🧪 FORCE_RESTRICTED:", forceRestricted ? "ON" : "OFF");

  // --- OFAC/UN (기존 로직 그대로) ---
  const [ofacHead, unHead] = await Promise.all([
    fetchHead(OFAC_XML_URL),
    fetchHead(UN_XML_URL),
  ]);

  // ✅ 핵심 소스는 HEAD 단계부터 실패를 숨기지 않기
  if (!ofacHead.ok) {
    throw new Error(`OFAC HEAD failed (status=${ofacHead.status}) url=${OFAC_XML_URL}`);
  }
  if (!unHead.ok) {
    throw new Error(`UN HEAD failed (status=${unHead.status}) url=${UN_XML_URL}`);
  }

  let ofacPublishDate = prev?.ofac?.publishDate || "";
  let unDateGenerated = prev?.un?.dateGenerated || "";

  const prevUnLastModified = prev?.un?.lastModified || "";

  const maybeNeedOfacGet =
    !ofacPublishDate || (!ofacHead.etag && !ofacHead.lastModified);

  // ✅ UN은 last-modified가 바뀌면(=신규 생성) dateGenerated 갱신을 위해 본문 파싱 수행
    const maybeNeedUnGet = true; // ✅ dateGenerated 기반 “무조건 changed”를 보장하려면 항상 GET

  let ofacXml = "";
  let unXml = "";

  if (maybeNeedOfacGet || maybeNeedUnGet) {
    const results = await Promise.allSettled([
      maybeNeedOfacGet ? fetchText(OFAC_XML_URL) : Promise.resolve(""),
      maybeNeedUnGet ? fetchText(UN_XML_URL) : Promise.resolve(""),
    ]);

    if (results[0].status === "fulfilled") ofacXml = results[0].value;
    if (results[1].status === "fulfilled") unXml = results[1].value;
  }

  if (ofacXml) ofacPublishDate = extractOfacPublishDate(ofacXml) || ofacPublishDate;
  if (unXml) unDateGenerated = extractUnDateGenerated(unXml) || unDateGenerated;

  const currentOfac = {
    publishDate: ofacPublishDate,
    etag: ofacHead.etag || prev?.ofac?.etag || "",
    lastModified: ofacHead.lastModified || prev?.ofac?.lastModified || "",
  };

  const currentUn = {
    dateGenerated: unDateGenerated,
    etag: unHead.etag || prev?.un?.etag || "",
    lastModified: unHead.lastModified || prev?.un?.lastModified || "",
  };

  const prevOfacSig = buildSig({
    primary: prev?.ofac?.publishDate || "",
    etag: prev?.ofac?.etag || "",
    lastModified: prev?.ofac?.lastModified || "",
  });

  const prevUnSig = buildSig({
    primary: prev?.un?.dateGenerated || "",
    etag: prev?.un?.etag || "",
    lastModified: prev?.un?.lastModified || "",
  });

  const currentOfacSig = buildSig({
    primary: currentOfac.publishDate,
    etag: currentOfac.etag,
    lastModified: currentOfac.lastModified,
  });

  const currentUnSig = buildSig({
    primary: currentUn.dateGenerated,
    etag: currentUn.etag,
    lastModified: currentUn.lastModified,
  });

  const ofacChanged = forceOfac || currentOfacSig !== prevOfacSig;
  const unChanged = forceUn || currentUnSig !== prevUnSig;

  // --- KoFIU signatures ---
  let currentVasp = prev?.kofiu_vasp || { ordrNo: "", fileId: "", fileSn: "" };
  let currentRestricted =
    prev?.kofiu_restricted || { fileOrdrNo: "", streFileNm: "", fileNm: "", fileSize: 0 };

  // vasp/restricted는 “서명(signature)”을 직접 생성해서 비교
  const prevVaspSig = [
    prev?.kofiu_vasp?.ordrNo || "",
    prev?.kofiu_vasp?.fileId || "",
    prev?.kofiu_vasp?.fileSn || "",
  ].join("|");

  const prevRestrictedSig = [
    prev?.kofiu_restricted?.fileOrdrNo || "",
    prev?.kofiu_restricted?.streFileNm || "",
    prev?.kofiu_restricted?.fileNm || "",
    String(prev?.kofiu_restricted?.fileSize || 0),
  ].join("|");

  // KoFIU 체크는 실패할 수 있으니(외부 사이트 이슈) try/catch로 감싸서,
  // 실패 시 “changed=false”로 두고 state도 유지(추정 금지: 실패는 실패로 로그만 남김)
  let vaspSigNow = prevVaspSig;
  let restrictedSigNow = prevRestrictedSig;

  try {
    const vaspNow = await checkKofiuVaspSignature();
    vaspSigNow = [vaspNow.ordrNo, vaspNow.fileId, vaspNow.fileSn].join("|");
    currentVasp = vaspNow;
  } catch (e) {
    console.log("⚠️ KoFIU VASP check failed:", e?.message || String(e));
  }

  try {
    const resNow = await checkKofiuRestrictedSignature();
    restrictedSigNow = [
      resNow.fileOrdrNo,
      resNow.streFileNm,
      resNow.fileNm,
      String(resNow.fileSize || 0),
    ].join("|");
    currentRestricted = resNow;
  } catch (e) {
    console.log("⚠️ KoFIU Restricted check failed:", e?.message || String(e));
  }

  const kofiuVaspChanged = forceVasp || (vaspSigNow && vaspSigNow !== prevVaspSig);
  const kofiuRestrictedChanged =
    forceRestricted ||
    (restrictedSigNow && restrictedSigNow !== prevRestrictedSig);

  // outputs
  setOutput("ofac_changed", ofacChanged ? "true" : "false");
  setOutput("un_changed", unChanged ? "true" : "false");
  setOutput("kofiu_vasp_changed", kofiuVaspChanged ? "true" : "false");
  setOutput("kofiu_restricted_changed", kofiuRestrictedChanged ? "true" : "false");

  console.log("OFAC changed?", ofacChanged);
  console.log("UN changed?", unChanged);
  console.log("KoFIU VASP changed?", kofiuVaspChanged);
  console.log("KoFIU Restricted changed?", kofiuRestrictedChanged);

  // state write: FORCE 때문에 changed=true여도 “실제 서명 비교 결과”가 동일하면 상태를 바꾸지 않음
  const nextState = {
    ofac: ofacChanged ? currentOfac : prev.ofac,
    un: unChanged ? currentUn : prev.un,
    kofiu_vasp:
      (vaspSigNow && vaspSigNow !== prevVaspSig)
        ? currentVasp
        : (prev.kofiu_vasp || currentVasp),
    kofiu_restricted:
      (restrictedSigNow && restrictedSigNow !== prevRestrictedSig)
        ? currentRestricted
        : (prev.kofiu_restricted || currentRestricted),
  };

  writeState(nextState);
}

main().catch((e) => {
  console.error("❌ check_updates.mjs failed:", e);
  process.exit(1);
});
