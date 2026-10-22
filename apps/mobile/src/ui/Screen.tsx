import type { PropsWithChildren } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tokens } from "../theme/tokens";

export function Screen({ children, scroll = true }: PropsWithChildren<{ scroll?: boolean }>) {
  return (
    <SafeAreaView style={styles.fill} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, { flex: 1 }]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: tokens.color.background },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: tokens.space.page,
    gap: tokens.space.section,
  },
});
