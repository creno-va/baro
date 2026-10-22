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
      style={[styles.choice, checked && styles.checked, disabled && { opacity: 0.5 }]}
    >
      <Text>
        {checked ? "● " : "○ "}
        {label}
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  choice: {
    minHeight: 48,
    padding: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.control,
    justifyContent: "center",
  },
  checked: { borderColor: tokens.color.primary },
});
