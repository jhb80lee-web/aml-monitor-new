// app/notificationsConfig.ts
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// expo-notifications 의 NotificationBehavior 타입에 정확히 맞춤
const defaultBehavior: Notifications.NotificationBehavior = {
  shouldShowAlert: true,
  shouldPlaySound: true,
  shouldSetBadge: true,
  shouldShowList: true,
  shouldShowBanner: true, // ← 타입 정의에 있는 필수 필드
};

Notifications.setNotificationHandler({
  handleNotification: async () => defaultBehavior,
});

export async function initNotifications() {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.log("🔕 알림 권한이 없어 로컬 알림을 사용할 수 없습니다.");
    return false;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  return true;
}

export async function sendLocalNotification(title: string, body: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: "default",
      },
      trigger: null, // 즉시 알림
    });
  } catch (e) {
    console.log("🔔 로컬 알림 전송 실패", e);
  }
}

export async function setAppBadgeCount(count: number) {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (e) {
    console.log("🎯 배지 설정 실패", e);
  }
}
