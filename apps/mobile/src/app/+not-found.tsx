import { useRouter } from "expo-router";
import { Button } from "../ui/Button";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

export default function NotFoundRoute() {
  const router = useRouter();
  return (
    <Screen>
      <StatePanel
        state={{
          kind: "empty",
          title: "페이지를 찾을 수 없어요",
          description: "처음 화면에서 다시 시작해 주세요.",
        }}
      />
      <Button label="처음으로" onPress={() => router.replace("/")} />
    </Screen>
  );
}
