import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { tokens } from "../theme/tokens";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: tokens.color.text,
          headerStyle: { backgroundColor: tokens.color.surface },
          contentStyle: { backgroundColor: tokens.color.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: "BARO" }} />
        <Stack.Screen name="guide" options={{ title: "이용 안내" }} />
        <Stack.Screen name="+not-found" options={{ title: "페이지 안내" }} />
      </Stack>
    </SafeAreaProvider>
  );
}
