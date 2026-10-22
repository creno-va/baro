import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MobileChallengePortal } from "../composition/challenge";
import { startSessionLifecycle } from "../composition/lifecycle";
import { tokens } from "../theme/tokens";

export default function RootLayout() {
  useEffect(() => {
    try {
      return startSessionLifecycle();
    } catch {
      return;
    }
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <MobileChallengePortal />
      <Stack
        screenOptions={{
          headerTintColor: tokens.color.text,
          headerStyle: { backgroundColor: tokens.color.surface },
          contentStyle: { backgroundColor: tokens.color.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "BARO" }} />
        <Stack.Screen name="guide" options={{ title: "이용 안내" }} />
        <Stack.Screen name="directory" options={{ title: "변호사 탐색" }} />
        <Stack.Screen name="session" options={{ title: "로그인·내 계정" }} />
        <Stack.Screen name="cases" options={{ title: "내 사건" }} />
        <Stack.Screen name="workspace" options={{ title: "사건 작업공간" }} />
        <Stack.Screen name="files" options={{ title: "사건 자료" }} />
        <Stack.Screen name="reports" options={{ title: "상담 준비 리포트" }} />
        <Stack.Screen name="+not-found" options={{ title: "페이지 안내" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
