import { Pressable, StyleSheet } from "react-native";
import { tokens } from "../theme/tokens";
import { Text } from "./Text";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
}

export function Button({ label, onPress, disabled = false, accessibilityHint }: ButtonProps) {
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
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: tokens.radius.control,
    backgroundColor: tokens.color.primary,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { color: tokens.color.onPrimary, fontWeight: "600", textAlign: "center" },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.5 },
});
