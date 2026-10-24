import { Text as NativeText, StyleSheet, type TextProps } from "react-native";
import { tokens } from "../theme/tokens";

export function Text({
  variant = "body",
  style,
  allowFontScaling = true,
  maxFontSizeMultiplier = 0,
  lineBreakStrategyIOS = "hangul-word",
  textBreakStrategy = "balanced",
  ...props
}: TextProps & { variant?: "body" | "title" | "heading" | "muted" }) {
  return (
    <NativeText
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      lineBreakStrategyIOS={lineBreakStrategyIOS}
      textBreakStrategy={textBreakStrategy}
      style={[styles.base, styles[variant], style]}
    />
  );
}
const styles = StyleSheet.create({
  base: { color: tokens.color.text, ...tokens.type.body, minWidth: 0 },
  body: {},
  title: { ...tokens.type.title, fontWeight: "700" },
  heading: { ...tokens.type.heading, fontWeight: "600" },
  muted: { color: tokens.color.muted },
});
