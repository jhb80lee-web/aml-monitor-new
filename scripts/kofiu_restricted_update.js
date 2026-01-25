// scripts/kofiu_restricted_update.js
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const JSZip = require("jszip");
const CFB = require("cfb");

// -------------------------
// pdf-parse(v2) 로딩: class 기반(PDFParse) + v1 fallback
// -------------------------
function loadPdfParseEngine() {
  try {
    const m = require("pdf-parse");

    if (m && typeof m.PDFParse === "function") {
      return { kind: "class", PDFParse: m.PDFParse, VerbosityLevel: m.VerbosityLevel };
    }

    if (typeof m === "function") return { kind: "fn", fn: m };
    if (m && typeof m.default === "function") return { kind: "fn", fn: m.default };

    return null;
  } catch {
    return null;
  }
}

const pdfEngine = loadPdfParseEngine();
if (pdfEngine?.kind === "class") console.log("🧩 pdfParseEngine: class(PDFParse OK)");
else if (pdfEngine?.kind === "fn") console.log("🧩 pdfParseEngine: fn(legacy OK)");
else console.log("🧩 pdfParseEngine: (not found)");

// -------------------------
// Config / Env
// -------------------------
const WORKER_BASE_URL =
  process.env.WORKER_BASE_URL || "https://orange-bread-2e13.jhb80lee-793.workers.dev";

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const DRY_RUN = toBool(process.env.DRY_RUN);
const SAVE_RAW_FILE = toBool(process.env.SAVE_RAW_FILE);
const SAVE_PARSED_TEXT = toBool(process.env.SAVE_PARSED_TEXT);
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "30000", 10);
const FETCH_VERBOSE = toBool(process.env.FETCH_VERBOSE);

const KOFIU_ORIGIN = "https://www.kofiu.go.kr";
const SELECT_LAW_FILE_URL = `${KOFIU_ORIGIN}/cmn/board/selectLawFile.do`;
const DOWNLOAD_LAW_URL = `${KOFIU_ORIGIN}/cmn/file/downloadLaw.do`;

const LAW_ORDR_NO = "84";
const LAW_TY_SE_CD = "001";

const ANNOUNCE_VIEW_URL = `${KOFIU_ORIGIN}/kor/law/announce_view.do?lawordInfoOrdrNo=${encodeURIComponent(
  LAW_ORDR_NO
)}&seCd=${encodeURIComponent(LAW_TY_SE_CD)}`;

const TMP_DIR = path.join(process.cwd(), "tmp");

// -------------------------
// Main
// -------------------------
(async function main() {
  console.log("");
  console.log("========================================");
  console.log("KoFIU Restricted Update (expected-aware v2)");
  console.log("WORKER_BASE_URL   :", WORKER_BASE_URL);
  console.log("DRY_RUN           :", DRY_RUN ? "YES" : "NO");
  console.log("SAVE_RAW_FILE     :", SAVE_RAW_FILE ? "YES" : "NO");
  console.log("SAVE_PARSED_TEXT  :", SAVE_PARSED_TEXT ? "YES" : "NO");
  console.log("FETCH_TIMEOUT_MS  :", FETCH_TIMEOUT_MS);
  console.log("FETCH_VERBOSE     :", FETCH_VERBOSE ? "YES" : "NO");
  console.log("========================================");

  // 0) HTML에서 expected 얻기(대부분 실패할 수 있음)
  const expectedOverride = await fetchExpectedFromHtml().catch(() => null);
  console.log(`🎯 expectedOverride(from HTML):`, expectedOverride ?? "(not found)");

  // 1) 첨부 목록 조회 (F12 실제: seCd=001)
  const payload = new URLSearchParams({
    lawordInfoOrdrNo: LAW_ORDR_NO,
    seCd: LAW_TY_SE_CD,
    lawordInfoTySeCd: LAW_TY_SE_CD,
  }).toString();

  console.log(`🌐 fetchLawFiles POST: ${SELECT_LAW_FILE_URL}`);
  console.log(`   payload: ${payload}`);

  const files = await fetchLawFiles(payload);

  console.log(`🔎 selectLawFile.do result count: ${files.length}`);
  for (const f of files) {
    console.log(
      ` - ${f.fileNm || "(no-name)"} | ${f.mime || "(mime?)"} | size=${
        f.fileSize ?? "?"
      } | fileOrdrNo=${f.fileOrdrNo ?? "?"} | fileNm=${f.streFileNm || "?"}`
    );
  }
  if (!files.length) throw new Error("첨부파일 목록이 비어있습니다.");

  // ✅ (추가) 첨부파일명에서 공고/시행일 힌트 추출 (fallback updatedAt 고정용)
  const announceDateHint = detectAnnounceDateIsoFromAttachments(files);
  console.log("🗓️ announceDateHint(from attachments):", announceDateHint ?? "(not found)");

  // 2) 후보 정렬: HWPX 우선
  const candidates = rankAttachments(files);
  console.log("");
  console.log(`🧪 candidates (ranked): ${candidates.length}`);

  // ✅ (핵심) 텍스트에서 날짜 탐지 실패 시 '오늘'이 아니라 '첨부파일명 날짜'로 fallback
  const updatedAt = announceDateHint || new Date().toISOString();

  let best = {
    file: null,
    buf: null,
    kind: "unknown",
    text: "",
    parsed: { updatedAt, total: 0, expected: null, data: [], note: "init" },
    score: -1,
  };

  for (let idx = 0; idx < candidates.length; idx++) {
    const f = candidates[idx];
    console.log("");
    console.log("----------------------------------------");
    console.log(`🔍 try [${idx + 1}/${candidates.length}] ${f.fileNm} (fileOrdrNo=${f.fileOrdrNo})`);

    let ab;
    try {
      ab = await downloadKofiuAttachmentWithRetry(f, 3);
    } catch (e) {
      console.log(`   ❌ download failed: ${trimLong(e?.message || String(e), 240)}`);
      continue;
    }

    const buf = Buffer.from(ab);
    const sniff = sniffFileKind(buf, f);
    console.log(
      `   ⬇️  downloaded: ${fmtBytes(buf.byteLength)} | kind=${sniff.kind} | sha256=${sha256Hex(buf).slice(
        0,
        16
      )}...`
    );

    if (SAVE_RAW_FILE) {
      ensureDir(TMP_DIR);
      const ext = sniff.ext || guessExtFromMimeOrName(f.mime, f.fileNm || "");
      const out = path.join(TMP_DIR, `kofiu_restricted_${ymd()}_${idx + 1}.${ext || "bin"}`);
      fs.writeFileSync(out, buf);
      console.log("   💾 saved raw file:", out);
    }

    let text = "";
    try {
      if (sniff.kind === "pdf") {
        if (!pdfEngine) throw new Error("pdf-parse 엔진이 없습니다.");
        console.log("   🧠 extracting text: PDF");
        text = await extractPdfText(buf, pdfEngine);
      } else if (sniff.kind === "hwpx") {
        console.log("   🧠 extracting text: HWPX");
        text = await extractHwpxText(buf);
      } else if (sniff.kind === "hwp") {
        console.log("   🧠 extracting text: HWP (best-effort)");
        text = extractHwpTextBestEffort(buf);
      } else {
        console.log("   ⚠️  unsupported kind. skip.");
        continue;
      }
    } catch (e) {
      console.log(`   ❌ text extraction failed: ${trimLong(e?.message || String(e), 240)}`);
      continue;
    }

    if (SAVE_PARSED_TEXT) {
      ensureDir(TMP_DIR);
      const outTxt = path.join(TMP_DIR, `kofiu_restricted_${ymd()}_${idx + 1}.txt`);
      fs.writeFileSync(outTxt, text || "", "utf8");
      console.log("   📝 saved extracted text:", outTxt);
    }

    // ✅ 날짜 힌트를 더 많이 주기 위해 fileNm + streFileNm 같이 전달
    const fileHint = [f.fileNm || "", f.streFileNm || ""].filter(Boolean).join(" ");

    const parsed = parseRestrictedFromText(text, updatedAt, expectedOverride, fileHint);
    const score = scoreParsed(parsed, expectedOverride);

    console.log(
      `   🧾 parsed total=${parsed.total} (expected=${parsed.expected ?? "?"}, updatedAt=${parsed.updatedAt}, note=${parsed.note})`
    );
    console.log(`   📈 score=${score} (bestScore=${best.score})`);

    if (score > best.score) {
      best = { file: f, buf, kind: sniff.kind, text, parsed, score };
      console.log(`   ✅ best updated(by score): total=${best.parsed.total} (${best.kind})`);
    }

    if (shouldEarlyStop(best.parsed, expectedOverride)) {
      console.log("   🟢 early stop: expected match/near-match");
      break;
    }
  }

  console.log("");
  console.log("========================================");
  console.log("🏁 RESULT");
  console.log("best.kind   :", best.kind);
  console.log("best.file   :", best.file?.fileNm || "(none)");
  console.log("best.total  :", best.parsed?.total || 0);
  console.log("best.expected:", best.parsed?.expected ?? "(?)");
  console.log("best.note   :", best.parsed?.note || "");
  console.log("best.updatedAt:", best.parsed?.updatedAt || "");
  console.log("best.score  :", best.score);
  console.log("========================================");

  if (!best.file || (best.parsed.total || 0) <= 0) {
    console.log("");
    console.log("🔴 최종 파싱 결과가 0입니다. 업로드를 중단합니다.");
    process.exitCode = 2;
    return;
  }

  if (DRY_RUN) {
    console.log("");
    console.log("🟡 DRY_RUN=1 이므로 Worker 업로드를 생략합니다.");
    return;
  }
  if (best.parsed?.expected && best.parsed.total !== best.parsed.expected) {
    console.log("");
    console.log("🔴 expected mismatch -> 업로드 중단");
    console.log("   expected:", best.parsed.expected, "got:", best.parsed.total);
    process.exitCode = 3;
    return;
  }

  const uploadBody = {
    source: "kofiu",
    updatedAt: best.parsed.updatedAt,
    total: best.parsed.total,
    data: best.parsed.data,
    law: { ordrNo: LAW_ORDR_NO, seCd: LAW_TY_SE_CD },
    expectedOverride: expectedOverride ?? null,
    expectedUsed: best.parsed.expected ?? null,
    file: {
      name: best.file.fileNm || "",
      mime: best.file.mime || "",
      size: best.buf.byteLength,
      sha256: sha256Hex(best.buf),
      fileOrdrNo: best.file.fileOrdrNo,
      fileNm: best.file.streFileNm,
      detectedKind: best.kind,
    },
    parsedNote: best.parsed.note,
  };

  console.log("");
  console.log("🚀 upload to worker:", `${WORKER_BASE_URL}/internal/kofiu/restricted/update`);

  const uploadRes = await fetchWithTimeout(
    `${WORKER_BASE_URL}/internal/kofiu/restricted/update`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify(uploadBody),
    },
    FETCH_TIMEOUT_MS
  );

  const uploadText = await safeReadText(uploadRes);
  if (!uploadRes.ok)
    throw new Error(`Worker upload failed: ${uploadRes.status} ${uploadRes.statusText}\n${uploadText}`);
  console.log("✅ worker response:", trimLong(uploadText, 800));
})().catch((err) => {
  console.error("");
  console.error("❌ FAILED:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

// -------------------------
// ✅ expected from HTML (대부분 not found 가능)
// -------------------------
async function fetchExpectedFromHtml() {
  const res = await fetchWithTimeout(
    ANNOUNCE_VIEW_URL,
    {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
      },
    },
    FETCH_TIMEOUT_MS
  );

  const html = await safeReadText(res);
  if (!res.ok) throw new Error(`announce_view fetch failed: ${res.status}`);

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const m = text.match(/\(\s*([\d,\s]{3,10})\s*명\s*\)/);
  if (!m) return null;
  const n = parseInt(String(m[1]).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

// -------------------------
// ✅ attachment 파일명/저장명에서 날짜 힌트 추출
//    - 고시문('25.12.1.).pdf 같은 케이스를 우선 활용
// -------------------------
function detectAnnounceDateIsoFromAttachments(files) {
  const candidates = [];
  const pushYmd = (y, mo, d) => {
    const yy = Number(y);
    const mm = Number(mo);
    const dd = Number(d);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return;
    if (yy < 2015 || yy > 2100) return;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return;
    candidates.push(new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0)).toISOString());
  };

  for (const f of files || []) {
    const s = `${f.fileNm || ""} ${f.streFileNm || ""}`;

    // ('25.12.1.) 같은 2자리 연도 패턴
    {
      const m = s.match(/['(]\s*(\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.)']/u);
      if (m) pushYmd(2000 + Number(m[1]), m[2], m[3]);
    }

    // YYYYMMDD (예: 20251119xxxx)
    {
      const re = /(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/g;
      let m;
      while ((m = re.exec(s))) pushYmd(m[1], m[2], m[3]);
    }

    // YYYY.MM.DD 같은 정규 패턴
    {
      const re = /\b(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\b/g;
      let m;
      while ((m = re.exec(s))) pushYmd(m[1], m[2], m[3]);
    }
  }

  if (!candidates.length) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

// -------------------------
// Attachment ranking: HWPX 먼저
// -------------------------
function rankAttachments(files) {
  const scoreOne = (f) => {
    const name = String(f.fileNm || "");
    const lname = name.toLowerCase();
    const mime = String(f.mime || "").toLowerCase();

    const hasStrongKw = name.includes("금융거래") || name.includes("제한대상");
    const isPdfLike = lname.endsWith(".pdf") || mime.includes("pdf");
    const isHwpxLike = lname.endsWith(".hwpx") || mime.includes("haansofthwpx") || mime.includes("hwpx");
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

// -------------------------
// ✅ Scoring / EarlyStop
// -------------------------
function scoreParsed(parsed, expectedOverride) {
  const total = Number(parsed?.total || 0);
  const expected = expectedOverride ?? parsed?.expected ?? null;

  if (expected && expected > 0) {
    const diff = Math.abs(total - expected);
    return Math.floor(2000000 / (diff + 1)) + Math.min(total, 5000);
  }

  return Math.min(total, 8000);
}

function shouldEarlyStop(parsed, expectedOverride) {
  const expected = expectedOverride ?? parsed?.expected ?? null;
  if (!expected || expected <= 0) return false;
  const total = Number(parsed?.total || 0);
  if (total < 20) return false;
  return Math.abs(total - expected) <= 1;
}

// -------------------------
// pdf text extraction
// -------------------------
async function extractPdfText(buffer, engine) {
  if (engine.kind === "class") {
    const { PDFParse, VerbosityLevel } = engine;
    const verbosity = (VerbosityLevel && (VerbosityLevel.ERRORS ?? VerbosityLevel.WARNINGS)) ?? 0;

    const parser = new PDFParse({ data: buffer, verbosity });
    try {
      const result = await parser.getText();
      return String(result?.text || "");
    } finally {
      try {
        await parser.destroy();
      } catch (_) {}
    }
  }

  if (engine.kind === "fn") {
    const result = await engine.fn(buffer);
    return String(result?.text || "");
  }

  return "";
}

// -------------------------
// HWPX text extraction
// -------------------------
function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function extractHwpxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);

  let targets = names.filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort();
  if (!targets.length) targets = names.filter((n) => /section\d+\.xml$/i.test(n)).sort();
  if (!targets.length) targets = names.filter((n) => n.toLowerCase().endsWith(".xml")).slice(0, 30);

  const out = [];
  for (const name of targets) {
    const file = zip.file(name);
    if (!file) continue;
    const xml = await file.async("string");

    const parts = [];
    let m;

    const reHp = /<hp:t\b[^>]*>([\s\S]*?)<\/hp:t>/g;
    while ((m = reHp.exec(xml))) {
      const t = decodeXmlEntities(m[1]).replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }

    const reW = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    while ((m = reW.exec(xml))) {
      const t = decodeXmlEntities(m[1]).replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }

    if (parts.length) out.push(parts.join("\n"));
  }

  return out.join("\n");
}

// -------------------------
// HWP text extraction (best-effort)
// -------------------------
function extractHwpTextBestEffort(buffer) {
  let cfb;
  try {
    cfb = CFB.read(buffer, { type: "buffer" });
  } catch {
    throw new Error("HWP: CFB.read failed");
  }

  const entries = cfb?.FileIndex || [];
  const sectionEntries = entries
    .filter((e) => /^BodyText\/Section\d+$/i.test(String(e?.name || "")))
    .sort((a, b) => {
      const ai = parseInt(String(a.name).match(/Section(\d+)/i)?.[1] || "0", 10);
      const bi = parseInt(String(b.name).match(/Section(\d+)/i)?.[1] || "0", 10);
      return ai - bi;
    });

  if (!sectionEntries.length) throw new Error("HWP: BodyText sections not found");

  const texts = [];
  for (const ent of sectionEntries) {
    const raw = Buffer.from(ent.content || []);
    if (!raw.length) continue;

    const unpacked = maybeInflateHwpStream(raw);
    const t = parseHwpRecordsToText(unpacked);
    if (t) texts.push(t);
  }

  return texts.join("\n");
}

function maybeInflateHwpStream(buf) {
  const candidates = [buf];
  try {
    candidates.push(zlib.inflateRawSync(buf));
  } catch (_) {}
  try {
    candidates.push(zlib.inflateSync(buf));
  } catch (_) {}
  candidates.sort((a, b) => (b.length || 0) - (a.length || 0));
  return candidates[0];
}

function parseHwpRecordsToText(buf) {
  let off = 0;
  const out = [];

  while (off + 4 <= buf.length) {
    const header = buf.readUInt32LE(off);
    off += 4;

    const tagId = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;

    if (size === 0xfff) {
      if (off + 4 > buf.length) break;
      size = buf.readUInt32LE(off);
      off += 4;
    }
    if (size < 0 || off + size > buf.length) break;

    const payload = buf.slice(off, off + size);
    off += size;

    if (tagId === 67) {
      const t = decodeMaybeUtf16le(payload);
      if (t) out.push(t);
    }
  }

  const joined = out.join("\n").replace(/\u0000/g, "").trim();
  return joined.length < 30 ? "" : joined;
}

function decodeMaybeUtf16le(payload) {
  if (!payload || !payload.length) return "";
  let s = "";
  try {
    s = payload.toString("utf16le");
  } catch (_) {
    try {
      s = payload.toString("utf8");
    } catch (_) {
      s = "";
    }
  }
  s = s.replace(/\r/g, "\n").replace(/\u0000/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const alpha = (s.match(/[A-Za-z가-힣]/g) || []).length;
  return alpha < 5 ? "" : s;
}

// -------------------------
// Sniff file kind
// -------------------------
function sniffFileKind(buf, metaFile) {
  const name = String(metaFile?.fileNm || "").toLowerCase();
  const mime = String(metaFile?.mime || "").toLowerCase();

  if (looksLikePdf(buf) || name.endsWith(".pdf") || mime.includes("pdf")) return { kind: "pdf", ext: "pdf" };
  if (looksLikeZip(buf) || name.endsWith(".hwpx") || mime.includes("hwpx") || mime.includes("haansofthwpx"))
    return { kind: "hwpx", ext: "hwpx" };
  if (looksLikeOle(buf) || name.endsWith(".hwp") || mime.includes("hwp")) return { kind: "hwp", ext: "hwp" };
  return { kind: "unknown", ext: guessExtFromMimeOrName(mime, name) };
}

function looksLikeZip(buf) {
  return !!buf && buf.length >= 2 && buf.slice(0, 2).toString("utf8") === "PK";
}
function looksLikeOle(buf) {
  if (!buf || buf.length < 8) return false;
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

// -------------------------
// KoFIU: fetch attachments list
// -------------------------
async function fetchLawFiles(formBody) {
  const res = await fetchWithTimeout(
    SELECT_LAW_FILE_URL,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        origin: KOFIU_ORIGIN,
        referer: ANNOUNCE_VIEW_URL,
        "x-requested-with": "XMLHttpRequest",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
      },
      body: formBody,
    },
    FETCH_TIMEOUT_MS
  );

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const raw = await safeReadText(res);

  if (!res.ok) throw new Error(`selectLawFile.do failed: ${res.status} ${res.statusText}\ncontent-type=${ct}\n${raw}`);

  console.log(`   ↩ content-type: ${ct}`);
  console.log(`   ↩ raw head(300): ${trimLong(raw, 300)}`);

  const asJson = safeJsonParse(raw);
  if (asJson && Array.isArray(asJson.result)) return asJson.result.map(normalizeLawAttachment);

  const extracted = extractJsonFromText(raw);
  const asJson2 = extracted ? safeJsonParse(extracted) : null;
  if (asJson2) {
    const list = findAttachmentArray(asJson2);
    if (Array.isArray(list) && list.length) return list.map(normalizeLawAttachment);
  }

  return guessAttachmentsFromText(raw).map(normalizeLawAttachment);
}

function normalizeLawAttachment(item) {
  const fileNm =
    item.atchmnflOrginlNm || item.fileNm || item.orignlFileNm || item.orgnlFileNm || item.atchFileNm || "";

  const streFileNm =
    item.atchmnflStreNm ||
    item.streFileNm ||
    item.stre ||
    item.fileStreNm ||
    item.saveFileName ||
    item.storedFileName ||
    "";

  const fileSize =
    numberOrNull(item.atchmnflSzVal) ??
    numberOrNull(item.fileSize) ??
    numberOrNull(item.size) ??
    numberOrNull(item.fileSz);

  const ext = (path.extname(fileNm || "") || "").replace(".", "").toLowerCase();
  const mime = item.atchmnflTyNm || item.mime || item.contentType || mimeFromExt(ext) || "";

  const fileOrdrNo = item.atchmnflOrdrNo ?? item.fileOrdrNo ?? null;
  const seCd = item.seCd ?? item.lawordInfoTySeCd ?? LAW_TY_SE_CD;
  const ordrNo = item.lawordInfoOrdrNo ?? LAW_ORDR_NO;

  return { ...item, fileNm, streFileNm, fileSize, ext, mime, fileOrdrNo, ordrNo, seCd };
}

// -------------------------
// Download attachment + retry
// -------------------------
async function downloadKofiuAttachmentWithRetry(file, maxTry = 3) {
  let lastErr;
  for (let i = 1; i <= maxTry; i++) {
    try {
      if (FETCH_VERBOSE) console.log(`   🔁 download attempt ${i}/${maxTry}`);
      return await downloadKofiuAttachment(file);
    } catch (e) {
      lastErr = e;
      console.log(`   ⚠️  attempt ${i} failed: ${trimLong(e?.message || String(e), 220)}`);
      if (i < maxTry) await sleep(800 * i);
    }
  }
  throw lastErr;
}

async function downloadKofiuAttachment(file) {
  const seCd = String(file.seCd ?? LAW_TY_SE_CD);
  const ordrNo = String(file.ordrNo ?? LAW_ORDR_NO);
  const fileOrdrNo = String(file.fileOrdrNo ?? file.atchmnflOrdrNo ?? "");
  const fileNm = String(file.streFileNm ?? "");

  if (!fileOrdrNo || !fileNm)
    throw new Error(`downloadLaw.do param missing (fileOrdrNo=${fileOrdrNo}, fileNm=${fileNm})`);

  const referer = `${KOFIU_ORIGIN}/kor/law/announce_view.do?lawordInfoOrdrNo=${encodeURIComponent(
    ordrNo
  )}&seCd=${encodeURIComponent(seCd)}`;
  const url =
    `${DOWNLOAD_LAW_URL}?` +
    `seCd=${encodeURIComponent(seCd)}` +
    `&ordrNo=${encodeURIComponent(ordrNo)}` +
    `&fileOrdrNo=${encodeURIComponent(fileOrdrNo)}` +
    `&fileNm=${encodeURIComponent(fileNm)}`;

  if (FETCH_VERBOSE) {
    console.log(`   ↪ try downloadLaw.do: ${url}`);
    console.log(`     referer: ${referer}`);
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Referer: referer,
        Accept: "*/*",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
      },
      redirect: "follow",
    },
    FETCH_TIMEOUT_MS
  );

  if (!res.ok) {
    const t = await safeReadText(res);
    throw new Error(`downloadLaw.do failed: ${res.status} ${res.statusText}\n${trimLong(t, 400)}`);
  }

  const ab = await res.arrayBuffer();
  const b = Buffer.from(ab);
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  if (ct.includes("text/html") || looksLikeHtml(b)) {
    throw new Error(`download got HTML error page. snippet=\n${trimLong(b.toString("utf8"), 400)}`);
  }
  if (b.length < 10 * 1024) throw new Error(`download too small: ${b.length} bytes (ct=${ct})`);

  return ab;
}

// -------------------------
// ✅ expected 추론
// -------------------------
function inferExpectedFromText(fullText) {
  const raw = String(fullText || "");
  const lines = raw
    .replace(/\r/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const ns = (s) => String(s || "").replace(/\s+/g, "");
  const isYearLike = (n) => n >= 1900 && n <= 2100;

  const parenCandidates = [];
  {
    const flat = raw.replace(/\s+/g, " ");
    const re = /\(\s*([0-9][0-9,\s]{2,30})\s*명\s*\)/g;
    let m;
    while ((m = re.exec(flat))) {
      const n = parseInt(String(m[1]).replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(n) && n >= 50 && n <= 20000 && !isYearLike(n)) {
        parenCandidates.push(n);
      }
    }
  }
  const P = parenCandidates.length ? Math.max(...parenCandidates) : null;

  const startIdx = (() => {
    if (P) {
      const re = new RegExp(`\\(\\s*${P}\\s*명\\s*\\)`);
      for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i;
    }
    for (let i = 0; i < lines.length; i++) {
      const t = ns(lines[i]);
      if (t.includes("대상자") || t.includes("제한대상자")) return i;
    }
    return 0;
  })();

  const endIdx = (() => {
    const endKeywords = ["지정취소", "부칙", "붙임", "고시문", "제한내용"];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const t = ns(lines[i]);
      if (endKeywords.some((k) => t.includes(ns(k)))) return i;
    }
    return lines.length;
  })();

  const slice = lines.slice(startIdx, endIdx);

  let maxIndex = null;
  for (const ln of slice) {
    const m = ln.match(/^(\d{1,5})(?:\s*([.)]|[-–—]))?\s*/);
    if (!m) continue;

    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || isYearLike(n)) continue;
    if (n < 1 || n > 50000) continue;

    if (maxIndex === null || n > maxIndex) maxIndex = n;
  }

  if (P) {
    if (maxIndex && Math.abs(maxIndex - P) <= Math.max(30, Math.floor(P * 0.05))) {
      return maxIndex;
    }
    return P;
  }

  if (maxIndex && maxIndex >= 50 && maxIndex <= 20000) return maxIndex;

  return null;
}

// -------------------------
// ✅ "◇ 참고" 블록 컷 (너무 넓은 ' 참고' 패턴 제거)
// -------------------------
function cutTailAfterReferenceBlock(s) {
  const text = String(s || "");

  const markers = [
    /[◇◆■□]\s*참고(?=\s|$)/u,
    /미국의\s*제재대상자\s*\(SDN\s*List\)/u,
    /ofac\/downloads\/sdnlist\.pdf/i,
  ];

  let idx = -1;
  for (const re of markers) {
    const i = text.search(re);
    if (i >= 0) idx = idx === -1 ? i : Math.min(idx, i);
  }
  return idx >= 0 ? text.slice(0, idx).trim() : text;
}

// -------------------------
// ✅ 문서/파일명에서 날짜 추출 (YYYYMMDD도 지원)
// -------------------------
function detectKofiuYmdIso(fullText, fileHint) {
  const head = String(fullText || "").split("\n").slice(0, 180).join("\n");
  const sources = [`${fileHint || ""}`, head].filter(Boolean);

  const candidates = [];
  const pushYmd = (y, mo, d) => {
    const yy = Number(y);
    const mm = Number(mo);
    const dd = Number(d);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return;
    if (yy < 2015 || yy > 2100) return;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return;
    candidates.push(new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0)).toISOString());
  };

  for (const src of sources) {
    {
      const m = src.match(/['(]\s*(\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.)']/u);
      if (m) pushYmd(2000 + Number(m[1]), m[2], m[3]);
    }

    {
      const re = /(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/g;
      let m;
      while ((m = re.exec(src))) pushYmd(m[1], m[2], m[3]);
    }

    {
      const re =
        /(기준일자?|기준일|게시일|작성일|공고일|고시일|시행일)\s*[:：]?\s*(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/gu;
      let m;
      while ((m = re.exec(src))) pushYmd(m[2], m[3], m[4]);
    }

    {
      const re =
        /(기준일자?|기준일|게시일|작성일|공고일|고시일|시행일)\s*[:：]?\s*(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/gu;
      let m;
      while ((m = re.exec(src))) pushYmd(m[2], m[3], m[4]);
    }

    {
      const re = /\b(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\b/gu;
      let m;
      while ((m = re.exec(src))) pushYmd(m[1], m[2], m[3]);
    }
  }

  if (!candidates.length) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

// -------------------------
// ✅ 마지막 "부칙" 구간의 날짜를 기준일로 사용
// -------------------------
function detectKofiuBuchikYmdIso(fullText) {
  const text = String(fullText || "");

  const reB = /부\s*칙/gu;
  let lastIdx = -1;
  let m;
  while ((m = reB.exec(text))) lastIdx = m.index;

  if (lastIdx < 0) return null;

  const tail = text.slice(lastIdx, lastIdx + 14000);

  const candidates = [];
  const pushYmd = (y, mo, d) => {
    const yy = Number(y);
    const mm = Number(mo);
    const dd = Number(d);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return;
    if (yy < 2015 || yy > 2100) return;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return;
    candidates.push(new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0)).toISOString());
  };

  {
    const re = /(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/g;
    let mm;
    while ((mm = re.exec(tail))) pushYmd(mm[1], mm[2], mm[3]);
  }

  {
    const re = /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
    let mm;
    while ((mm = re.exec(tail))) pushYmd(mm[1], mm[2], mm[3]);
  }

  {
    const re = /['(]\s*(\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/g;
    let mm;
    while ((mm = re.exec(tail))) pushYmd(2000 + Number(mm[1]), mm[2], mm[3]);
  }

  if (!candidates.length) return null;

  candidates.sort();
  return candidates[candidates.length - 1];
}

// -------------------------
// ✅ Parse restricted list
// -------------------------
function parseRestrictedFromText(text, updatedAt, expectedOverride, fileHint = "") {
  const normalizedAll = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const buchikIso = detectKofiuBuchikYmdIso(normalizedAll);
  const detectedIso = detectKofiuYmdIso(normalizedAll, fileHint);
  const realUpdatedAt = buchikIso || detectedIso || updatedAt;

  let cleaned = cutTailAfterReferenceBlock(normalizedAll);

  const expectedMatch =
    cleaned.match(/대상자\s*\(\s*(\d{1,6})\s*명\s*\)/) ||
    cleaned.match(/\(\s*(\d{1,6})\s*명\s*\)/);

  const expectedFromDoc = expectedMatch ? parseInt(expectedMatch[1], 10) : null;
  const expectedInfer = expectedFromDoc ? null : inferExpectedFromText(cleaned);
  const expected = expectedOverride ?? expectedFromDoc ?? expectedInfer ?? null;

  let sliceText = cleaned;

  if (expected) {
    const idx = sliceText.search(new RegExp(`\\(\\s*${expected}\\s*명\\s*\\)`));
    if (idx !== -1) sliceText = sliceText.slice(idx);
  } else {
    const m = sliceText.match(/(별첨|붙임|Annex|APPENDIX|첨부)/);
    if (m && m.index != null) sliceText = sliceText.slice(m.index);
  }

  sliceText = sliceText
    .replace(/^-\s*\d+\s*-$/gm, "\n")
    .replace(/^--\s*\d+\s+of\s+\d+\s+--$/gmi, "\n")
    .replace(/^-?\s*(다\s*음|계\s*속)\s*-?\s*$/gmi, "\n")
    .replace(/\n{3,}/g, "\n\n");

  sliceText = cutTailAfterReferenceBlock(sliceText);

  const itemRe = /(?:^|\n)\s*(\d{1,5})\.\s+([\s\S]*?)(?=\n\s*\d{1,5}\.\s+|$)/g;

  const byNo = new Map();

  const isBadBlock = (s) => {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (!t || t.length < 2) return true;

    if (/^제\s*\d+\s*(조|장)\b/.test(t)) return true;
    if (t.includes("금융위원회")) return true;
    if (t.includes("고시")) return true;
    if (t.includes("부칙")) return true;
    if (t.includes("금융거래등 제한 내용")) return true;
    if (t.includes("금융거래등제한 내용")) return true;

    if (t.includes("지정 취소") && t.length < 40) return true;

    return false;
  };

  const normalizeName = (s) => {
    let t = String(s || "")
      .replace(/\r/g, "\n")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    t = t.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
    t = t.replace(/다\s*음/g, "다음").replace(/계\s*속/g, "계속");

    const i1 = t.search(/[◇◆■□]\s*참고(?=\s|$)/u);
    const i2 = t.search(/미국의\s*제재대상자\s*\(SDN\s*List\)/u);
    const i3 = t.search(/ofac\/downloads\/sdnlist\.pdf/i);
    const cut = [i1, i2, i3].filter((x) => x >= 0);
    if (cut.length) t = t.slice(0, Math.min(...cut)).trim();

    return t;
  };

  let m;
  while ((m = itemRe.exec(sliceText))) {
    const no = parseInt(m[1], 10);
    if (!Number.isFinite(no) || no <= 0) continue;
    if (no >= 1900 && no <= 2100) continue;

    let block = normalizeName(m[2] || "");
    if (block.length < 2) continue;
    if (isBadBlock(block)) continue;

    const prev = byNo.get(no);
    if (!prev || block.length > prev.length) byNo.set(no, block);
  }

  let nos = Array.from(byNo.keys()).sort((a, b) => a - b);
  if (expected) nos = nos.filter((x) => x >= 1 && x <= expected);

  const items = nos.map((no) => ({ no, name: byNo.get(no) }));

  if (items.length < 20) {
    return {
      updatedAt: realUpdatedAt,
      total: 0,
      data: [],
      expected,
      note: `parsed_low_confidence(got=${items.length}, expected=${expected ?? "?"})`,
    };
  }

  const data = items.map((x, idx) => {
    const seq = idx + 1;
    const uid = `KOFIU-RESTRICTED-${seq}`;
    return {
      uid,
      id: uid,
      type: "Entity",
      no: seq,
      name: x.name,
      birth: "",
      country: "",
      isKorea: false,
    };
  });

  const note = expected
    ? `parsed_ok_expected(expected=${expected}, got=${data.length}, maxNo=${items.at(-1)?.no ?? "?"})`
    : `parsed_ok_no_expected(got=${data.length})`;

  return { updatedAt: realUpdatedAt, total: data.length, data, expected, note };
}

// -------------------------
// JSON helpers
// -------------------------
function extractJsonFromText(raw) {
  const s = String(raw || "").trim();
  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  if (firstObj === -1 && firstArr === -1) return null;

  const start = firstArr !== -1 && (firstObj === -1 || firstArr < firstObj) ? firstArr : firstObj;
  const endChar = start === firstArr ? "]" : "}";
  const end = s.lastIndexOf(endChar);
  if (end === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}

function findAttachmentArray(root) {
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    if (Array.isArray(cur)) {
      if (
        cur.length &&
        cur.every(
          (x) =>
            x &&
            typeof x === "object" &&
            ("streFileNm" in x ||
              "orignlFileNm" in x ||
              "fileNm" in x ||
              "atchFileNm" in x ||
              "atchmnflStreNm" in x ||
              "atchmnflOrginlNm" in x)
        )
      ) {
        return cur;
      }
      for (const v of cur) queue.push(v);
      continue;
    }
    for (const v of Object.values(cur)) queue.push(v);
  }
  return null;
}

function guessAttachmentsFromText(raw) {
  const out = [];
  const re =
    /atchmnflStreNm["']?\s*[:=]\s*["']([^"']+)["'][\s\S]{0,160}?atchmnflOrginlNm["']?\s*[:=]\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(raw))) out.push({ atchmnflStreNm: m[1], atchmnflOrginlNm: m[2] });
  return out;
}

// -------------------------
// Misc helpers
// -------------------------
function toBool(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

function fmtBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  const kb = num / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KiB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MiB`;
}

function sha256Hex(bufOrAb) {
  const h = crypto.createHash("sha256");
  h.update(Buffer.isBuffer(bufOrAb) ? bufOrAb : Buffer.from(bufOrAb));
  return h.digest("hex");
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch (_) {
    return null;
  }
}

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mimeFromExt(ext) {
  switch ((ext || "").toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "hwpx":
      return "application/haansofthwpx";
    case "hwp":
      return "application/x-hwp";
    default:
      return "";
  }
}

function guessExtFromMimeOrName(mime, name) {
  const n = (name || "").toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".hwpx")) return "hwpx";
  if (n.endsWith(".hwp")) return "hwp";
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("hwpx")) return "hwpx";
  if (m.includes("hwp")) return "hwp";
  return "bin";
}

function trimLong(s, max) {
  const str = String(s ?? "");
  return str.length <= max ? str : str.slice(0, max) + "…";
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch (_) {
    return "";
  }
}

function looksLikePdf(buf) {
  return !!buf && buf.length >= 4 && buf.slice(0, 4).toString("utf8") === "%PDF";
}

function looksLikeHtml(buf) {
  if (!buf || buf.length < 16) return false;
  const head = buf.slice(0, 200).toString("utf8").toLowerCase();
  return head.includes("<html") || head.includes("<!doctype html");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ymd() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}
