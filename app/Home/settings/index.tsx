// aml_app/aml-monitor-new/app/Home/settings/index.tsx
import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import BottomTabBar from "../../../components/BottomTabBar";

const ALARM_ENABLED_KEY = "aml.settings.alarmEnabled.v1";
const SETTINGS_KEY = "aml.settings.all.v1";

type Channel = "push" | "email" | "kakao";

type NotifyMethods = {
  banner: boolean;
  sms: boolean;
  email: boolean;
  kakao: boolean;
};

type StoredSettings = {
  alarmEnabled: boolean;
  notify: {
    vasp: boolean;
    restricted: boolean;
    ofac: boolean;
    un: boolean;
  };

  // 하위호환(예전 단일 채널)
  channel: Channel;

  // 신규(다중 방식)
  methods: NotifyMethods;

  // UI는 제거했지만 하위호환/확장용 유지
  onlyOnChange: boolean;

  email: string;
  kakao: string;
  phone: string;
};

function deriveChannelFromMethods(methods: NotifyMethods): Channel {
  if (methods.email && !methods.sms && !methods.kakao) return "email";
  if (methods.kakao && !methods.sms && !methods.email) return "kakao";
  return "push";
}

export default function SettingsScreen() {
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmLoaded, setAlarmLoaded] = useState(false);

  const [notify, setNotify] = useState({
    vasp: true,
    restricted: true,
    ofac: true,
    un: false,
  });

  const [methods, setMethods] = useState<NotifyMethods>({
    banner: true,
    sms: false,
    email: false,
    kakao: false,
  });

  const [onlyOnChange, setOnlyOnChange] = useState(true);

  const [email, setEmail] = useState("");
  const [kakao, setKakao] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SETTINGS_KEY);

        if (raw) {
          const parsed = JSON.parse(raw) as Partial<StoredSettings>;

          if (typeof parsed.alarmEnabled === "boolean")
            setAlarmEnabled(parsed.alarmEnabled);

          if (parsed.notify) {
            setNotify((prev) => ({
              ...prev,
              ...parsed.notify,
            }));
          }

          // ✅ 신규 methods 우선
          if (parsed.methods) {
            setMethods((prev) => ({
              ...prev,
              ...parsed.methods,
            }));
          } else {
            // ✅ 하위호환: 예전 channel → methods
            if (parsed.channel === "email") {
              setMethods({ banner: false, sms: false, email: true, kakao: false });
            } else if (parsed.channel === "kakao") {
              setMethods({ banner: false, sms: false, email: false, kakao: true });
            } else if (parsed.channel === "push") {
              setMethods({ banner: true, sms: false, email: false, kakao: false });
            }
          }

          if (typeof parsed.onlyOnChange === "boolean")
            setOnlyOnChange(parsed.onlyOnChange);

          if (typeof parsed.email === "string") setEmail(parsed.email);
          if (typeof parsed.kakao === "string") setKakao(parsed.kakao);
          if (typeof parsed.phone === "string") setPhone(parsed.phone);
        } else {
          const v = await AsyncStorage.getItem(ALARM_ENABLED_KEY);
          if (v === "1") setAlarmEnabled(true);
          if (v === "0") setAlarmEnabled(false);
        }
      } catch {
        // ignore
      } finally {
        setAlarmLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!alarmLoaded) return;

    const channel: Channel = deriveChannelFromMethods(methods);

    const payload: StoredSettings = {
      alarmEnabled,
      notify,
      channel,
      methods,
      onlyOnChange,
      email,
      kakao,
      phone,
    };

    const t = setTimeout(() => {
      (async () => {
        try {
          await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
          await AsyncStorage.setItem(ALARM_ENABLED_KEY, alarmEnabled ? "1" : "0");
        } catch {
          // ignore
        }
      })();
    }, 250);

    return () => clearTimeout(t);
  }, [alarmLoaded, alarmEnabled, notify, methods, onlyOnChange, email, kakao, phone]);

  const toggleMethod = (key: keyof NotifyMethods) => {
    setMethods((p) => ({ ...p, [key]: !p[key] }));
  };

  const phoneEnabled = methods.sms;
  const emailEnabled = methods.email;
  const kakaoEnabled = methods.kakao;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>설정</Text>
          <Text style={styles.heroSub}>
            업데이트 알림/연락처를 저장해두고{"\n"}원하는 소스만 켤 수 있어요.
          </Text>
        </View>

        <View style={[styles.card, styles.alarmCard]}>
          <Text style={styles.cardTitle}>알림</Text>

          {alarmLoaded ? (
            <RowToggle
              label="업데이트 알림 사용"
              value={alarmEnabled}
              onValueChange={setAlarmEnabled}
            />
          ) : (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>업데이트 알림 사용</Text>
              <Text style={styles.rowValue}>불러오는 중…</Text>
            </View>
          )}
        </View>

        {alarmEnabled ? (
          <View>
            <View style={[styles.card, styles.compactCardBottom]}>
              <Text style={styles.cardTitle}>알림 소스</Text>

              <RowToggle
                label="VASP"
                value={notify.vasp}
                onValueChange={(v) => setNotify((p) => ({ ...p, vasp: v }))}
              />
              <RowToggle
                label="금융거래등 제한대상"
                value={notify.restricted}
                onValueChange={(v) => setNotify((p) => ({ ...p, restricted: v }))}
              />
              <RowToggle
                label="OFAC"
                value={notify.ofac}
                onValueChange={(v) => setNotify((p) => ({ ...p, ofac: v }))}
              />
              <RowToggle
                label="UN"
                value={notify.un}
                onValueChange={(v) => setNotify((p) => ({ ...p, un: v }))}
              />
            </View>

            {/* ✅ 알림 방식 (다중 선택, 체크박스 없음) */}
            <View style={[styles.card, styles.compactCardBottom]}>
              <Text style={styles.cardTitle}>알림 방식</Text>

              <View style={styles.methodsRow}>
                <MethodBtn
                  label="배너"
                  active={methods.banner}
                  onPress={() => toggleMethod("banner")}
                />
                <MethodBtn
                  label="SMS"
                  active={methods.sms}
                  onPress={() => toggleMethod("sms")}
                />
                <MethodBtn
                  label="이메일"
                  active={methods.email}
                  onPress={() => toggleMethod("email")}
                />
                <MethodBtn
                  label="카카오톡"
                  active={methods.kakao}
                  onPress={() => toggleMethod("kakao")}
                />
              </View>
            </View>

            {/* ✅ 연락처 카드: 입력 순서 = 전화번호 → 이메일 → 카카오톡ID */}
            <View style={styles.card}>
              <Text style={styles.inputLabel}>전화번호</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="010-0000-0000"
                placeholderTextColor="#63708D"
                style={[styles.input, !phoneEnabled && styles.inputDisabled]}
                editable={phoneEnabled}
                keyboardType="phone-pad"
              />

              <Text style={styles.inputLabel}>이메일</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="example@company.com"
                placeholderTextColor="#63708D"
                style={[styles.input, !emailEnabled && styles.inputDisabled]}
                editable={emailEnabled}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <Text style={styles.inputLabel}>카카오톡ID</Text>
              <TextInput
                value={kakao}
                onChangeText={setKakao}
                placeholder="kakao-id"
                placeholderTextColor="#63708D"
                style={[styles.input, !kakaoEnabled && styles.inputDisabled]}
                editable={kakaoEnabled}
                autoCapitalize="none"
              />

              <Pressable
                onPress={() => {
                  console.log("설정 저장(자동 저장 중)", {
                    alarmEnabled,
                    notify,
                    methods,
                    onlyOnChange,
                    email,
                    kakao,
                    phone,
                  });
                }}
                style={({ pressed }) => [
                  styles.saveBtn,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.saveBtnText}>저장(임시)</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

function RowToggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function MethodBtn({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.methodBtn,
        active && styles.methodBtnActive,
        pressed && { opacity: 0.9 },
      ]}
    >
      <Text style={[styles.methodText, active && styles.methodTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  alarmCard: { paddingBottom: 4 },
  compactCardBottom: { paddingBottom: 4 },

  safe: { flex: 1, backgroundColor: "#020617" },
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 130,
  },

  hero: { alignItems: "center", paddingTop: 6, paddingBottom: 14 },
  heroTitle: {
    fontSize: 40,
    fontWeight: "900",
    color: "#EAF0FF",
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  heroSub: {
    fontSize: 14,
    color: "rgba(234, 240, 255, 0.70)",
    textAlign: "center",
    lineHeight: 20,
  },

  card: {
    marginTop: 14,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.12)",
  },
  cardTitle: {
    color: "#EAF0FF",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.10)",
  },
  rowLabel: {
    color: "rgba(234, 240, 255, 0.78)",
    fontSize: 13,
    fontWeight: "700",
  },
  rowValue: {
    color: "rgba(234, 240, 255, 0.65)",
    fontSize: 13,
    fontWeight: "700",
  },

  methodsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  methodBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2, 6, 23, 0.45)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },
  methodBtnActive: {
    backgroundColor: "rgba(37, 99, 235, 0.22)",
    borderColor: "rgba(156, 194, 255, 0.26)",
  },
  methodText: {
    color: "rgba(234, 240, 255, 0.60)",
    fontSize: 12,
    fontWeight: "900",
  },
  methodTextActive: { color: "#9CC2FF" },

  inputLabel: {
    marginTop: 12,
    marginBottom: 6,
    color: "rgba(234, 240, 255, 0.70)",
    fontSize: 12,
    fontWeight: "800",
  },
  input: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: "#EAF0FF",
    backgroundColor: "rgba(2, 6, 23, 0.45)",
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.14)",
  },
  inputDisabled: {
    opacity: 0.45,
  },

  saveBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#2B57D6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  saveBtnText: { color: "#EAF0FF", fontSize: 14, fontWeight: "900" },
});
