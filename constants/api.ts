// constants/api.ts

export const API_BASE_URL = "https://orange-bread-2e13.jhb80lee-793.workers.dev";

/* =========================
 * KoFIU
 * ========================= */

// 가상자산사업자 신고현황
export const KOFIU_VASP_LATEST_URL =
  `${API_BASE_URL}/kofiu/vasp/latest`;

// 금융거래 등 제한대상자
export const KOFIU_RESTRICTED_LATEST_URL =
  `${API_BASE_URL}/kofiu/restricted/latest`;

/* =========================
 * OFAC
 * ========================= */

// OFAC SDN 최신// OFAC
export const OFAC_SDN_LATEST_URL = `${API_BASE_URL}/ofac/sdn/latest`;
export const OFAC_SDN_HISTORY_URL = `${API_BASE_URL}/ofac/sdn/history`;

/* =========================
 * UN
 * ========================= */
// UN
export const UN_LATEST_URL = `${API_BASE_URL}/un/sdn/latest`;
export const UN_SDN_HISTORY_URL = `${API_BASE_URL}/un/sdn/history`;

// ✅ health 체크
export const HEALTH_URL = `${API_BASE_URL}/health`;

