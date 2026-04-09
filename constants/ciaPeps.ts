export type CiaPepCountry = {
  code: string;
  name: string;
  letter: string;
  count: number;
};

export type CiaPepEntry = {
  id: string;
  countryCode: string;
  country: string;
  name: string;
  title: string;
};

export type CiaPepLatestResponse = {
  updatedAt: string;
  total: number;
  letters: string[];
  countries: CiaPepCountry[];
  data: CiaPepEntry[];
};

export const CIA_PEP_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const CIA_LIST_URL =
  "https://www.cia.gov/resources/world-leaders/page-data/sq/d/3338022342.json";
const CIA_PAGE_DATA_BASE =
  "https://www.cia.gov/resources/world-leaders/page-data/foreign-governments";
const CACHE_TTL_MS = 15 * 60 * 1000;
const FALLBACK_CONCURRENCY = 8;

const SPECIAL_SLUGS: Record<string, string> = {
  "Bahamas, The": "bahamas-the",
  "Congo, Democratic Republic of the": "congo-democratic-republic-of-the",
  "Congo, Republic of the": "congo-republic-of-the",
  "Cote d'Ivoire": "cote-divoire",
  "Côte d'Ivoire": "cote-divoire",
  "Gambia, The": "gambia-the",
  "Holy See (Vatican City)": "holy-see-vatican-city",
  "Korea, North": "korea-north",
  "Korea, South": "korea-south",
  "Micronesia, Federated States of": "micronesia-federated-states-of",
};

let latestCache: CiaPepLatestResponse | null = null;
let latestCacheAt = 0;
let latestPromise: Promise<CiaPepLatestResponse> | null = null;

export function normalizeCountryCode(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "").trim().toUpperCase();
}

export async function fetchCiaPepsLatest(apiUrl: string, options?: { force?: boolean }) {
  const force = !!options?.force;
  const now = Date.now();

  if (!force && latestCache && now - latestCacheAt < CACHE_TTL_MS) {
    return latestCache;
  }

  if (!force && latestPromise) {
    return latestPromise;
  }

  latestPromise = loadCiaPepsLatest(apiUrl);

  try {
    const data = await latestPromise;
    latestCache = data;
    latestCacheAt = Date.now();
    return data;
  } finally {
    latestPromise = null;
  }
}

async function loadCiaPepsLatest(apiUrl: string) {
  try {
    const res = await fetch(apiUrl);
    if (res.ok) {
      return (await res.json()) as CiaPepLatestResponse;
    }

    if (res.status !== 404) {
      throw new Error(`CIA PEP 최신 데이터 조회 실패 (HTTP ${res.status})`);
    }
  } catch (error) {
    if (!isNetworkLikeError(error)) {
      throw error;
    }
  }

  return buildFromCiaSource();
}

async function buildFromCiaSource(): Promise<CiaPepLatestResponse> {
  const countryNames = await fetchCountryNames();
  const pageResults = await mapLimit(countryNames, FALLBACK_CONCURRENCY, async (countryName) => {
    try {
      return await fetchCountryPage(countryName);
    } catch (error) {
      console.warn(
        `[CIA PEPs] skip country: ${countryName} - ${
          error instanceof Error ? error.message : String(error || "")
        }`
      );
      return null;
    }
  });
  const pages = pageResults.filter(Boolean) as Array<{
    code: string;
    country: string;
    dateUpdated: string;
    leaders: any[];
    leaders2: any[];
    leaders3: any[];
  }>;

  if (pages.length === 0) {
    throw new Error("CIA 국가 페이지를 하나도 불러오지 못했습니다.");
  }

  const countries: CiaPepCountry[] = [];
  const data: CiaPepEntry[] = [];

  for (const page of pages) {
    const entries = flattenLeaders(page);

    countries.push({
      code: page.code,
      name: page.country,
      letter: firstLetter(page.country),
      count: entries.length,
    });

    for (let i = 0; i < entries.length; i += 1) {
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

  return {
    updatedAt: pickLatestUpdatedAt(pages),
    total: data.length,
    letters: [...new Set(countries.map((country) => country.letter))].sort(),
    countries,
    data,
  };
}

async function fetchCountryNames(): Promise<string[]> {
  const res = await fetch(CIA_LIST_URL);
  if (!res.ok) {
    throw new Error(`CIA 국가 목록 조회 실패 (HTTP ${res.status})`);
  }

  const json = await res.json();
  const names =
    json?.data?.leaders?.nodes?.map((node: any) => String(node?.country || "").trim()) ?? [];
  const clean = names.filter(Boolean);

  if (clean.length === 0) {
    throw new Error("CIA 국가 목록이 비어 있습니다.");
  }

  return clean;
}

async function fetchCountryPage(countryName: string) {
  const slugs = slugCandidates(countryName);
  let lastStatus = "(not requested)";

  for (const slug of slugs) {
    const url = `${CIA_PAGE_DATA_BASE}/${slug}/page-data.json`;
    const res = await fetch(url);

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
      code: String(page.code || slug).toUpperCase(),
      country: String(page.country),
      dateUpdated: normalizeSourceDate(page.date_updated),
      leaders: Array.isArray(page.leaders) ? page.leaders : [],
      leaders2: Array.isArray(page.leaders_2) ? page.leaders_2 : [],
      leaders3: Array.isArray(page.leaders_3) ? page.leaders_3 : [],
    };
  }

  throw new Error(`CIA 국가 페이지를 찾지 못했습니다: ${countryName} (${lastStatus})`);
}

function flattenLeaders(page: any) {
  return [...page.leaders, ...page.leaders2, ...page.leaders3]
    .map((item) => ({
      name: String(item?.name || "").trim(),
      title: String(item?.title || "").trim(),
    }))
    .filter((item) => item.name && item.title);
}

function slugCandidates(countryName: string) {
  const out = new Set<string>();
  const add = (value: string) => {
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

function slugify(value: string) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function firstLetter(country: string) {
  const s = String(country || "").trim().toUpperCase();
  const match = s.match(/[A-Z]/);
  return match ? match[0] : "#";
}

function normalizeSourceDate(raw: unknown) {
  const text = String(raw || "").trim();
  if (!text) return new Date().toISOString();

  const isoCandidate = text.replace(" ", "T") + "Z";
  const ms = Date.parse(isoCandidate);
  if (Number.isNaN(ms)) return text;
  return new Date(ms).toISOString();
}

function pickLatestUpdatedAt(pages: Array<{ dateUpdated: string }>) {
  const values = pages
    .map((page) => page.dateUpdated)
    .filter(Boolean)
    .map((value) => ({ value, ms: Date.parse(value) }))
    .filter((item) => !Number.isNaN(item.ms))
    .sort((a, b) => b.ms - a.ms);

  return values[0]?.value || new Date().toISOString();
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const result = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;

      if (current >= items.length) break;
      result[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return result;
}

function isNetworkLikeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /network|failed|load|timed out|fetch/i.test(message);
}
