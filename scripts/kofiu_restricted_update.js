// scripts/kofiu_restricted_update.js
"use strict";

/**
 * KoFIU Restricted Update (latest-ordrNo + real-date + backtrack)
 *
 * 목표
 * - 최신 ordrNo를 자동 탐색 (PROBE_START_ORDR_NO ~ PROBE_MAX)
 * - BUT: 최신 공고(ordrNo)가 “개정고시안”처럼 대상자 리스트가 비어있으면,
 *   자동으로 과거 ordrNo로 내려가며 “리스트가 실제 포함된 회차”를 찾는다 (BACKTRACK_MAX)
 * - updatedAt은 “워크플로우 실행일”이 아니라,
 *   선택된 ordrNo의 announce_view에서 찾은 게시/등록/공고/작성일(실제 사이트 날짜)을 우선 사용
 *   + 단, 같은 회차에 "고시문('YY.MM.DD)" 첨부가 있으면 그 날짜를 최우선으로 사용한다
 * - “고시문('YY.MM.DD).pdf/hwpx”는 리스트 파싱에서는 절대 읽지 않도록 첨부파일 후보 단계에서 차단
 *
 * 실행 예)
 *   export WORKER_BASE_URL="https://....workers.dev"
 *   export DRY_RUN=1
 *   export PROBE_START_ORDR_NO=80
 *   export PROBE_MAX=30
 *   export BACKTRACK_MAX=30
 *   node scripts/kofiu_restricted_update.js
 *
 * 업로드
 *   export DRY_RUN=0
 *   export ADMIN_KEY="..."
 *   node scripts/kofiu_restricted_update.js
 */

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

const AUTO_ORDR_NO = process.env.AUTO_ORDR_NO == null ? true : toBool(process.env.AUTO_ORDR_NO);
const LAW_ORDR_NO_ENV = process.env.LAW_ORDR_NO ? parseInt(process.env.LAW_ORDR_NO, 10) : null;

const PROBE_START_ORDR_NO = parseInt(process.env.PROBE_START_ORDR_NO || "80", 10);
const PROBE_MAX = parseInt(process.env.PROBE_MAX || "30", 10);
const BACKTRACK_MAX = parseInt(process.env.BACKTRACK_MAX || "30", 10);

const KOFIU_ORIGIN = "https://www.kofiu.go.kr";
const SELECT_LAW_FILE_URL = `${KOFIU_ORIGIN}/cmn/board/selectLawFile.do`;
const DOWNLOAD_LAW_URL = `${KOFIU_ORIGIN}/cmn/file/downloadLaw.do`;

const DEFAULT_SE_CD = "001"; // restricted
const LAW_TY_SE_CD = DEFAULT_SE_CD;

const TMP_DIR = path.join(process.cwd(), "tmp");

// -------------------------
// Main
// -------------------------
(async function main() {
  console.log("");
  console.log("========================================");
  console.log("KoFIU Restricted Update (latest-ordrNo + real-date)");
  console.log("WORKER_BASE_URL   :", WORKER_BASE_URL);
  console.log("DRY_RUN           :", DRY_RUN ? "YES" : "NO");
  console.log("SAVE_RAW_FILE     :", SAVE_RAW_FILE ? "YES" : "NO");
  console.log("SAVE_PARSED_TEXT  :", SAVE_PARSED_TEXT ? "YES" : "NO");
  console.log("FETCH_TIMEOUT_MS  :", FETCH_TIMEOUT_MS);
  console.log("FETCH_VERBOSE     :", FETCH_VERBOSE ? "YES" : "NO");
  console.log("AUTO_ORDR_NO      :", AUTO_ORDR_NO ? "YES" : "NO");
  console.log("LAW_ORDR_NO(env)  :", LAW_ORDR_NO_ENV != null ? String(LAW_ORDR_NO_ENV) : "(not set)");
  console.log("PROBE_START_ORDR_NO:", PROBE_START_ORDR_NO);
  console.log("PROBE_MAX         :", PROBE_MAX);
  console.log("BACKTRACK_MAX     :", BACKTRACK_MAX);
  console.log("========================================");

  const selectedSeCd = LAW_TY_SE_CD;

  // 1) ordrNo 선택: env 우선, 아니면 probe
  let selectedOrdrNo = null;

  if (LAW_ORDR_NO_ENV != null && Number.isFinite(LAW_ORDR_NO_ENV)) {
    selectedOrdrNo = LAW_ORDR_NO_ENV;
  } else if (AUTO_ORDR_NO) {
    console.log(
      `🧪 probing latest ordrNo: start=${PROBE_START_ORDR_NO}, maxAdvance=${PROBE_MAX}, seCd=${selectedSeCd}`
    );
    const latest = await probeLatestOrdrNo(PROBE_START_ORDR_NO, PROBE_MAX, selectedSeCd);
    selectedOrdrNo = latest.latestOrdrNo;
    console.log(`🧭 probe result latestOrdrNo: ${selectedOrdrNo} (fallback=${latest.fallback})`);
  } else {
    selectedOrdrNo = 84;
  }

  // 2) 최신 ordrNo가 리스트가 비어있을 수 있으니, 백트랙하여 "리스트 포함 회차"를 찾는다.
  let finalRun = null;

  for (let back = 0; back <= BACKTRACK_MAX; back++) {
    const tryOrdr = selectedOrdrNo - back;
    if (tryOrdr <= 0) break;

    console.log("");
    console.log("========================================");
    console.log(`🔁 BACKTRACK try ordrNo=${tryOrdr} (back=${back}/${BACKTRACK_MAX})`);
    console.log("========================================");

    const run = await runOnceForOrdrNo(tryOrdr, selectedSeCd);

    if (run.ok) {
      finalRun = run;
      break;
    }

    console.log(`⚠️  ordrNo=${tryOrdr} has no usable list (total<20). continue backtrack...`);
  }

  if (!finalRun) {
    console.log("");
    console.log("🔴 BACKTRACK_MAX 범위 내에서 '대상자 리스트'를 찾지 못했습니다. 업로드 중단.");
    process.exitCode = 2;
    return;
  }

  const { ordrNo: finalOrdrNo, seCd: finalSeCd, best, fixedUpdatedAt } = finalRun;

  console.log("");
  console.log("========================================");
  console.log("🏁 RESULT");
  console.log("ordrNo        :", finalOrdrNo);
  console.log("seCd          :", finalSeCd);
  console.log("best.kind     :", best.kind);
  console.log("best.file     :", best.file?.fileNm || "(none)");
  console.log("best.total    :", best.parsed?.total || 0);
  console.log("best.expected :", best.parsed?.expected ?? "(?)");
  console.log("best.note     :", best.parsed?.note || "");
  console.log("best.updatedAt:", best.parsed?.updatedAt || "");
  console.log("fixedUpdatedAt:", fixedUpdatedAt || "");
  console.log("best.score    :", best.score);
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
    law: { ordrNo: String(finalOrdrNo), seCd: String(finalSeCd) },
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
// One run for a given ordrNo
// -------------------------
async function runOnceForOrdrNo(ordrNo, seCd) {
  const ANNOUNCE_VIEW_URL = makeAnnounceViewUrl(ordrNo, seCd);

  console.log("🧭 selected ordrNo :", ordrNo);
  console.log("🧭 selected seCd   :", seCd);
  console.log("🧭 announce_view   :", ANNOUNCE_VIEW_URL);

  const announceMeta = await fetchAnnounceMetaFromView(ANNOUNCE_VIEW_URL).catch(() => null);
  const realSiteUpdatedAt = announceMeta?.dateIso || null;
  const expectedOverride = announceMeta?.expectedOverride ?? null;

  console.log(`🗓️ realSiteUpdatedAt(from announce_view):`, realSiteUpdatedAt ?? "(not found)");
  console.log(`🎯 expectedOverride(from announce_view):`, expectedOverride ?? "(not found)");

  const currentLatestUpdatedAt = await fetchCurrentLatestUpdatedAtFromWorker().catch(() => null);
  console.log("🧷 currentLatestUpdatedAt(from worker):", currentLatestUpdatedAt ?? "(not found)");

  // 첨부 목록 조회
  const payload = new URLSearchParams({
    lawordInfoOrdrNo: String(ordrNo),
    seCd: String(seCd),
    lawordInfoTySeCd: String(seCd),
  }).toString();

  console.log(`🌐 fetchLawFiles POST: ${SELECT_LAW_FILE_URL}`);
  console.log(`   payload: ${payload}`);

  const filesAll = await fetchLawFiles(payload);

  // ✅ (핵심) 고시문은 "리스트 파싱 후보"에서는 차단하지만,
  // updatedAt 추출용으로는 최우선으로 사용한다.
  const gosiUpdatedAt = await extractUpdatedAtFromGosiFiles(filesAll, ordrNo, seCd).catch(() => null);
  if (gosiUpdatedAt) {
    console.log("📌 gosiUpdatedAt(from gosi files):", gosiUpdatedAt);
  }

  // ✅ updatedAt 고정 우선순위:
  // 1) 고시문('YY.MM.DD)에서 추출한 날짜
  // 2) announce_view 날짜
  // 3) worker 최신
  // 4) 현재시간 fallback
  // ✅ 최종 형식은 "YYYY-MM-DD"로 정규화한다.
  const fixedUpdatedAt = normalizeUpdatedAt(
    gosiUpdatedAt || realSiteUpdatedAt || currentLatestUpdatedAt || new Date().toISOString()
  );

  // ✅ 고시문('YY.MM.DD) 절대 읽지 않도록 리스트 후보에서 차단
  const files = (filesAll || []).filter((f) => !isGosiMunFile(f));

  console.log(`🔎 selectLawFile.do result count: ${filesAll.length} (usable: ${files.length})`);
  for (const f of filesAll) {
    console.log(
      ` - ${f.fileNm || "(no-name)"} | ${f.mime || "(mime?)"} | size=${f.fileSize ?? "?"} | fileOrdrNo=${
        f.fileOrdrNo ?? "?"
      } | fileNm=${f.streFileNm || "?"}${isGosiMunFile(f) ? "  🚫(blocked:gosi문)" : ""}`
    );
  }

  if (!files.length) {
    return { ok: false, reason: "no_usable_attachments", ordrNo, seCd };
  }

  // 후보 정렬: HWPX 우선
  const candidates = rankAttachments(files);
  console.log("");
  console.log(`🧪 candidates (ranked): ${candidates.length}`);

  let best = {
    file: null,
    buf: null,
    kind: "unknown",
    parsed: { updatedAt: fixedUpdatedAt, total: 0, expected: null, data: [], note: "init" },
    score: -1,
  };

  for (let idx = 0; idx < candidates.length; idx++) {
    const f = candidates[idx];
    console.log("");
    console.log("----------------------------------------");
    console.log(`🔍 try [${idx + 1}/${candidates.length}] ${f.fileNm} (fileOrdrNo=${f.fileOrdrNo})`);

    let ab;
    try {
      ab = await downloadKofiuAttachmentWithRetry(f, 3, ordrNo, seCd);
    } catch (e) {
      console.log(`   ❌ download failed: ${trimLong(e?.message || String(e), 240)}`);
      continue;
    }

    const buf = Buffer.from(ab);
    const sniff = sniffFileKind(buf, f);
    console.log(
      `   ⬇️  downloaded: ${fmtBytes(buf.byteLength)} | kind=${sniff.kind} | sha256=${sha256Hex(buf).slice(0, 16)}...`
    );

    if (SAVE_RAW_FILE) {
      ensureDir(TMP_DIR);
      const ext = sniff.ext || guessExtFromMimeOrName(f.mime, f.fileNm || "");
      const out = path.join(TMP_DIR, `kofiu_restricted_${ordrNo}_${ymd()}_${idx + 1}.${ext || "bin"}`);
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
      const outTxt = path.join(TMP_DIR, `kofiu_restricted_${ordrNo}_${ymd()}_${idx + 1}.txt`);
      fs.writeFileSync(outTxt, text || "", "utf8");
      console.log("   📝 saved extracted text:", outTxt);
    }

    const fileHint = [f.fileNm || "", f.streFileNm || ""].filter(Boolean).join(" ");

    // ✅ (핵심) updatedAt은 반드시 fixedUpdatedAt으로 고정 (문서 내부 날짜로 절대 덮어쓰지 않음)
    const parsed = parseRestrictedFromText(text, fixedUpdatedAt, expectedOverride, fileHint);
    const score = scoreParsed(parsed, expectedOverride);

    console.log(
      `   🧾 parsed total=${parsed.total} (expected=${parsed.expected ?? "?"}, updatedAt=${parsed.updatedAt}, note=${parsed.note})`
    );
    console.log(`   📈 score=${score} (bestScore=${best.score})`);

    if (score > best.score) {
      best = { file: f, buf, kind: sniff.kind, parsed, score };
      console.log(`   ✅ best updated(by score): total=${best.parsed.total} (${best.kind})`);
    }

    if (shouldEarlyStop(best.parsed, expectedOverride)) {
      console.log("   🟢 early stop: expected match/near-match");
      break;
    }
  }

  // ✅ 리스트 여부 판정: 20 미만이면 "리스트 없음"으로 간주
  const ok = (best.parsed?.total || 0) >= 20;

  return {
    ok,
    ordrNo,
    seCd,
    best,
    fixedUpdatedAt,
    expectedOverride,
  };
}

// -------------------------
// ✅ 고시문 파일에서 updatedAt 추출 (파일명 우선, 필요시 본문)
// -------------------------
async function extractUpdatedAtFromGosiFiles(filesAll, ordrNo, seCd) {
  const all = Array.isArray(filesAll) ? filesAll : [];
  const gosi = all.filter(isGosiMunFile);
  if (!gosi.length) return null;

  // 1) 파일명에서 'YY.MM.DD' 최우선 추출
  for (const f of gosi) {
    const ymd = extractDateFromGosiFilename(f?.fileNm);
    if (ymd) return ymd;
  }

  // 2) 그래도 못 찾으면: PDF 우선으로 1개만 받아서 본문에서 날짜 추출
  // (고시문은 보통 매우 짧으니 비용 작음)
  const ranked = [...gosi].sort((a, b) => {
    const aPdf = String(a?.fileNm || "").toLowerCase().endsWith(".pdf") ? 1 : 0;
    const bPdf = String(b?.fileNm || "").toLowerCase().endsWith(".pdf") ? 1 : 0;
    return bPdf - aPdf;
  });

  const target = ranked[0];
  let ab;
  try {
    ab = await downloadKofiuAttachmentWithRetry(target, 2, ordrNo, seCd);
  } catch {
    return null;
  }

  const buf = Buffer.from(ab);
  const sniff = sniffFileKind(buf, target);

  let text = "";
  try {
    if (sniff.kind === "pdf") {
      if (!pdfEngine) return null;
      text = await extractPdfText(buf, pdfEngine);
    } else if (sniff.kind === "hwpx") {
      text = await extractHwpxText(buf);
    } else if (sniff.kind === "hwp") {
      text = extractHwpTextBestEffort(buf);
    } else {
      return null;
    }
  } catch {
    return null;
  }

  const ymd = extractMaxDateFromText(text);
  return ymd || null;
}

function extractDateFromGosiFilename(name) {
  const s = String(name || "");

  // 예: 고시문('25.12.1.).pdf / 고시문('25.12.01).hwpx
  let m = s.match(
    /고시문\s*\(\s*['"]?\s*(\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*['"]?\s*\)/u
  );
  if (!m) {
    m = s.match(/['"]\s*(\d{2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*['"]/u);
  }

  if (!m) return null;

  const yy = 2000 + Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (yy < 2015 || yy > 2100) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  return toYmd(yy, mm, dd);
}

// -------------------------
// ordrNo probing (selectLawFile.do가 열리는 마지막 번호 탐색)
// -------------------------
async function probeLatestOrdrNo(startOrdrNo, maxAdvance, seCd) {
  let lastGood = null;

  for (let i = 0; i <= maxAdvance; i++) {
    const ordrNo = startOrdrNo + i;
    const payload = new URLSearchParams({
      lawordInfoOrdrNo: String(ordrNo),
      seCd: String(seCd),
      lawordInfoTySeCd: String(seCd),
    }).toString();

    try {
      const files = await fetchLawFiles(payload);
      if (Array.isArray(files) && files.length > 0) {
        lastGood = ordrNo;
      }
    } catch (_) {}
  }

  return {
    latestOrdrNo: lastGood != null ? lastGood : startOrdrNo,
    fallback: startOrdrNo,
  };
}

// -------------------------
// announce_view meta: 날짜 + (있으면) expected override
// -------------------------
async function fetchAnnounceMetaFromView(announceViewUrl) {
  const res = await fetchWithTimeout(
    announceViewUrl,
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

  const textKeepScript = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const expSrc = textKeepScript + " " + html;
  const mExp = expSrc.match(/\(\s*([\d,\s]{3,10})\s*명\s*\)/);
  const expectedOverride = mExp ? parseInt(String(mExp[1]).replace(/[^\d]/g, ""), 10) : null;

  const dateIso =
    extractDateNearKeywords(textKeepScript, ["게시일", "등록일", "공고일", "고시일", "작성일"]) ||
    extractMaxDateFromText(textKeepScript) ||
    extractDateNearKeywords(html, ["게시일", "등록일", "공고일", "고시일", "작성일"]) ||
    extractMaxDateFromText(html);

  return {
    dateIso: dateIso || null,
    expectedOverride: Number.isFinite(expectedOverride) ? expectedOverride : null,
  };
}

function extractDateNearKeywords(src, keywords) {
  const s = String(src || "");
  for (const kw of keywords || []) {
    const idx = s.indexOf(kw);
    if (idx < 0) continue;
    const window = s.slice(Math.max(0, idx - 40), Math.min(s.length, idx + 120));
    const ymd = extractMaxDateFromText(window);
    if (ymd) return ymd;
  }
  return null;
}

function extractMaxDateFromText(src) {
  const text = String(src || "");
  const candidates = [];

  const pushYmd = (y, mo, d) => {
    const yy = Number(y);
    const mm = Number(mo);
    const dd = Number(d);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return;
    if (yy < 2015 || yy > 2100) return;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return;
    candidates.push(toYmd(yy, mm, dd));
  };

  {
    const re = /\b(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\b/g;
    let m;
    while ((m = re.exec(text))) pushYmd(m[1], m[2], m[3]);
  }

  {
    const re = /\b(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\b/g;
    let m;
    while ((m = re.exec(text))) pushYmd(m[1], m[2], m[3]);
  }

  {
    const re = /['(]\s*(\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.)']/g;
    let m;
    while ((m = re.exec(text))) pushYmd(2000 + Number(m[1]), m[2], m[3]);
  }

  if (!candidates.length) return null;
  candidates.sort();
  return candidates[candidates.length - 1];
}

// -------------------------
// make announce_view url
// -------------------------
function makeAnnounceViewUrl(ordrNo, seCd) {
  return `${KOFIU_ORIGIN}/kor/law/announce_view.do?lawordInfoOrdrNo=${encodeURIComponent(
    String(ordrNo)
  )}&seCd=${encodeURIComponent(String(seCd))}`;
}

// -------------------------
// Worker current latest updatedAt (fallback용)
// -------------------------
async function fetchCurrentLatestUpdatedAtFromWorker() {
  const url = `${WORKER_BASE_URL}/kofiu/restricted/latest?ts=${Date.now()}`;
  const res = await fetchWithTimeout(
    url,
    { method: "GET", headers: { Accept: "application/json" } },
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) return null;

  const raw = await safeReadText(res);
  const j = safeJsonParse(raw);
  const u = j && typeof j === "object" ? j.updatedAt : null;
  if (!u) return null;

  // ✅ 여기서도 "YYYY-MM-DD"로 정규화해둔다.
  return normalizeUpdatedAt(u);
}

// -------------------------
// 고시문('YY.MM.DD).pdf/hwpx 차단 (리스트 후보에서)
// -------------------------
function isGosiMunFile(f) {
  const name = String(f?.fileNm || "");
  if (name.includes("고시문")) return true;
  return false;
}

// -------------------------
// Attachment ranking: HWPX 먼저
// -------------------------
function rankAttachments(files) {
  const scoreOne = (f) => {
    const name = String(f.fileNm || "");
    const lname = name.toLowerCase();
    const mime = String(f.mime || "").toLowerCase();

    const hasStrongKw =
      name.includes("금융거래") ||
      name.includes("제한대상") ||
      name.includes("제한 대상") ||
      name.includes("지정") ||
      name.includes("취소");

    const isPdfLike = lname.endsWith(".pdf") || mime.includes("pdf");
    const isHwpxLike = lname.endsWith(".hwpx") || mime.includes("haansofthwpx") || mime.includes("hwpx");
    const isHwpLike = lname.endsWith(".hwp") || mime.includes("hwp");

    let typeScore = 0;
    if (isHwpxLike) typeScore = 600;
    else if (isPdfLike) typeScore = 450;
    else if (isHwpLike) typeScore = 200;

    const kwScore = hasStrongKw ? 500 : 0;
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
        referer: `${KOFIU_ORIGIN}/kor/law/announce_view.do`,
        "x-requested-with": "XMLHttpRequest",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
      },
      body: formBody,
    },
    FETCH_TIMEOUT_MS
  );

  const raw = await safeReadText(res);

  if (!res.ok) {
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    throw new Error(`selectLawFile.do failed: ${res.status} ${res.statusText}\ncontent-type=${ct}\n${raw}`);
  }

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
  const ordrNo = item.lawordInfoOrdrNo ?? null;

  return { ...item, fileNm, streFileNm, fileSize, ext, mime, fileOrdrNo, ordrNo, seCd };
}

// -------------------------
// Download attachment + retry
// -------------------------
async function downloadKofiuAttachmentWithRetry(file, maxTry = 3, ordrNo, seCd) {
  let lastErr;
  for (let i = 1; i <= maxTry; i++) {
    try {
      if (FETCH_VERBOSE) console.log(`   🔁 download attempt ${i}/${maxTry}`);
      return await downloadKofiuAttachment(file, ordrNo, seCd);
    } catch (e) {
      lastErr = e;
      console.log(`   ⚠️  attempt ${i} failed: ${trimLong(e?.message || String(e), 220)}`);
      if (i < maxTry) await sleep(800 * i);
    }
  }
  throw lastErr;
}

async function downloadKofiuAttachment(file, ordrNo, seCd) {
  const _seCd = String(seCd ?? file.seCd ?? LAW_TY_SE_CD);
  const _ordrNo = String(ordrNo ?? file.ordrNo ?? file.lawordInfoOrdrNo ?? "");
  const fileOrdrNo = String(file.fileOrdrNo ?? file.atchmnflOrdrNo ?? "");
  const fileNm = String(file.streFileNm ?? "");

  if (!fileOrdrNo || !fileNm)
    throw new Error(`downloadLaw.do param missing (fileOrdrNo=${fileOrdrNo}, fileNm=${fileNm})`);

  const referer = makeAnnounceViewUrl(_ordrNo, _seCd);
  const url =
    `${DOWNLOAD_LAW_URL}?` +
    `seCd=${encodeURIComponent(_seCd)}` +
    `&ordrNo=${encodeURIComponent(_ordrNo)}` +
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
// ✅ expected 추론 (리스트 문서에만 의미 있음)
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
// ✅ "◇ 참고" 블록 컷
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
// ✅ Parse restricted list
//    - 중요: updatedAt은 무조건 인자로 받은 fixedUpdatedAt을 사용한다.
//      (문서/파일명에서 날짜를 다시 뽑아 updatedAt을 덮어쓰지 않는다.)
// -------------------------
function parseRestrictedFromText(text, fixedUpdatedAt, expectedOverride, _fileHint = "") {
  const normalizedAll = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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

  const normalizeBlock = (s) => {
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

  const extractDisplayName = (s) => {
    let t = String(s || "")
      .replace(/\r/g, " ")
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!t) return "";

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
    return t;
  };

  let m;
  while ((m = itemRe.exec(sliceText))) {
    const no = parseInt(m[1], 10);
    if (!Number.isFinite(no) || no <= 0) continue;
    if (no >= 1900 && no <= 2100) continue;

    let block = normalizeBlock(m[2] || "");
    if (block.length < 2) continue;
    if (isBadBlock(block)) continue;

    const displayName = extractDisplayName(block);
    if (displayName.length < 2) continue;

    const prev = byNo.get(no);
    if (!prev || block.length > prev.rawText.length) {
      byNo.set(no, {
        name: displayName,
        rawText: block,
      });
    }
  }

  let nos = Array.from(byNo.keys()).sort((a, b) => a - b);
  if (expected) nos = nos.filter((x) => x >= 1 && x <= expected);

  const items = nos.map((no) => ({ no, ...byNo.get(no) }));

  if (items.length < 20) {
    return {
      updatedAt: fixedUpdatedAt,
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
      rawText: x.rawText,
      birth: "",
      country: "",
      isKorea: false,
    };
  });

  const note = expected
    ? `parsed_ok_expected(expected=${expected}, got=${data.length}, maxNo=${items.at(-1)?.no ?? "?"})`
    : `parsed_ok_no_expected(got=${data.length})`;

  return { updatedAt: fixedUpdatedAt, total: data.length, data, expected, note };
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

// -------------------------
// ✅ 날짜 유틸 (최종 updatedAt은 항상 YYYY-MM-DD)
// -------------------------
function pad2(n) {
  const x = String(n);
  return x.length === 1 ? "0" + x : x;
}
function toYmd(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function normalizeUpdatedAt(v) {
  const s = String(v ?? "").trim();
  // 이미 YYYY-MM-DD면 그대로
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    // UTC 기준 YYYY-MM-DD
    const yy = d.getUTCFullYear();
    const mm = d.getUTCMonth() + 1;
    const dd = d.getUTCDate();
    if (yy >= 2015 && yy <= 2100) return toYmd(yy, mm, dd);
  }

  // 마지막 fallback
  return ymd();
}
