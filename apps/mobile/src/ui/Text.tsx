import { Text as NativeText, StyleSheet, type TextProps } from "react-native";
import { tokens } from "../theme/tokens";

export function Text({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: "body" | "title" | "heading" | "muted" }) {
  return <NativeText {...props} style={[styles.base, styles[variant], style]} />;
}

const styles = StyleSheet.create({
  base: { color: tokens.color.text, fontSize: 16, lineHeight: 26 },
  body: {},
  title: { fontSize: 30, lineHeight: 40, fontWeight: "700" },
  heading: { fontSize: 20, lineHeight: 30, fontWeight: "600" },
  muted: { color: tokens.color.muted },
});
