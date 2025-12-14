// app/Home/kofiu/index.tsx
import { Link } from "expo-router";
import React from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text
} from "react-native";

export default function KofiuHomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>KoFIU 화면</Text>
        <Text style={styles.subtitle}>
          · 가상자산사업자 신고현황 (VASP){"\n"}
          · 금융거래 등 제한대상자
        </Text>

        <Link href="/Home/kofiu/vasp" asChild>
          <Pressable style={styles.card}>
            <Text style={styles.cardTitle}>가상자산사업자 신고현황</Text>
            <Text style={styles.cardDescription}>
              금융위원회 공시 엑셀 기준{"\n"}
              신고 완료된 27개 가상자산사업자 리스트 조회
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#020617",
  },
  scrollContent: {
    padding: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#F9FAFB",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#9CA3AF",
    marginBottom: 16,
    lineHeight: 18,
  },
  card: {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#F9FAFB",
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 12,
    color: "#9CA3AF",
    lineHeight: 18,
  },
});
