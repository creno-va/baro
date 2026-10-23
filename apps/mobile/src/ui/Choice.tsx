import { Pressable, StyleSheet } from "react-native";
import { tokens } from "../theme/tokens";
import { Text } from "./Text";

export function Choice({
  label,
  checked,
  disabled = false,
  onPress,
  kind = "checkbox",
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
  kind?: "checkbox" | "radio";
}) {
  return (
    <Pressable
      accessibilityRole={kind}
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        checked && styles.checked,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.indicator, disabled && styles.disabledText]}
      >
        {kind === "radio" ? (checked ? "●" : "○") : checked ? "✓" : "□"}
      </Text>
      <Text style={[styles.label, disabled && styles.disabledText]}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  choice: {
    minHeight: tokens.control.minimumSize,
    padding: 14,
    borderWidth: 1,
    borderColor: tokens.color.controlBorder,
    borderRadius: tokens.radius.control,
    backgroundColor: tokens.color.surface,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: tokens.space.control,
  },
  checked: { borderColor: tokens.color.primary },
  pressed: { backgroundColor: tokens.color.subtle },
  disabled: { backgroundColor: tokens.color.subtle, borderColor: tokens.color.line },
  indicator: { color: tokens.color.primary, flexShrink: 0 },
  label: { flex: 1, minWidth: 0 },
  disabledText: { color: tokens.color.muted },
});
