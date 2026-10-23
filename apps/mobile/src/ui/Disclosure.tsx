import { type PropsWithChildren, type ReactNode, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { tokens } from "../theme/tokens";
import { Text } from "./Text";

/** Presentation only. Drafts/actions stay in the feature model; critical states can keep it visible. */
export function Disclosure({
  title,
  summary,
  children,
  preview = null,
  keepOpen = false,
}: PropsWithChildren<{ title: string; summary: string; preview?: ReactNode; keepOpen?: boolean }>) {
  const [expanded, setExpanded] = useState(keepOpen);
  const visible = expanded || keepOpen;
  useEffect(() => {
    if (keepOpen) setExpanded(true);
  }, [keepOpen]);
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={
          keepOpen ? "현재 수정이나 요청 결과를 확인할 수 있도록 펼쳐 두었어요." : summary
        }
        accessibilityState={{ expanded: visible, disabled: keepOpen }}
        disabled={keepOpen}
        onPress={() => setExpanded(!visible)}
        style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      >
        <Text style={styles.title}>{title}</Text>
        <Text
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {visible ? "−" : "+"}
        </Text>
      </Pressable>
      <Text variant="muted">{summary}</Text>
      {visible ? children : preview}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: tokens.space.control, minWidth: 0 },
  control: {
    minHeight: tokens.control.minimumSize,
    borderWidth: 1,
    borderColor: tokens.color.controlBorder,
    borderRadius: tokens.radius.control,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.control,
    backgroundColor: tokens.color.surface,
  },
  pressed: { backgroundColor: tokens.color.subtle },
  title: { flex: 1, minWidth: 0, fontWeight: "600" },
});
