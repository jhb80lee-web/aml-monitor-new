import fs from "node:fs";
import path from "node:path";

const STATE_FILE = path.resolve(".aml_state.json");

const OFAC_XML_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml";
const UN_XML_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {
      ofac: { publishDate: "", etag: "", lastModified: "" },
      un: { dateGenerated: "", etag: "", lastModified: "" },
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
    if (!res.ok) return { ok: false, etag: "", lastModified: "" };
    return {
      ok: true,
      etag: normHeader(res.headers.get("etag")),
      lastModified: normHeader(res.headers.get("last-modified")),
    };
  } catch {
    return { ok: false, etag: "", lastModified: "" };
  }
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "aml-monitor-actions/1.0" },
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
  const m =
    xml.match(/<DATE_GENERATED>\s*([^<]+)\s*<\/DATE_GENERATED>/i) ||
    xml.match(/<dateGenerated>\s*([^<]+)\s*<\/dateGenerated>/i) ||
    xml.match(/<GENERATED_ON>\s*([^<]+)\s*<\/GENERATED_ON>/i);
  return m ? String(m[1]).trim() : "";
}

function buildSig({ primary, etag, lastModified }) {
  return [primary || "", etag || "", lastModified || ""].join("|");
}

async function main() {
  const prev = readState();

  console.log("🔎 Checking OFAC / UN source timestamps (HEAD + fallback)...");

  const [ofacHead, unHead] = await Promise.all([
    fetchHead(OFAC_XML_URL),
    fetchHead(UN_XML_URL),
  ]);

  let ofacPublishDate = prev?.ofac?.publishDate || "";
  let unDateGenerated = prev?.un?.dateGenerated || "";

  const maybeNeedOfacGet =
    !ofacPublishDate || (!ofacHead.etag && !ofacHead.lastModified);
  const maybeNeedUnGet =
    !unDateGenerated || (!unHead.etag && !unHead.lastModified);

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

  const nowOfacSig = buildSig({
    primary: currentOfac.publishDate,
    etag: currentOfac.etag,
    lastModified: currentOfac.lastModified,
  });

  const nowUnSig = buildSig({
    primary: currentUn.dateGenerated,
    etag: currentUn.etag,
    lastModified: currentUn.lastModified,
  });

  const ofacChanged = nowOfacSig !== prevOfacSig && nowOfacSig !== "||";
  const unChanged = nowUnSig !== prevUnSig && nowUnSig !== "||";

  setOutput("ofac_changed", ofacChanged ? "true" : "false");
  setOutput("un_changed", unChanged ? "true" : "false");

  console.log("✅ OFAC publishDate:", currentOfac.publishDate);
  console.log("✅ OFAC etag:", currentOfac.etag);
  console.log("✅ OFAC lastModified:", currentOfac.lastModified);
  console.log("➡️ ofac_changed:", ofacChanged);

  console.log("✅ UN dateGenerated:", currentUn.dateGenerated);
  console.log("✅ UN etag:", currentUn.etag);
  console.log("✅ UN lastModified:", currentUn.lastModified);
  console.log("➡️ un_changed:", unChanged);

  // 변경이 있을 때만 state 저장(불필요 커밋 방지)
  if (ofacChanged || unChanged || !fs.existsSync(STATE_FILE)) {
    const next = {
      ofac: currentOfac,
      un: currentUn,
    };
    writeState(next);
    console.log("💾 State saved:", STATE_FILE);
  } else {
    console.log("🟰 No change. State file not modified.");
  }
}

main().catch((e) => {
  console.error("❌ check_updates failed:", e?.message || e);
  process.exit(1);
});
