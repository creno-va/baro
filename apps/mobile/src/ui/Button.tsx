import { Pressable, StyleSheet } from "react-native";
import { tokens } from "../theme/tokens";
import { Text } from "./Text";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
  variant?: "primary" | "secondary" | "danger";
}

export function Button({
  label,
  onPress,
  disabled = false,
  accessibilityHint,
  variant = "secondary",
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && !disabled && (variant === "primary" ? styles.primaryPressed : styles.pressed),
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === "primary" && styles.onPrimary,
          variant === "danger" && styles.dangerLabel,
          disabled && styles.disabledLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: tokens.control.minimumSize,
    minWidth: tokens.control.minimumSize,
    borderRadius: tokens.radius.control,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  primary: { backgroundColor: tokens.color.primary, borderColor: tokens.color.primary },
  secondary: { backgroundColor: tokens.color.surface, borderColor: tokens.color.controlBorder },
  danger: { backgroundColor: tokens.color.surface, borderColor: tokens.color.danger },
  primaryPressed: {
    backgroundColor: tokens.color.primaryPressed,
    borderColor: tokens.color.primaryPressed,
  },
  pressed: { backgroundColor: tokens.color.subtle },
  disabled: { backgroundColor: tokens.color.subtle, borderColor: tokens.color.line },
  label: {
    fontWeight: "600",
    textAlign: "center",
    alignSelf: "stretch",
    flexShrink: 1,
    minWidth: 0,
  },
  onPrimary: { color: tokens.color.onPrimary },
  dangerLabel: { color: tokens.color.danger },
  disabledLabel: { color: tokens.color.muted },
});
