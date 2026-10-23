import { ActivityIndicator, View } from "react-native";
import { tokens } from "../theme/tokens";
import { Button } from "./Button";
import { Text } from "./Text";

export type ScreenState =
  | { kind: "loading"; title: string; description: string }
  | { kind: "empty" | "ready"; title: string; description: string }
  | {
      kind: "error";
      title: string;
      description: string;
      retry?: { label: string; run: () => void };
    };

export function StatePanel({ state }: { state: ScreenState }) {
  return (
    <View style={{ gap: tokens.space.control }} accessibilityLiveRegion="polite">
      {state.kind === "loading" ? (
        <ActivityIndicator accessibilityLabel={state.title} color={tokens.color.primary} />
      ) : null}
      <Text variant="heading" accessibilityRole="header">
        {state.title}
      </Text>
      <Text variant="muted">{state.description}</Text>
      {state.kind === "error" && state.retry ? (
        <Button variant="primary" label={state.retry.label} onPress={state.retry.run} />
      ) : null}
    </View>
  );
}
