import { Image, Pressable, StyleSheet } from "react-native";
import { Text } from "./Text";

/** Official unmodified artwork; approved localized titles and scalable system text. */
export function AppleSignInButton({
  onPress,
  disabled = false,
  kind = "sign-in",
  accessibilityHint,
}: {
  onPress(): void;
  disabled?: boolean;
  kind?: "sign-in" | "continue";
  accessibilityHint?: string;
}) {
  const label = kind === "continue" ? "Apple로 계속하기" : "Apple로 로그인";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && !disabled && styles.pressed]}
    >
      <Image
        source={require("../../assets/auth/apple-white.png")}
        style={styles.logo}
        resizeMode="contain"
        accessible={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    minWidth: 140,
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "#000000",
    paddingHorizontal: 12,
  },
  pressed: { backgroundColor: "#222222" },
  // Retain the official built-in padding. The glyph is never cropped or stretched.
  logo: { width: 54, height: 54, flexShrink: 0 },
  label: {
    color: "#ffffff",
    fontFamily: undefined,
    fontWeight: "500",
    fontSize: 19,
    lineHeight: 26,
    textAlign: "center",
    flexShrink: 1,
    minWidth: 0,
    paddingVertical: 14,
  },
});
