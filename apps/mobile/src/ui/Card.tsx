import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { tokens } from "../theme/tokens";

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}
const styles = StyleSheet.create({
  card: {
    gap: tokens.space.control,
    borderRadius: tokens.radius.card,
    padding: tokens.space.card,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.line,
    minWidth: 0,
    alignSelf: "stretch",
  },
});
