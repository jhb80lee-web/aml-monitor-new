const REGION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const NAME_OVERRIDES: Record<string, string> = {
  "bahamas the": "BS",
  "the bahamas": "BS",
  "gambia the": "GM",
  "the gambia": "GM",
  "united kingdom": "GB",
  "korea south": "KR",
  "south korea": "KR",
  "republic of korea": "KR",
  "korea republic of": "KR",
  "korea north": "KP",
  "north korea": "KP",
  "democratic peoples republic of korea": "KP",
  "holy see": "VA",
  "holy see vatican city": "VA",
  "vatican city": "VA",
  "micronesia federated states of": "FM",
  "federated states of micronesia": "FM",
  "congo democratic republic of the": "CD",
  "democratic republic of the congo": "CD",
  "congo kinshasa": "CD",
  "congo republic of the": "CG",
  "republic of the congo": "CG",
  "congo brazzaville": "CG",
  "cote divoire": "CI",
  "cote d ivoire": "CI",
  "cabo verde": "CV",
  "cape verde": "CV",
  "timor leste": "TL",
  "east timor": "TL",
  "czech republic": "CZ",
  czechia: "CZ",
  swaziland: "SZ",
  eswatini: "SZ",
  burma: "MM",
  myanmar: "MM",
  laos: "LA",
  "lao peoples democratic republic": "LA",
  moldova: "MD",
  "republic of moldova": "MD",
  russia: "RU",
  "russian federation": "RU",
  syria: "SY",
  "syrian arab republic": "SY",
  iran: "IR",
  "iran islamic republic of": "IR",
  tanzania: "TZ",
  "united republic of tanzania": "TZ",
  bolivia: "BO",
  "bolivia plurinational state of": "BO",
  venezuela: "VE",
  "venezuela bolivarian republic of": "VE",
  brunei: "BN",
  "brunei darussalam": "BN",
  macao: "MO",
  macau: "MO",
  "macao sar china": "MO",
  "hong kong": "HK",
  "hong kong sar china": "HK",
  curaao: "CW",
  curacao: "CW",
  turkey: "TR",
  turkiye: "TR",
  palestine: "PS",
  "state of palestine": "PS",
  "palestinian territories": "PS",
  kosovo: "XK",
};

const CODE_OVERRIDES: Record<string, string> = {
  UK: "GB",
  TP: "TL",
  BU: "MM",
  ZR: "CD",
};

let cachedNameToCode: Map<string, string> | null = null;

function normalizeCountryLookupKey(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/\bst\.?\b/gi, "saint")
    .replace(/[()]/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildNameToCodeMap() {
  const out = new Map<string, string>();
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

  for (const first of REGION_LETTERS) {
    for (const second of REGION_LETTERS) {
      const code = `${first}${second}`;
      const label = displayNames.of(code);
      if (!label || label === code || label === "Unknown Region") continue;
      const key = normalizeCountryLookupKey(label);
      if (!out.has(key)) {
        out.set(key, code);
      }
    }
  }

  for (const [name, code] of Object.entries(NAME_OVERRIDES)) {
    out.set(name, code);
  }

  return out;
}

function getNameToCodeMap() {
  if (!cachedNameToCode) {
    cachedNameToCode = buildNameToCodeMap();
  }
  return cachedNameToCode;
}

function normalizeCandidateCode(value?: string) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return "";
  return CODE_OVERRIDES[code] || code;
}

function isSupportedAlpha2Code(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return false;
  const label = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
  return !!label && label !== code && label !== "Unknown Region";
}

export function resolveIsoAlpha2CountryCode(countryName: string, fallbackCode?: string) {
  const byName = getNameToCodeMap().get(normalizeCountryLookupKey(countryName));
  if (byName) return byName;

  const normalizedCode = normalizeCandidateCode(fallbackCode);
  if (isSupportedAlpha2Code(normalizedCode)) {
    return normalizedCode;
  }

  return "";
}

export function resolveIsoAlpha2CountryCodeOrThrow(
  countryName: string,
  fallbackCode?: string
) {
  const code = resolveIsoAlpha2CountryCode(countryName, fallbackCode);
  if (code) return code;

  throw new Error(
    `Unable to resolve ISO alpha-2 country code for "${countryName}" (fallback="${String(
      fallbackCode || ""
    )}")`
  );
}
