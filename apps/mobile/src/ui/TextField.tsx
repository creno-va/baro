import { StyleSheet, TextInput, type TextInputProps, View } from "react-native";
import { tokens } from "../theme/tokens";
import { Text } from "./Text";

export function TextField({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={tokens.color.muted}
        style={styles.input}
        {...props}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: tokens.space.small },
  input: {
    minHeight: 48,
    padding: 12,
    fontSize: 16,
    color: tokens.color.text,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.control,
  },
});
