import { useRouter } from "expo-router";
import { GuideScreen } from "../features/foundation/ui/GuideScreen";

export default function GuideRoute() {
  const router = useRouter();
  return <GuideScreen onBack={() => router.replace("/")} />;
}
