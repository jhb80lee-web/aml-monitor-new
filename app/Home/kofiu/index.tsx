// app/Home/kofiu/index.tsx
import React from "react";
import { Link } from "expo-router";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text } from "react-native";
import BottomTabBar from "../../../components/BottomTabBar";

export default function KofiuHomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ✅ 공통 헤더 톤으로 통일 */}
        <Text style={styles.appName}>AML MONITOR</Text>
        <Text style={styles.title}>KoFIU</Text>
        <Text style={styles.subtitle}>
          KoFIU 공시 기준으로{"\n"}
          VASP / 금융거래 등 제한대상자를 요약해서 보여줍니다.
        </Text>

        <Link href="/Home/kofiu/vasp" asChild>
          <Pressable style={styles.card}>
            <Text style={styles.cardTitle}>가상자산사업자 신고현황</Text>
            <Text style={styles.cardDescription}>
              금융위원회 공시 엑셀 기준{"\n"}
              신고 완료된 가상자산사업자 리스트 조회
            </Text>
          </Pressable>
        </Link>

        <Link href="/Home/kofiu/restricted" asChild>
          <Pressable style={styles.card}>
            <Text style={styles.cardTitle}>금융거래 등 제한대상자</Text>
            <Text style={styles.cardDescription}>
              KoFIU 공지사항 기반{"\n"}
              금융거래제한대상자(테러·제재 관련) 리스트 조회
            </Text>
          </Pressable>
        </Link>
      </ScrollView>

      <BottomTabBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020617" },

  // ✅ VASP와 동일 패딩
  scrollContent: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 130 },

  // ✅ VASP/OFAC/UN 공통 헤더 톤
  appName: { fontSize: 11, letterSpacing: 3, color: "rgba(234,240,255,0.55)", marginBottom: 6 },
  title: { fontSize: 26, fontWeight: "800", color: "#EAF0FF" },
  subtitle: { marginTop: 6, fontSize: 13, color: "rgba(234,240,255,0.70)", lineHeight: 18, marginBottom: 18 },

  // ✅ 카드 UI는 기존 유지
  card: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#F9FAFB", marginBottom: 4 },
  cardDescription: { fontSize: 12, color: "#9CA3AF", lineHeight: 18 },
});
