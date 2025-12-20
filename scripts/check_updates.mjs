import fs from "node:fs";
import path from "node:path";

const STATE_FILE = path.resolve(".aml_state.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { ofac: { publishDate: "" }, un: { dateGenerated: "" } };
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

async function main() {
  const prev = readState();

  const OFAC_XML_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml";
  const UN_XML_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml";

  console.log("🔎 Checking OFAC / UN source timestamps...");

  const [ofacXml, unXml] = await Promise.all([
    fetchText(OFAC_XML_URL),
    fetchText(UN_XML_URL),
  ]);

  const ofacPublishDate = extractOfacPublishDate(ofacXml);
  const unDateGenerated = extractUnDateGenerated(unXml);

  const ofacPrev = prev?.ofac?.publishDate || "";
  const unPrev = prev?.un?.dateGenerated || "";

  const ofacChanged = !!ofacPublishDate && ofacPublishDate !== ofacPrev;
  const unChanged = !!unDateGenerated && unDateGenerated !== unPrev;

  const next = {
    ofac: { publishDate: ofacPublishDate || ofacPrev },
    un: { dateGenerated: unDateGenerated || unPrev },
    updatedAt: new Date().toISOString(),
  };

  writeState(next);

  setOutput("ofac_changed", ofacChanged ? "true" : "false");
  setOutput("un_changed", unChanged ? "true" : "false");

  console.log("✅ OFAC publishDate:", ofacPublishDate);
  console.log("✅ UN dateGenerated:", unDateGenerated);
  console.log("➡️ ofac_changed:", ofacChanged);
  console.log("➡️ un_changed:", unChanged);
}

main().catch((e) => {
  console.error("❌ check_updates failed:", e?.message || e);
  process.exit(1);
});
