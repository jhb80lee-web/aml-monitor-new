// constants/api.ts

export const API_BASE_URL =
  "https://orange-bread-2e13.jhb80lee.workers.dev";

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

// OFAC SDN 최신
export const OFAC_SDN_LATEST_URL =
  `${API_BASE_URL}/ofac/sdn/latest`;

/* =========================
 * UN
 * ========================= */

// UN 제재 리스트 최신
export const UN_LATEST_URL =
  `${API_BASE_URL}/un/sdn/latest`;
