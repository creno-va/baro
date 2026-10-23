import { registerRootComponent } from "expo";
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { getCaseOperationStorage } from "../src/composition/cases";
import { readMobileConfig } from "../src/composition/config";
import { getMobileCredentials } from "../src/composition/credentials";
import { createExpoUploadSources } from "../src/platform/files/documents";
import { createExpoDownloads } from "../src/platform/files/expo-download";
import { requireNativeDiskPort } from "../src/platform/files/native-module";
import { probeFailureCategory } from "./failures";
import {
  type IosReadinessReport,
  iosHostPhaseSchema,
  iosReadinessReportSchema,
} from "./ios-keychain-protocol";
import { OWNER_COOKIE } from "./protocol";
import { diagnosticControlConfig } from "./run";

async function execute() {
  const originalFetch = globalThis.fetch;
  let externalFetchAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.origin !== "http://127.0.0.1:8765") {
      externalFetchAttempts++;
      throw new Error("IOS_HOST_EXTERNAL_FETCH_DENIED");
    }
    return originalFetch(input, init);
  };
  const config = diagnosticControlConfig(),
    headers = { "x-baro-probe-run": config.nonce };
  const response = await fetch(`${config.origin}/ios-host`, { headers });
  if (!response.ok) throw new Error("IOS_HOST_CONTROL_REJECTED");
  const phase = iosHostPhaseSchema.parse(await response.json());
  const operations: IosReadinessReport["operations"] = [];
  const attempt = async (
    stage: IosReadinessReport["operations"][number]["stage"],
    run: () => Promise<unknown>,
  ) => {
    try {
      await run();
      operations.push({ stage, ok: true });
    } catch (error) {
      operations.push({ stage, ok: false, category: probeFailureCategory(error) });
    }
  };
  const check = (condition: boolean) => {
    if (!condition) throw new Error("IOS_HOST_CHECK_FAILED");
  };
  const native = requireNativeDiskPort(),
    sources = createExpoUploadSources({
      namespace: "baro_ios_host_uploads",
      newId: randomUUID,
      pick: async () => ({ canceled: true, assets: null }),
    }),
    cache = createExpoDownloads("baro_ios_host_downloads", randomUUID);
  const { credentials } = getMobileCredentials(),
    storage = getCaseOperationStorage(),
    key = `baro.ios.host.${config.nonce}`,
    operationKey = `baro-lawyer-upload-v2:${await digestStringAsync(CryptoDigestAlgorithm.SHA256, config.nonce)}`,
    value = JSON.stringify({ key: randomUUID(), expectedRevision: 1 });
  const directOptions = {
    keychainService: `${readMobileConfig().applicationId}.ios-host-probe`,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  await attempt("native-clear", () => native.clear());
  await attempt("source-clear", () => sources.clear());
  await attempt("download-cache-clear", () => cache.clear());
  await attempt("credential-reset", () => credentials.reset());
  await attempt("credential-store-readback", async () => {
    await credentials.capture().accept(`${OWNER_COOKIE}; Path=/; HttpOnly; SameSite=Lax`);
    check((await credentials.capture().cookie()) === OWNER_COOKIE);
  });
  await attempt("recovery-key-write-readback", async () => {
    await storage.setItem(operationKey, value);
    check((await storage.getItem(operationKey)) === value);
  });
  await attempt("secure-store-direct-readback", async () => {
    await SecureStore.setItemAsync(key, "synthetic-sdk-readback", directOptions);
    check((await SecureStore.getItemAsync(key, directOptions)) === "synthetic-sdk-readback");
  });
  await attempt("cleanup", async () => {
    const results = await Promise.allSettled([
      native.clear(),
      sources.clear(),
      cache.clear(),
      credentials.reset(),
      Promise.resolve(storage.removeItem(operationKey)),
      SecureStore.deleteItemAsync(key, directOptions),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  });
  const result = iosReadinessReportSchema.parse({
    version: 1,
    kind: "simulator-sdk-readiness",
    sourceSha: config.sourceSha,
    phase,
    operations,
    allSucceeded: operations.every((op) => op.ok) && externalFetchAttempts === 0,
    externalFetchAttempts,
  });
  const sent = await fetch(`${config.origin}/ios-host`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(result),
  });
  if (!sent.ok) throw new Error("IOS_HOST_REPORT_REJECTED");
  return result;
}
function IosKeychainProbe() {
  const started = useRef(false),
    [state, setState] = useState("starting");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void execute()
      .then((value) => setState(value.allSucceeded ? "passed" : "observed-failure"))
      .catch(() => setState("IOS_HOST_PROBE_FAILED"));
  }, []);
  return (
    <View>
      <Text>BARO_IOS_KEYCHAIN_HOST_PROBE</Text>
      <Text>{state}</Text>
    </View>
  );
}
registerRootComponent(IosKeychainProbe);
