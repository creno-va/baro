import type { PropsWithChildren } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { nativePagePadding, tokens } from "../theme/tokens";

/** Stack owns the top inset/header. Lists can own scrolling with scroll=false. */
export function Screen({
  children,
  scroll = true,
  keyboardOffset = 0,
}: PropsWithChildren<{ scroll?: boolean; keyboardOffset?: number }>) {
  const { width } = useWindowDimensions();
  const content = [styles.content, { paddingHorizontal: nativePagePadding(width) }];
  return (
    <SafeAreaView style={styles.fill} edges={["left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        {scroll ? (
          <ScrollView
            style={styles.fill}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            contentContainerStyle={content}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[content, styles.fill]}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: tokens.color.background },
  content: {
    flexGrow: 1,
    minWidth: 0,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingVertical: tokens.space.page,
    gap: tokens.space.section,
  },
});
