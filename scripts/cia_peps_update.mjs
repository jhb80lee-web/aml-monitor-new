const WORKER_BASE_URL =
  process.env.WORKER_BASE_URL || "https://orange-bread-2e13.jhb80lee-793.workers.dev";

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const DRY_RUN = toBool(process.env.DRY_RUN);
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || "30000", 10);
const FETCH_CONCURRENCY = Math.max(1, parseInt(process.env.FETCH_CONCURRENCY || "8", 10));

const CIA_LIST_URL =
  "https://www.cia.gov/resources/world-leaders/page-data/sq/d/3338022342.json";
const CIA_PAGE_DATA_BASE =
  "https://www.cia.gov/resources/world-leaders/page-data/foreign-governments";

const SPECIAL_SLUGS = {
  "Bahamas, The": "bahamas-the",
  "Congo, Democratic Republic of the": "congo-democratic-republic-of-the",
  "Congo, Republic of the": "congo-republic-of-the",
  "Gambia, The": "gambia-the",
  "Holy See (Vatican City)": "holy-see-vatican-city",
  "Korea, North": "korea-north",
  "Korea, South": "korea-south",
  "Micronesia, Federated States of": "micronesia-federated-states-of",
};

async function main() {
  console.log("");
  console.log("========================================");
  console.log("CIA PEPs Update");
  console.log("WORKER_BASE_URL  :", WORKER_BASE_URL);
  console.log("DRY_RUN          :", DRY_RUN ? "YES" : "NO");
  console.log("FETCH_TIMEOUT_MS :", FETCH_TIMEOUT_MS);
  console.log("FETCH_CONCURRENCY:", FETCH_CONCURRENCY);
  console.log("========================================");

  const countryNames = await fetchCountryNames();
  console.log(`🌍 countries discovered: ${countryNames.length}`);

  const pages = await mapLimit(countryNames, FETCH_CONCURRENCY, async (countryName, idx) => {
    const page = await fetchCountryPage(countryName);
    console.log(`   ${String(idx + 1).padStart(3, "0")}/${countryNames.length} ${page.country}`);
    return page;
  });

  const data = [];
  const countries = [];

  for (const page of pages) {
    const entries = flattenLeaders(page);

    countries.push({
      code: page.code,
      name: page.country,
      letter: firstLetter(page.country),
      count: entries.length,
    });

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      data.push({
        id: `${page.code}:${String(i + 1).padStart(2, "0")}`,
        countryCode: page.code,
        country: page.country,
        name: entry.name,
        title: entry.title,
      });
    }
  }

  countries.sort((a, b) => a.name.localeCompare(b.name, "en"));

  const payload = {
    source: "cia_world_leaders",
    updatedAt: pickLatestUpdatedAt(pages),
    total: data.length,
    letters: [...new Set(countries.map((country) => country.letter))].sort(),
    countries,
    data,
  };

  console.log("");
  console.log("📦 payload summary");
  console.log("updatedAt:", payload.updatedAt);
  console.log("countries :", payload.countries.length);
  console.log("total     :", payload.total);

  if (DRY_RUN) {
    console.log("");
    console.log("🟡 DRY_RUN=1 이므로 Worker 업로드를 생략합니다.");
    return;
  }

  if (!ADMIN_KEY) {
    throw new Error("ADMIN_KEY is required when DRY_RUN is false");
  }

  const url = `${WORKER_BASE_URL}/internal/peps/cia/update`;
  console.log("");
  console.log("🚀 upload to worker:", url);

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_KEY,
      "User-Agent": "aml-monitor/cia-peps-update",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log("status:", res.status);
  console.log("body  :", trimLong(text, 500));

  if (!res.ok) {
    throw new Error(`Worker upload failed: HTTP ${res.status}`);
  }
}

async function fetchCountryNames() {
  const json = await fetchJson(CIA_LIST_URL);
  const names = json?.data?.leaders?.nodes?.map((node) => String(node?.country || "").trim()) || [];
  const clean = names.filter(Boolean);

  if (clean.length === 0) {
    throw new Error("CIA country list is empty");
  }

  return clean;
}

async function fetchCountryPage(countryName) {
  const slugs = slugCandidates(countryName);

  let lastStatus = "(not requested)";
  for (const slug of slugs) {
    const url = `${CIA_PAGE_DATA_BASE}/${slug}/page-data.json`;
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "aml-monitor/cia-peps-update" },
    });

    if (!res.ok) {
      lastStatus = `HTTP ${res.status} (${slug})`;
      continue;
    }

    const json = await res.json();
    const page = json?.result?.data?.page;
    if (!page?.country || !Array.isArray(page?.leaders)) {
      lastStatus = `invalid payload (${slug})`;
      continue;
    }

    return {
      slug,
      code: String(page.code || slug).toUpperCase(),
      country: String(page.country),
      dateUpdated: normalizeSourceDate(page.date_updated),
      leaders: Array.isArray(page.leaders) ? page.leaders : [],
      leaders2: Array.isArray(page.leaders_2) ? page.leaders_2 : [],
      leaders3: Array.isArray(page.leaders_3) ? page.leaders_3 : [],
    };
  }

  throw new Error(`No CIA page-data found for "${countryName}" (${lastStatus})`);
}

function flattenLeaders(page) {
  return [...page.leaders, ...page.leaders2, ...page.leaders3]
    .map((item) => ({
      name: String(item?.name || "").trim(),
      title: String(item?.title || "").trim(),
    }))
    .filter((item) => item.name && item.title);
}

function slugCandidates(countryName) {
  const out = new Set();
  const add = (value) => {
    if (value) out.add(value);
  };

  if (SPECIAL_SLUGS[countryName]) add(SPECIAL_SLUGS[countryName]);

  add(slugify(countryName));

  const commaMatch = countryName.match(/^(.*?),\s*(.+)$/);
  if (commaMatch) {
    const left = commaMatch[1].trim();
    const right = commaMatch[2].trim();
    add(slugify(`${right} ${left}`));
    add(slugify(`${left} ${right}`));
    if (/^the$/i.test(right)) {
      add(slugify(left));
    }
  }

  add(slugify(countryName.replace(/^The\s+/i, "")));
  add(slugify(countryName.replace(/\bSt\.?\b/g, "Saint")));
  add(slugify(countryName.replace(/\bSaint\b/g, "St")));

  return [...out];
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function firstLetter(country) {
  const s = String(country || "").trim().toUpperCase();
  const match = s.match(/[A-Z]/);
  return match ? match[0] : "#";
}

function normalizeSourceDate(raw) {
  const text = String(raw || "").trim();
  if (!text) return new Date().toISOString();

  const isoCandidate = text.replace(" ", "T") + "Z";
  const ms = Date.parse(isoCandidate);
  if (Number.isNaN(ms)) return text;
  return new Date(ms).toISOString();
}

function pickLatestUpdatedAt(pages) {
  const values = pages
    .map((page) => page.dateUpdated)
    .filter(Boolean)
    .map((value) => ({ value, ms: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.ms))
    .sort((a, b) => b.ms - a.ms);

  return values[0]?.value || new Date().toISOString();
}

async function mapLimit(items, limit, mapper) {
  const result = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) break;
      result[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return result;
}

async function fetchJson(url) {
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": "aml-monitor/cia-peps-update" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fetch failed (${res.status}): ${url}\n${trimLong(text, 240)}`);
  }

  return res.json();
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function trimLong(s, max) {
  const text = String(s || "");
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function toBool(value) {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}

main().catch((err) => {
  console.error("");
  console.error("🔴 CIA PEP update failed");
  console.error(err?.stack || err?.message || String(err));
  process.exitCode = 1;
});
