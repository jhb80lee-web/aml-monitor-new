// aml_app/aml-monitor-new/components/InAppUpdateBanner.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  AppStateStatus,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { BlurView } from "expo-blur";
import { API_BASE_URL } from "../constants/api";

const SETTINGS_KEY = "aml.settings.all.v1";
const LAST_SEEN_KEY = "aml.banner.lastSeen.v1";

// ✅ 실전 감지 로직 사용(테스트 모드 끔)
const BANNER_TEST_MODE = false;

// ✅ 개발용: 소스별 “클릭 이동 테스트” 강제 배너
// 테스트할 때만 "ofac" | "un" | "vasp" | "restricted" 로 바꾸고,
// 끝나면 null 로 바꾸면 실전 감지 로직만 동작함.
const DEV_FORCE_SOURCE: SourceKey | null = null;

// ✅ 자동 숨김 시간(ms)
const AUTO_HIDE_MS = 3500;

// ✅ 배너가 “완전히” 화면 밖으로 나가게 여유값
const HIDE_EXTRA = 120;

// ✅ 개발 중 로그/깜빡임 방지 처리 on/off
const DEBUG_BANNER = __DEV__;

type SourceKey = "ofac" | "un" | "vasp" | "restricted";

type StoredSettings = {
  alarmEnabled: boolean;
  notify: { vasp: boolean; restricted: boolean; ofac: boolean; un: boolean };
  onlyOnChange: boolean;
};

type LatestMeta = {
  source: SourceKey;
  updatedAt: string | null;
  total: number | null;
};

function pickNewest(a: LatestMeta | null, b: LatestMeta | null) {
  if (!a) return b;
  if (!b) return a;
  const ta = a.updatedAt ? Date.parse(a.updatedAt) : -1;
  const tb = b.updatedAt ? Date.parse(b.updatedAt) : -1;
  return tb > ta ? b : a;
}

async function fetchLatestMeta(source: SourceKey): Promise<LatestMeta> {
  const url =
    source === "ofac"
      ? `${API_BASE_URL}/ofac/sdn/latest`
      : source === "un"
      ? `${API_BASE_URL}/un/sdn/latest`
      : source === "vasp"
      ? `${API_BASE_URL}/kofiu/vasp/latest`
      : `${API_BASE_URL}/kofiu/restricted/latest`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { source, updatedAt: null, total: null };
    const j: any = await res.json();
    return {
      source,
      updatedAt: typeof j?.updatedAt === "string" ? j.updatedAt : null,
      total: typeof j?.total === "number" ? j.total : null,
    };
  } catch {
    return { source, updatedAt: null, total: null };
  }
}

function routeForSource(source: SourceKey): string {
  // ✅ 정협님 요청: OFAC/UN은 히스토리로 이동
  if (source === "ofac") return "/Home/ofac/history";
  if (source === "un") return "/Home/un/history";
  if (source === "vasp") return "/Home/kofiu/vasp";
  return "/Home/kofiu/restricted";
}

function labelForSource(source: SourceKey): string {
  if (source === "ofac") return "OFAC SDN 업데이트";
  if (source === "un") return "UN 업데이트";
  if (source === "vasp") return "VASP 업데이트";
  return "금융거래등 제한대상 업데이트";
}

// ✅ seen 정리(예: "null" 같은 찌꺼기 제거)
function sanitizeSeen(seen: any): { cleaned: Record<string, string>; changed: boolean } {
  const allowed: Record<SourceKey, true> = {
    ofac: true,
    un: true,
    vasp: true,
    restricted: true,
  };
  const cleaned: Record<string, string> = {};
  let changed = false;

  if (seen && typeof seen === "object") {
    for (const [k, v] of Object.entries(seen)) {
      if (k in allowed && typeof v === "string") {
        cleaned[k] = v;
      } else {
        changed = true;
      }
    }
  } else {
    changed = true;
  }

  return { cleaned, changed };
}

export default function InAppUpdateBanner() {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [notify, setNotify] = useState<StoredSettings["notify"]>({
    vasp: true,
    restricted: true,
    ofac: true,
    un: false,
  });
  const [onlyOnChange, setOnlyOnChange] = useState(true);

  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const [message, setMessage] = useState("");

  const checkingRef = useRef(false);
  const closingRef = useRef(false);

  const targetSourceRef = useRef<SourceKey | null>(null);
  const targetUpdatedAtRef = useRef<string | null>(null);

  const translateY = useRef(new Animated.Value(0)).current;
  const hideYRef = useRef(-200);

  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAutoTimer = useCallback(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const watchedSources: SourceKey[] = useMemo(() => {
    const list: SourceKey[] = [];
    if (notify.ofac) list.push("ofac");
    if (notify.un) list.push("un");
    if (notify.vasp) list.push("vasp");
    if (notify.restricted) list.push("restricted");
    return list;
  }, [notify]);

  const loadSettings = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<StoredSettings>;
        setEnabled(!!s.alarmEnabled);
        if (s.notify) setNotify((p) => ({ ...p, ...s.notify }));
        if (typeof s.onlyOnChange === "boolean") setOnlyOnChange(s.onlyOnChange);
      } else {
        setEnabled(false);
      }
    } catch {
      setEnabled(false);
    } finally {
      setReady(true);
    }
  }, []);

  const markSeen = useCallback(async () => {
    const src = targetSourceRef.current;
    const updatedAt = targetUpdatedAtRef.current;
    if (!src || !updatedAt) return;

    try {
      const seenRaw = await AsyncStorage.getItem(LAST_SEEN_KEY);
      const parsed = seenRaw ? JSON.parse(seenRaw) : {};
      const { cleaned } = sanitizeSeen(parsed);

      cleaned[src] = updatedAt;
      await AsyncStorage.setItem(LAST_SEEN_KEY, JSON.stringify(cleaned));
    } catch {
      // ignore
    }
  }, []);

  const dismissBanner = useCallback(
    (opts?: { markSeen?: boolean }) => {
      if (closingRef.current) return;
      closingRef.current = true;

      clearAutoTimer();
      const shouldMark = opts?.markSeen !== false;

      Animated.timing(translateY, {
        toValue: hideYRef.current,
        duration: 170,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
        translateY.setValue(0);
        closingRef.current = false;
      });

      if (shouldMark) void markSeen();
    },
    [clearAutoTimer, markSeen, translateY]
  );

  const showBannerFor = useCallback(
    (src: SourceKey, msg: string, updatedAt: string | null) => {
      clearAutoTimer();

      targetSourceRef.current = src;
      targetUpdatedAtRef.current = updatedAt;

      setMessage(msg);

      translateY.setValue(hideYRef.current);
      setVisible(true);

      requestAnimationFrame(() => {
        Animated.timing(translateY, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }).start();
      });

      autoTimerRef.current = setTimeout(() => {
        dismissBanner({ markSeen: true });
      }, AUTO_HIDE_MS);
    },
    [clearAutoTimer, dismissBanner, translateY]
  );

  const checkOnce = useCallback(async () => {
    if (!ready) return;

    // ✅ Fast Refresh에서 state 보존 때문에 “깜빡” 뜨는 현상 방지(개발에서만)
    if (DEBUG_BANNER && visibleRef.current) {
      clearAutoTimer();
      translateY.stopAnimation();
      translateY.setValue(hideYRef.current);
      setVisible(false);
    }

    if (DEV_FORCE_SOURCE) {
      const src = DEV_FORCE_SOURCE;
      showBannerFor(src, `${labelForSource(src)} · 총 123건`, new Date().toISOString());
      return;
    }

    if (BANNER_TEST_MODE) {
      const src: SourceKey = "ofac";
      showBannerFor(src, `${labelForSource(src)} · 총 18,494건`, new Date().toISOString());
      return;
    }

    if (!enabled) {
      setVisible(false);
      return;
    }

    if (checkingRef.current) return;
    checkingRef.current = true;

    if (DEBUG_BANNER) {
      console.log("[BANNER] watchedSources =", watchedSources);
      console.log("[BANNER] enabled/onlyOnChange =", enabled, onlyOnChange);
    }

    try {
      const seenRaw = await AsyncStorage.getItem(LAST_SEEN_KEY);
      if (DEBUG_BANNER) console.log("[BANNER] seenRaw =", seenRaw);

      const parsed = seenRaw ? JSON.parse(seenRaw) : {};
      const { cleaned: seen, changed: sanitizeChanged } = sanitizeSeen(parsed);

      // ✅ "null" 같은 찌꺼기 있으면 자동 정리해서 다시 저장
      if (sanitizeChanged) {
        await AsyncStorage.setItem(LAST_SEEN_KEY, JSON.stringify(seen));
      }

      let newest: LatestMeta | null = null;
      for (const src of watchedSources) {
        const m = await fetchLatestMeta(src);
        newest = pickNewest(newest, m);
      }

      if (DEBUG_BANNER) console.log("[BANNER] newest =", newest);

      if (!newest || !newest.updatedAt) {
        setVisible(false);
        return;
      }

      const src = newest.source;
      const last = (seen[src] as string | undefined) || null;
      const changed = newest.updatedAt !== last;

      if (DEBUG_BANNER) {
        console.log("[BANNER] src/last/now/changed =", src, last, newest.updatedAt, changed);
      }

      if (onlyOnChange && !changed) {
        setVisible(false);
        return;
      }

      const label = labelForSource(src);
      const totalText =
        typeof newest.total === "number" ? ` · 총 ${newest.total.toLocaleString()}건` : "";

      showBannerFor(src, `${label}${totalText}`, newest.updatedAt);
    } finally {
      checkingRef.current = false;
    }
  }, [
    ready,
    enabled,
    watchedSources,
    onlyOnChange,
    showBannerFor,
    clearAutoTimer,
    translateY,
  ]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!ready) return;
    checkOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    const onAppState = async (st: AppStateStatus) => {
      if (st === "active") {
        await loadSettings();
        await checkOnce();
      }
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [checkOnce, loadSettings]);

  useEffect(() => {
    return () => clearAutoTimer();
  }, [clearAutoTimer]);

  const onPressBanner = useCallback(() => {
    const src = targetSourceRef.current;
    if (!src) return;

    dismissBanner({ markSeen: true });
    router.push(routeForSource(src) as any);
  }, [dismissBanner]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          clearAutoTimer();
        },
        onPanResponderMove: (_, g) => {
          if (g.dy < 0) translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          const shouldDismiss = g.dy < -28 || g.vy < -0.6;
          if (shouldDismiss) {
            dismissBanner({ markSeen: true });
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
            }).start();

            clearAutoTimer();
            autoTimerRef.current = setTimeout(() => {
              dismissBanner({ markSeen: true });
            }, AUTO_HIDE_MS);
          }
        },
      }),
    [clearAutoTimer, dismissBanner, translateY]
  );

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.wrap, { transform: [{ translateY }] }]}
      {...panResponder.panHandlers}
    >
      <View style={styles.bannerShadow}>
        <Pressable
          onPress={onPressBanner}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            hideYRef.current = -(h + HIDE_EXTRA);
          }}
          style={({ pressed }) => [styles.banner, pressed && { opacity: 0.96 }]}
        >
          <BlurView
            intensity={30}
            tint="dark"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.glassTint} pointerEvents="none" />

          <View style={styles.iconBox}>
            <Text style={styles.iconTxt}>◎</Text>
          </View>

          <View style={styles.textBox}>
            <Text style={styles.title}>업데이트 알림</Text>
            <Text style={styles.msg} numberOfLines={2}>
              {message}
            </Text>
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14 },

  bannerShadow: {
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },

  banner: {
    minHeight: 68,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.18)",
  },

  glassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7, 18, 45, 0.76)",
  },

  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(96, 165, 250, 0.22)",
    marginRight: 12,
  },
  iconTxt: {
    color: "rgba(191, 219, 254, 0.92)",
    fontSize: 14,
    fontWeight: "900",
  },

  textBox: { flex: 1 },

  title: {
    color: "rgba(219, 234, 254, 0.90)",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 3,
  },
  msg: {
    color: "rgba(239, 246, 255, 0.98)",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
  },
});
