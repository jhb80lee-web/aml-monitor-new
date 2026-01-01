// scripts/check_kofiu_updates.mjs
import fs from "fs";
import crypto from "crypto";

// -------------------- Config --------------------
const STATE_PATH = ".aml_state.json";
const DEBUG = process.env.DEBUG === "1";

const FORCE_VASP = process.env.FORCE_VASP === "1";
const FORCE_RESTRICTED = process.env.FORCE_RESTRICTED === "1";

// KoFIU VASP
const VASP_SECD = "0007";
const LIST_URL = "https://www.kofiu.go.kr/cmn/board/selectBoardListFile.do";
const FILE_URL = "https://www.kofiu.go.kr/cmn/board/selectBoardFile.do";
const NOTICE_VIEW_URL = "https://www.kofiu.go.kr/kor/notification/notice_view.do";

// KoFIU Restricted
const KOFIU_ORIGIN = "https://www.kofiu.go.kr";
const SELECT_LAW_FILE_URL = `${KOFIU_ORIGIN}/cmn/board/selectLawFile.do`;
const LAW_ORDR_NO = "84";
const LAW_TY_SE_CD = "001";

// -------------------- GitHub Actions output helper --------------------
function setOutput(key, value) {
  const out = process.env.GITHUB_OUTPUT;
  const line = `${key}=${value}\n`;
  if (out) fs.appendFileSync(out, line, "utf8");
  else console.log(line.trim());
}

// -------------------- Utils --------------------
function sha256Hex(input) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function logDebug(...args) {
  if (DEBUG) console.log("[DEBUG]", ...args);
}

function readState() {
  const raw = fs.readFileSync(STATE_PATH, "utf8");
  return JSON.parse(raw);
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// -------------------- Minimal cookie jar for KoFIU VASP --------------------
const cookieJar = new Map();

function storeSetCookies(setCookies) {
  if (!setCookies) return;
  const arr = Array.isArray(setCookies) ? setCookies : [setCookies];
  for (const sc of arr) {
    const part = String(sc).split(";")[0];
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    cookieJar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
}

function cookieHeader() {
  if (!cookieJar.size) return "";
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchWithCookies(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const ck = cookieHeader();
  if (ck) headers.set("cookie", ck);

  const res = await fetch(url, { ...options, headers });

  // Node 20: headers.getSetCookie() 지원
  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie");
  storeSetCookies(setCookies);

  return res;
}

async function ensureKofiuSession() {
  // 세션 쿠키 확보 (vasp_update.js와 동일 컨셉)
  const res = await fetchWithCookies("https://www.kofiu.go.kr/kor/notification/notice.do", {
    method: "GET",
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: "https://www.kofiu.go.kr/",
    },
  });
  if (!res.ok) throw new Error(`KoFIU session bootstrap failed: HTTP ${res.status}`);
}

// -------------------- KoFIU VASP meta --------------------
function pickVaspItem(list) {
  // 우선: 제목에 “가상자산사업자 신고 현황”
  const hit =
    list.find((x) => String(x?.ntcnYardSjNm || "").includes("가상자산사업자 신고 현황")) || list[0];
  return hit;
}

async function fetchVaspMeta() {
  await ensureKofiuSession();

  const u = new URL(LIST_URL);
  u.searchParams.set("ntcnYardOrdrNo", "");
  u.searchParams.set("page", "1");
  u.searchParams.set("seCd", VASP_SECD);
  u.searchParams.set("selScope", "");
  u.searchParams.set("size", "20");
  u.searchParams.set("subSech", "");

  const listRes = await fetchWithCookies(u.toString(), {
    method: "GET",
    headers: {
      "user-agent": "Mozilla/5.0",
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json, text/javascript, */*; q=0.01",
      origin: "https://www.kofiu.go.kr",
      referer: "https://www.kofiu.go.kr/",
    },
  });
  if (!listRes.ok) throw new Error(`VASP list fetch failed: HTTP ${listRes.status}`);
  const body = await listRes.json();

  if (body?.rsMsg?.statusCode === "E") {
    throw new Error(`KoFIU rsMsg ${body.rsMsg.code}: ${body.rsMsg.message}`);
  }

  const list = body?.result || body?.resultList || body?.data || [];
  if (!Array.isArray(list) || list.length === 0) throw new Error("KoFIU VASP list empty");

  const item = pickVaspItem(list);
  const ordrNo = String(item?.ntcnYardOrdrNo || "");
  const title = String(item?.ntcnYardSjNm || "");
  if (!ordrNo) throw new Error("KoFIU VASP: ntcnYardOrdrNo not found");

  // 첨부 조회 (fileId 얻기)
  const form = new URLSearchParams({ ntcnYardOrdrNo: ordrNo, seCd: VASP_SECD });

  const refererUrl =
    `${NOTICE_VIEW_URL}?ntcnYardOrdrNo=${encodeURIComponent(ordrNo)}` +
    `&seCd=${encodeURIComponent(VASP_SECD)}`;

  const fileRes = await fetchWithCookies(FILE_URL, {
    method: "POST",
    headers: {
      "user-agent": "Mozilla/5.0",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      origin: "https://www.kofiu.go.kr",
      referer: refererUrl,
      accept: "application/json, text/javascript, */*; q=0.01",
    },
    body: form.toString(),
  });

  if (!fileRes.ok) throw new Error(`VASP file list fetch failed: HTTP ${fileRes.status}`);
  const fbody = await fileRes.json();

  if (fbody?.rsMsg?.statusCode === "E") {
    throw new Error(`KoFIU file rsMsg ${fbody.rsMsg.code}: ${fbody.rsMsg.message}`);
  }

  const files = fbody?.result || fbody?.fileList || fbody?.resultList || fbody?.data || [];
  if (!Array.isArray(files) || files.length === 0) throw new Error("KoFIU VASP file list empty");

  const picked =
    files.find((x) => String(x?.atchmnflOrginlNm || "").toLowerCase().endsWith(".xlsx")) || files[0];

  const fileId = String(picked?.fileId || "");
  const fileName = String(picked?.atchmnflOrginlNm || "");
  if (!fileId) throw new Error("KoFIU VASP fileId not found");

    // ✅ fileId는 세션/발급에 따라 바뀔 수 있어서 change-only 기준에서 제외
  const meta = {
    seCd: VASP_SECD,
    chosen: {
      ntcnYardOrdrNo: ordrNo,
      title,
    },
    file: {
      name: fileName,
      // 필요하면 여기서 picked의 size/ordrNo 같은 "안정적" 값을 추가할 수 있음
      // size: picked?.fileSize ?? picked?.atchmnflSzVal ?? "",
      // fileOrdrNo: picked?.fileOrdrNo ?? picked?.atchmnflOrdrNo ?? ""
    },
  };

  const sig = sha256Hex(stableStringify(meta));
  logDebug("VASP meta", meta);
  logDebug("VASP sig", sig);
  return { sig, meta };
}

// -------------------- KoFIU Restricted meta --------------------
function rankRestrictedAttachment(f) {
  const name = String(f.fileNm || "").toLowerCase();
  const mime = String(f.mime || "").toLowerCase();
  const isHWPX = name.endsWith(".hwpx") || mime.includes("hwpx");
  const isHWP = name.endsWith(".hwp") || mime.includes("hwp");
  const isPDF = name.endsWith(".pdf") || mime.includes("pdf");
  if (isHWPX) return 300;
  if (isHWP) return 200;
  if (isPDF) return 100;
  return 0;
}

async function fetchRestrictedMeta() {
  const payload = new URLSearchParams({
    lawordInfoOrdrNo: LAW_ORDR_NO,
    seCd: LAW_TY_SE_CD,
    lawordInfoTySeCd: LAW_TY_SE_CD,
  }).toString();

  const res = await fetch(SELECT_LAW_FILE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      "user-agent": "Mozilla/5.0",
      origin: KOFIU_ORIGIN,
      referer: `${KOFIU_ORIGIN}/kor/law/announce_view.do?lawordInfoOrdrNo=${encodeURIComponent(
        LAW_ORDR_NO
      )}&seCd=${encodeURIComponent(LAW_TY_SE_CD)}`,
      accept: "application/json, text/javascript, */*;q=0.01",
    },
    body: payload,
  });

  if (!res.ok) throw new Error(`selectLawFile.do failed: HTTP ${res.status}`);
  const json = await res.json();

  const filesRaw = Array.isArray(json) ? json : Array.isArray(json.result) ? json.result : [];
  if (!filesRaw.length) throw new Error("selectLawFile.do returned empty list");

  // ✅ KoFIU 응답 필드명(atchmnfl*)를 실제로 쓰도록 정규화
  const normalized = filesRaw.map((it) => {
    const fileNm =
      it.atchmnflOrginlNm ||
      it.fileNm ||
      it.orignlFileNm ||
      it.orgnlFileNm ||
      it.atchFileNm ||
      "";

    const streFileNm =
      it.atchmnflStreNm ||
      it.streFileNm ||
      it.stre ||
      it.fileStreNm ||
      it.saveFileName ||
      it.storedFileName ||
      "";

    const fileSizeRaw = it.atchmnflSzVal ?? it.fileSize ?? it.size ?? it.fileSz ?? "";
    const fileSize =
      typeof fileSizeRaw === "number"
        ? fileSizeRaw
        : String(fileSizeRaw).trim() === ""
        ? ""
        : Number(String(fileSizeRaw).replace(/[^\d]/g, "")) || "";

    const fileOrdrNo = it.atchmnflOrdrNo ?? it.fileOrdrNo ?? "";

    const mime = it.atchmnflTyNm || it.mime || it.contentType || "";

    // 변경 감지에 유용한 코스/경로도 같이 보관(있으면)
    const cours = it.atchmnflCoursNm || it.coursNm || it.path || "";

    return { fileNm, streFileNm, fileOrdrNo, fileSize, mime, cours };
  });

  const best = [...normalized].sort((a, b) => rankRestrictedAttachment(b) - rankRestrictedAttachment(a))[0];

  const meta = {
    law: { ordrNo: LAW_ORDR_NO, seCd: LAW_TY_SE_CD, lawordInfoTySeCd: LAW_TY_SE_CD },
    best,
    filesDigest: sha256Hex(
      stableStringify(
        [...normalized].sort((a, b) => {
          const ka = `${a.fileOrdrNo}|${a.fileNm}|${a.streFileNm}`;
          const kb = `${b.fileOrdrNo}|${b.fileNm}|${b.streFileNm}`;
          return ka.localeCompare(kb);
        })
      )
    ),
  };

  const sig = sha256Hex(stableStringify(meta));
  logDebug("Restricted meta", meta);
  logDebug("Restricted sig", sig);
  return { sig, meta };
}

// -------------------- Main --------------------
(async () => {
  const state = readState();

  // ensure skeleton
  state.kofiu = state.kofiu || {};
  state.kofiu.vasp = state.kofiu.vasp || { sig: "", meta: {} };
  state.kofiu.restricted = state.kofiu.restricted || { sig: "", meta: {} };

  let vaspChanged = false;
  let restrictedChanged = false;

  // ---- VASP ----
  try {
    const latest = await fetchVaspMeta();
    vaspChanged = FORCE_VASP || latest.sig !== (state.kofiu.vasp.sig || "");
    if (vaspChanged) {
      state.kofiu.vasp = latest;
      writeState(state);
    }
  } catch (e) {
    console.log(`[WARN] VASP meta fetch failed: ${e?.message || String(e)}`);
    vaspChanged = FORCE_VASP ? true : false;
  }

  // ---- Restricted ----
  try {
    const latest = await fetchRestrictedMeta();
    restrictedChanged = FORCE_RESTRICTED || latest.sig !== (state.kofiu.restricted.sig || "");
    if (restrictedChanged) {
      state.kofiu.restricted = latest;
      writeState(state);
    }
  } catch (e) {
    console.log(`[WARN] Restricted meta fetch failed: ${e?.message || String(e)}`);
    restrictedChanged = FORCE_RESTRICTED ? true : false;
  }

  setOutput("vasp_changed", vaspChanged ? "true" : "false");
  setOutput("restricted_changed", restrictedChanged ? "true" : "false");

  console.log(
    `[KoFIU check] vasp_changed=${vaspChanged} restricted_changed=${restrictedChanged} (force_vasp=${FORCE_VASP} force_restricted=${FORCE_RESTRICTED})`
  );
})();
