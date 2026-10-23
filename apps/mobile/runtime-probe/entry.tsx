import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { probeFailureCategory } from "./failures";
import { ProbeFailure, probeConfig, report, runNativeProbe } from "./run";

// Explicit alternate entry for the isolated manual runtime checkout. Never imported by product routes.
function RuntimeProbe() {
  const [step, setStep] = useState("starting");
  useEffect(() => {
    let config: ReturnType<typeof probeConfig>;
    try {
      config = probeConfig();
    } catch {
      setStep("PROBE_CONFIG_INVALID");
      return;
    }
    let phase = "starting";
    void runNativeProbe(config, (value) => {
      phase = value;
      setStep(value);
    }).catch(async (error: unknown) => {
      const code =
        error instanceof ProbeFailure
          ? error.code
          : `PROBE_${phase.replaceAll("-", "_").toUpperCase()}_FAILED`;
      setStep(code);
      await report(config, "failure", { code, category: probeFailureCategory(error) }).catch(
        () => {},
      );
    });
  }, []);
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text>BARO_NATIVE_RUNTIME_PROBE</Text>
      <Text>{step}</Text>
    </View>
  );
}
registerRootComponent(RuntimeProbe);
