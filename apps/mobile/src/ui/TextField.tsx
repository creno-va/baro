import { useState } from "react";
import { StyleSheet, TextInput, type TextInputProps, View } from "react-native";
import { tokens } from "../theme/tokens";
import { Text } from "./Text";

export function TextField({
  label,
  style,
  editable = true,
  multiline = false,
  onFocus,
  onBlur,
  accessibilityState,
  allowFontScaling = true,
  maxFontSizeMultiplier = 0,
  ...props
}: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        editable={editable}
        multiline={multiline}
        allowFontScaling={allowFontScaling}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        accessibilityState={{
          ...accessibilityState,
          disabled: !editable || !!accessibilityState?.disabled,
        }}
        placeholderTextColor={tokens.color.muted}
        selectionColor={tokens.color.primary}
        underlineColorAndroid="transparent"
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          multiline && styles.multiline,
          !editable && styles.readOnly,
          focused && editable && styles.focused,
          style,
        ]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  field: { gap: tokens.space.small, minWidth: 0 },
  input: {
    minHeight: tokens.control.minimumSize,
    padding: 12,
    ...tokens.type.body,
    color: tokens.color.text,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.controlBorder,
    borderRadius: tokens.radius.control,
    minWidth: 0,
  },
  multiline: { minHeight: 120, textAlignVertical: "top" },
  readOnly: { backgroundColor: tokens.color.subtle },
  focused: { borderColor: tokens.color.primary, borderWidth: 2, padding: 11 },
});
