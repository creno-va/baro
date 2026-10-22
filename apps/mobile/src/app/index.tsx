import { useRouter } from "expo-router";
import { readMobileConfig } from "../composition/config";
import { createFoundationModel } from "../features/foundation/model";
import { WelcomeScreen } from "../features/foundation/ui/WelcomeScreen";

export default function HomeRoute() {
  const router = useRouter();
  return (
    <WelcomeScreen
      model={createFoundationModel(readMobileConfig)}
      onContinue={() => router.push("/guide")}
    />
  );
}
