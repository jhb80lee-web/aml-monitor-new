/* KoFIU VASP Update Script (for Worker+R2)
 * - KoFIU 엑셀 다운로드 → 파싱(정상+미갱신)
 * - Worker /internal/kofiu/vasp/update 로 POST (R2에 latest.json 생성)
 *
 * 안정화 포인트
 * 1) selectBoardFile.do 에서 fileId를 받아 downloadBoard.do?fileId= 로 다운로드
 * 2) download 시 Referer를 "실제 notice_view(공지 상세)"로 정확히 세팅 (가장 안정)
 * 3) 엑셀 내 중복 No(예: 마지막에 1이 또 나오는 케이스) 제거
 */

const axios = require("axios");
const XLSX = require("xlsx");

// ================== ENV ==================
const WORKER_BASE_URL =
  process.env.WORKER_BASE_URL ||
  "https://orange-bread-2e13.jhb80lee-793.workers.dev";

const ADMIN_KEY = process.env.ADMIN_KEY || "aml-admin-key-2025";
const DEBUG = process.env.DEBUG === "1";

// ================== KoFIU Params ==================
const VASP_OR = "194"; // 게시글 번호(기본값; 최신글 추적으로 대체됨)
const VASP_SECD = "0007"; // 게시판 코드

const KOFIU_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.kofiu.go.kr/",
};

// ================== Fallback Data ==================
const VASP_FALLBACK_DATA = [
  { no: 1, service: "업비트", company: "두나무 주식회사", ceo: "오경석" },
  { no: 2, service: "코빗", company: "주식회사 코빗", ceo: "오세진" },
  { no: 3, service: "코인원", company: "주식회사 코인원", ceo: "이성현" },
  { no: 4, service: "빗썸", company: "주식회사 빗썸", ceo: "이재원" },
  { no: 5, service: "플라이빗", company: "주식회사 한국디지털거래소", ceo: "김석진" },
  { no: 6, service: "고팍스", company: "주식회사 스트리미", ceo: "이준행" },
  { no: 7, service: "BTX", company: "차일들리 주식회사", ceo: "김은태" },
  { no: 8, service: "포블", company: "주식회사 포블게이트", ceo: "안현준" },
  { no: 9, service: "코어닥스", company: "㈜코어닥스", ceo: "김찬우" },
  { no: 10, service: "비블록", company: "주식회사 그레이브릿지", ceo: "황익찬" },
  { no: 11, service: "오케이비트", company: "주식회사 포리스닥스코리아리미티드", ceo: "라파엘드마르코이멜로" },
  { no: 12, service: "빗크몬", company: "주식회사 골든퓨쳐스", ceo: "권정만" },
  { no: 13, service: "프라뱅", company: "주식회사 프라뱅", ceo: "김상진" },
  { no: 14, service: "보라비트", company: "주식회사 뱅코", ceo: "김성훈" },
  { no: 15, service: "코다(KODA)", company: "주식회사 한국디지털에셋", ceo: "조진석" },
  { no: 16, service: "케이닥(KDAC)", company: "주식회사 한국디지털자산수탁", ceo: "조성일, 김준홍" },
  { no: 17, service: "오하이월렛", company: "주식회사 월렛원", ceo: "강준우, 박인수" },
  { no: 18, service: "하이퍼리즘", company: "주식회사 하이퍼리즘", ceo: "오상록, 이원준" },
  { no: 19, service: "오아시스거래소", company: "㈜가디언홀딩스", ceo: "이동민" },
  { no: 20, service: "커스텔라", company: "주식회사 마인드시프트", ceo: "박용건" },
  { no: 21, service: "인피닛블록", company: "주식회사 인피닛블록", ceo: "정구태" },
  { no: 22, service: "디에스알브이랩스", company: "㈜디에스알브이랩스", ceo: "김지윤" },
  { no: 23, service: "비댁스", company: "비댁스 주식회사", ceo: "류홍열" },
  { no: 24, service: "INEX(인엑스)", company: "㈜인피니티익스체인지코리아", ceo: "이재강" },
  { no: 25, service: "돌핀(Dolfin)", company: "㈜웨이브릿지", ceo: "오종욱" },
  { no: 26, service: "바우맨", company: "㈜해피블록", ceo: "김규윤" },
  { no: 27, service: "로빗", company: "㈜블로세이프", ceo: "한성주" },
];

const VASP_EXPIRED_NOTE_FALLBACK =
  "※ 신고 유효기간 만료된 미갱신 사업자 : 지닥(GDAC)(㈜피어테크), 프로비트(오션스㈜), 후오비코리아(후오비㈜), 플랫타익스체인지(㈜플랫타이엑스), 한빗코(㈜한빗코코리아), 비트레이드(㈜블록체인컴퍼니), 코인엔코인(㈜코엔코코리아), 캐셔레스트(㈜뉴링크), 텐앤텐(㈜텐앤텐), 에이프로빗(㈜에이프로코리아), 마이키핀월렛(㈜씨피랩스), 큐비트(큐비트㈜), 카르도(㈜카르도), 델리오(㈜델리오), 페이코인(PayProtocol AG), 코인빗(㈜엑시아소프트)";

const VASP_EXPIRED_NOTE_2 =
  "※ 미갱신 사업자도 이용자 자산의 이전·반환이 완료될 때까지, 「가상자산이용자보호법」상 가상자산사업자에 해당";

// ================== Debug Helpers ==================
function headOfData(data, limit = 600) {
  try {
    if (data == null) return "";
    if (Buffer.isBuffer(data)) return data.toString("utf8", 0, Math.min(limit, data.length));
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8", 0, limit);
    if (typeof data === "string") return data.slice(0, limit);
    return JSON.stringify(data).slice(0, limit);
  } catch {
    return String(data).slice(0, limit);
  }
}

function debugHttp(label, res) {
  if (!DEBUG) return;
  console.log(`\n[DEBUG] ${label}`);
  console.log(" status      :", res?.status);
  console.log(" content-type:", res?.headers?.["content-type"]);
  console.log(" data head   :", headOfData(res?.data, 600));
}

// ================== Cookie Jar (세션 유지) ==================
const cookieJar = new Map();

function storeSetCookies(setCookie) {
  if (!setCookie) return;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const sc of arr) {
    const part = String(sc).split(";")[0]; // name=value
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
    url: "https://www.kofiu.go.kr/kor/notification/notice.do",
    headers: {
      ...KOFIU_HEADERS,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  debugHttp("KoFIU session bootstrap (notice.do)", res);

  if (res.status !== 200) {
    throw new Error(`KoFIU session bootstrap failed: HTTP ${res.status}`);
  }
}

// ================== Text Helpers ==================
function splitExpiredText(raw) {
  if (!raw) return { service: "", company: "" };

  const parens = raw.match(/\([^()]*\)/g) || [];

  if (parens.length >= 2) {
    const company = parens[parens.length - 1].replace(/[()]/g, "").trim();
    const lastIdx = raw.lastIndexOf("(");
    const service = raw.slice(0, lastIdx).trim();
    return { service, company };
  }

  if (parens.length === 1) {
    const company = parens[0].replace(/[()]/g, "").trim();
    const service = raw.split("(")[0].trim();
    return { service, company };
  }

  return { service: raw.trim(), company: "" };
}

// ✅ 미갱신도 company(service) 형태로 만들기
function toCompanyServiceFormat(service, company, rawFallback = "") {
  const s = (service || "").trim();
  const c = (company || "").trim();

  if (c && s) return `${c}(${s})`;
  if (c) return c;
  if (s) return s;
  return (rawFallback || "").trim();
}

function getFallbackVasp() {
  const expired = VASP_EXPIRED_NOTE_FALLBACK
    .replace("※ 신고 유효기간 만료된 미갱신 사업자 :", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw, idx) => {
      const { service, company } = splitExpiredText(raw);
      return {
        no: 1001 + idx,
        service: "",
        company: toCompanyServiceFormat(service, company, raw),
      };
    });

  return {
    source: "embedded",
    updatedAt: "2025-10-22T00:00:00.000Z",
    total: VASP_FALLBACK_DATA.length,
    normal: VASP_FALLBACK_DATA,
    expired,
    expiredNote: VASP_EXPIRED_NOTE_2,
  };
}

// ================== Excel Helpers ==================
function fillMerges(sheet) {
  const merges = sheet["!merges"] || [];
  for (const m of merges) {
    const startAddr = XLSX.utils.encode_cell(m.s);
    const startCell = sheet[startAddr];
    const v = startCell?.v;
    if (v == null || String(v).trim() === "") continue;

    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (!cell || cell.v == null || String(cell.v).trim() === "") {
          sheet[addr] = { t: "s", v: String(v) };
        }
      }
    }
  }
}

// ================== KoFIU: URL + Referer 생성(가장 안정) ==================
async function fetchLatestVaspExcelDownloadInfoFromKofiu() {
  await ensureKofiuSession();

  // 1) 목록에서 최신 "가상자산사업자 신고 현황" 글 찾기
  const LIST_URL = "https://www.kofiu.go.kr/cmn/board/selectBoardListFile.do";
  const params = {
    ntcnYardOrdrNo: "",
    page: 1,
    seCd: VASP_SECD,
    selScope: "",
    size: 20,
    subSech: "",
  };

  const listRes = await axiosWithCookies({
    method: "GET",
    url: LIST_URL,
    params,
    headers: {
      ...KOFIU_HEADERS,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Origin: "https://www.kofiu.go.kr",
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  debugHttp("KoFIU VASP list response (LIST MODE)", listRes);

  const body = listRes.data;
  if (body?.rsMsg?.statusCode === "E") {
    throw new Error(`KoFIU rsMsg ${body.rsMsg.code}: ${body.rsMsg.message}`);
  }

  const list = body?.result || body?.resultList || body?.data || [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("KoFIU VASP 공지 리스트(result)가 비어 있습니다.");
  }

  const item =
    list.find((x) => String(x.ntcnYardSjNm || "").includes("가상자산사업자 신고 현황")) ||
    list.find((x) => String(x.ntcnYardOrdrNo || "") === String(VASP_OR)) ||
    list[0];

  const ordrNo = item?.ntcnYardOrdrNo || VASP_OR;

  if (DEBUG) {
    console.log("[KoFIU VASP] chosen title :", item?.ntcnYardSjNm);
    console.log("[KoFIU VASP] chosen ordrNo:", ordrNo);
  }

  // 2) 첨부는 selectBoardFile.do에서 fileId로 받음
  const FILE_URL = "https://www.kofiu.go.kr/cmn/board/selectBoardFile.do";
  const form = new URLSearchParams({
    ntcnYardOrdrNo: String(ordrNo),
    seCd: VASP_SECD,
  });

  const refererUrl =
    "https://www.kofiu.go.kr/kor/notification/notice_view.do" +
    `?ntcnYardOrdrNo=${encodeURIComponent(String(ordrNo))}` +
    `&seCd=${encodeURIComponent(VASP_SECD)}`;

  const fileRes = await axiosWithCookies({
    method: "POST",
    url: FILE_URL,
    data: form,
    headers: {
      ...KOFIU_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: "https://www.kofiu.go.kr",
      Referer: refererUrl,
      Accept: "application/json, text/javascript, */*; q=0.01",
    },
    timeout: 15000,
    validateStatus: () => true,
  });

  debugHttp("KoFIU VASP selectBoardFile.do", fileRes);

  const fbody = fileRes.data;
  if (fbody?.rsMsg?.statusCode === "E") {
    throw new Error(`KoFIU file rsMsg ${fbody.rsMsg.code}: ${fbody.rsMsg.message}`);
  }

  const arr = fbody?.result || fbody?.fileList || fbody?.resultList || fbody?.data || [];
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("KoFIU selectBoardFile.do 결과(result)가 비어 있습니다.");
  }

  const file =
    arr.find((x) => String(x.atchmnflOrginlNm || "").toLowerCase().endsWith(".xlsx")) || arr[0];

  const fileId = file?.fileId;
  if (!fileId) {
    throw new Error("KoFIU 첨부파일 fileId를 찾지 못했습니다.");
  }

  const downloadUrl =
    "https://www.kofiu.go.kr/cmn/file/downloadBoard.do" +
    `?fileId=${encodeURIComponent(String(fileId))}`;

  if (DEBUG) {
    console.log("[KoFIU VASP] file original:", file?.atchmnflOrginlNm);
    console.log("[KoFIU VASP] fileId head  :", String(fileId).slice(0, 25));
    console.log("[KoFIU VASP] referer url  :", refererUrl);
    console.log("[KoFIU VASP] download url :", downloadUrl);
  }

  return { downloadUrl, refererUrl };
}

// ✅ 엑셀 바이너리 다운로드 (쿠키 + 정확한 referer)
async function fetchLatestVaspExcelBuffer() {
  const { downloadUrl, refererUrl } = await fetchLatestVaspExcelDownloadInfoFromKofiu();

  const res = await axiosWithCookies({
    method: "GET",
    url: downloadUrl,
    responseType: "arraybuffer",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
      Referer: refererUrl, // ✅ 가장 안정: 공지 상세 referer
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (DEBUG) {
    console.log("\n[KoFIU VASP] excel download status      :", res.status);
    console.log("[KoFIU VASP] excel download content-type:", res.headers["content-type"]);
    console.log("[KoFIU VASP] excel byte length         :", res.data ? res.data.byteLength : 0);
  }

  if (res.status !== 200) {
    const asText = Buffer.from(res.data || []).toString("utf8");
    if (DEBUG) console.log("[KoFIU VASP] excel download body head  :", asText.slice(0, 400));
    throw new Error(`Excel download failed: HTTP ${res.status}`);
  }

  return Buffer.from(res.data);
}

function extractVaspBaseDate(sheet) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const maxRow = Math.min(range.e.r, 14);
  const dateRegex = /(\d{4})\.(\d{1,2})\.(\d{1,2})/;

  for (let r = 0; r <= maxRow; r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v == null) continue;
      const m = String(cell.v).match(dateRegex);
      if (m) {
        const y = m[1];
        const mo = m[2].padStart(2, "0");
        const d = m[3].padStart(2, "0");
        return `${y}-${mo}-${d}T00:00:00.000Z`;
      }
    }
  }
  return null;
}

function parseVaspExcel(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  fillMerges(sheet);

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  // ✅ 정협님 조건: 엑셀 기준 5~6행(1-based)이 병합 헤더 => 0-based 4,5
  const H1 = 4; // 5행
  const H2 = 5; // 6행
  const headerRow = H2;
  const DATA_START = headerRow + 1;

  let idxService = -1;
  let idxCompany = -1;
  let idxCeo = -1;

  const norm = (s) =>
    String(s ?? "")
      .replace(/\s+/g, "")
      .replace(/\u00A0/g, "")
      .trim();

  const headerText = (c) => {
    const a = norm(rows?.[H1]?.[c]);
    const b = norm(rows?.[H2]?.[c]);
    return norm([a, b].filter(Boolean).join(" "));
  };

  const colCount = Math.max(rows?.[H1]?.length ?? 0, rows?.[H2]?.length ?? 0);

  for (let c = 0; c < colCount; c++) {
    const v = headerText(c);
    const low = v.toLowerCase();

    // ✅ 서비스 헤더는 “서비스명”
    if (idxService < 0 && (v.includes("서비스명") || low.includes("service"))) idxService = c;

    if (
      idxCompany < 0 &&
      (v.includes("법인명") || v.includes("법인") || v.includes("상호") || v.includes("회사") || low.includes("company"))
    ) idxCompany = c;

    if (idxCeo < 0 && (v.includes("대표자") || v.includes("대표") || low.includes("ceo"))) idxCeo = c;
  }

  console.log("[VASP HEADER IDX]", { idxService, idxCompany, idxCeo });
  console.log("[VASP HEADER NAME]", {
    service: idxService >= 0 ? headerText(idxService) : "",
    company: idxCompany >= 0 ? headerText(idxCompany) : "",
    ceo: idxCeo >= 0 ? headerText(idxCeo) : "",
  });

  // ✅ 필수: 서비스/법인명은 반드시 있어야 함
  if (idxService < 0) throw new Error("VASP parse failed: idxService not found (서비스명)");
  if (idxCompany < 0) throw new Error("VASP parse failed: idxCompany not found (법인명/회사)");

  // ✅ 서비스명은 한글 포함(정협님 조건)
  const sampleService = String(rows?.[DATA_START]?.[idxService] ?? "").trim();
  if (!/[가-힣]/.test(sampleService)) {
    throw new Error(`VASP parse failed: service column seems wrong (sample="${sampleService}")`);
  }

  // ✅ 정상 사업자 파싱
  const normal = [];
  const seen = new Set();

  const getCellAt = (r, colIdx) => {
    if (colIdx < 0) return "";
    const cell = sheet[XLSX.utils.encode_cell({ r, c: colIdx })];
    return cell && cell.v != null ? String(cell.v).trim() : "";
  };

  for (let r = DATA_START; r <= range.e.r; r++) {
    const service = getCellAt(r, idxService);
    const company = getCellAt(r, idxCompany);
    const ceo = idxCeo >= 0 ? getCellAt(r, idxCeo) : "";

    // 비어있으면 skip
    if (!service && !company) continue;

    // 주석 시작(미갱신 문구 등) 만나면 중단
    if (String(service).startsWith("※") || String(company).startsWith("※")) break;
// ✅ 표 끝나고 나오는 "설명 문구" 차단 (service=company=ceo 형태로 내려오는 케이스)
if (service && company && service === company && (ceo === service || !ceo)) {
  break;
}

    // 서비스가 숫자만이면(헤더/컬럼 밀림) 즉시 실패해서 fallback으로 넘어가게
    if (/^\d+$/.test(String(service).trim())) {
      throw new Error(`VASP parse failed: service looks numeric ("${service}")`);
    }

    // ✅ 중복 제거 키(순번 대신 내용 기반)
    const key = `${service}|${company}|${ceo}`.replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);

    normal.push({
      no: normal.length + 1, // ✅ 엑셀 순번 안 쓰고 자동 부여
      service,
      company,
      ceo,
    });
  }

  if (DEBUG) console.log("[KoFIU VASP] normal length:", normal.length);

  // ✅ 시트 전체에서 미갱신 문구 탐색
  let expiredNoteRaw = "";
  for (const row of rows) {
    for (const cell of row || []) {
      if (!cell) continue;
      const text = String(cell);
      if (text.includes("신고 유효기간 만료된 미갱신 사업자")) {
        expiredNoteRaw = text;
        break;
      }
    }
    if (expiredNoteRaw) break;
  }
  if (!expiredNoteRaw) expiredNoteRaw = VASP_EXPIRED_NOTE_FALLBACK;

  // ✅ 미갱신 목록: company(service)로 저장
  const expiredList = expiredNoteRaw
    .replace("※ 신고 유효기간 만료된 미갱신 사업자 :", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw, idx) => {
      const { service, company } = splitExpiredText(raw);
      return {
        no: 1001 + idx,
        service: "",
        company: toCompanyServiceFormat(service, company, raw),
      };
    });

  const baseDate = extractVaspBaseDate(sheet);

  return {
    source: "kofiu_excel",
    updatedAt: baseDate || new Date().toISOString(),
    total: normal.length,
    normal,
    expired: expiredList,
    expiredNote: VASP_EXPIRED_NOTE_2,
  };
}
// ================== Worker POST ==================
async function postToWorker(payload) {
  const url = `${WORKER_BASE_URL}/internal/kofiu/vasp/update`;
  const res = await axios.post(url, payload, {
    headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY },
    timeout: 30000,
    validateStatus: () => true,
  });
  return res;
}

// ================== Main ==================
async function main() {
  console.log("========================================");
  console.log("KoFIU VASP Update (Worker+R2)");
  console.log("WORKER_BASE_URL :", WORKER_BASE_URL);
  console.log("DEBUG           :", DEBUG ? "YES" : "NO");
  console.log("========================================");

  let vasp;
  try {
    const buffer = await fetchLatestVaspExcelBuffer();
    vasp = parseVaspExcel(buffer);
  } catch (e) {
    console.error("\n=== KoFIU VASP ERROR ===");
    console.error(e?.message || e);
    vasp = getFallbackVasp();
    console.log("[KoFIU VASP] fallback data used");
  }

  const payload = {
    ...vasp,
    data: Array.isArray(vasp.normal) ? vasp.normal : [],
    total: typeof vasp.total === "number" ? vasp.total : vasp.normal?.length || 0,
  };

  console.log("payload.source   :", payload.source);
  console.log("payload.updatedAt:", payload.updatedAt);
  console.log("payload.total    :", payload.total);
  console.log("normal length    :", payload.normal?.length || 0);
  console.log("expired length   :", payload.expired?.length || 0);

  if (DEBUG && payload.expired?.[0]) {
    console.log("[KoFIU VASP] expired sample:", payload.expired[0]);
  }

  const res = await postToWorker(payload);
  console.log("POST status:", res.status);
  console.log("POST body  :", typeof res.data === "string" ? res.data : JSON.stringify(res.data));

  if (res.status !== 200) process.exit(1);
}

main().catch((e) => {
  console.error("💥 ERROR:", e?.message || e);
  process.exit(1);
});
