import { useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { tokens } from "../../../theme/tokens";
import { Button } from "../../../ui/Button";
import { Choice } from "../../../ui/Choice";
import { Text } from "../../../ui/Text";

export function DirectoryFilter({
  label,
  value,
  labels,
  onChange,
}: {
  label: string;
  value: string;
  labels: Record<string, string>;
  onChange(value: string): void;
}) {
  const [visible, setVisible] = useState(false);
  const close = () => setVisible(false);
  return (
    <>
      <Button label={`${label}: ${labels[value] ?? "전체"}`} onPress={() => setVisible(true)} />
      <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            padding: tokens.space.page,
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              maxHeight: "80%",
              backgroundColor: tokens.color.surface,
              padding: tokens.space.page,
              gap: tokens.space.control,
              borderRadius: tokens.radius.control,
            }}
          >
            <Text variant="heading" accessibilityRole="header">
              {label} 선택
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: tokens.space.control }}
            >
              {[["", "전체"], ...Object.entries(labels)].map(([key = "", title = ""]) => (
                <Choice
                  key={key}
                  label={`${label} ${title}`}
                  kind="radio"
                  checked={value === key}
                  onPress={() => {
                    onChange(key);
                    close();
                  }}
                />
              ))}
            </ScrollView>
            <Button label={`${label} 선택 닫기`} onPress={close} />
          </View>
        </View>
      </Modal>
    </>
  );
}
