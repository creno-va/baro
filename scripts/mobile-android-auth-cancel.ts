import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  androidChromeFixtureSchema,
  knownAndroidChromeFixtureFailure,
} from "./mobile-android-chrome-fixture";
import { androidGuideUiReceiptSchema } from "./mobile-android-guide-ui";

const appId = "site.baro.app.preview";
const providers = ["google", "naver", "kakao"] as const;
type Provider = (typeof providers)[number];
const labels = {
  session: "로그인·내 계정",
  google: "Google로 로그인",
  naver: "네이버로 로그인",
  kakao: "카카오로 로그인",
} as const;
export function androidAuthenticationPrivacyBoundary() {
  let entered = false;
  return {
    enterPublicData() {
      entered = true;
    },
    enterAuthentication() {
      entered = true;
    },
    get entered() {
      return entered;
    },
    assertCommandAllowed(args: readonly string[]) {
      if (
        entered &&
        args.some((part) =>
          ["screencap", "screenrecord", "bugreport", "logcat"].includes(
            part.split("/").at(-1) ?? "",
          ),
        )
      )
        throw Error("ANDROID_AUTH_CAPTURE_FORBIDDEN");
    },
  };
}
function nodes(xml: string) {
  if (xml.length > 1_000_000 || !xml.startsWith("<?xml") || /<!DOCTYPE|<!ENTITY/.test(xml))
    throw Error("ANDROID_AUTH_HIERARCHY_INVALID");
  const matches = [...xml.matchAll(/<node\b[^>]*>/g)];
  if (matches.length > 10000) throw Error("ANDROID_AUTH_HIERARCHY_INVALID");
  return matches.map((match) =>
    Object.fromEntries(
      [...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]),
    ),
  );
}
function viewport(width: number, height: number) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 8192))
    throw Error("ANDROID_AUTH_VIEWPORT_INVALID");
}
function bounds(node: Record<string, string | undefined>, width: number, height: number) {
  const values = node.bounds
    ?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)
    ?.slice(1)
    .map(Number);
  if (values?.length !== 4) return null;
  const [x1, y1, x2, y2] = values;
  if (
    x1 === undefined ||
    y1 === undefined ||
    x2 === undefined ||
    y2 === undefined ||
    x1 < 0 ||
    y1 < 0 ||
    x2 > width ||
    y2 > height ||
    x2 <= x1 ||
    y2 <= y1
  )
    return null;
  return { x1, y1, x2, y2 };
}
export function androidAnonymousAuthObservation(xml: string) {
  const owned = nodes(xml).filter((node) => node.package === appId && node.enabled === "true");
  const has = (label: string) =>
    owned.some((node) => node.text === label || node["content-desc"] === label);
  return {
    anonymousGatePresent: has("BARO 로그인") && has("이용 유형을 선택해 주세요."),
    authorizingPresent: has("로그인을 확인하고 있어요"),
    errorPresent:
      has("이용 상태 다시 확인") ||
      has("로그인을 시작하지 못했어요. 다시 시도해 주세요.") ||
      has("앱을 열 수 없어요"),
    consentPresent: has("시작 전에 확인해 주세요"),
    authenticatedPresent: has("내 계정") || has("로그아웃"),
  };
}
export function androidAuthAppControl(
  xml: string,
  width: number,
  height: number,
  control: keyof typeof labels,
) {
  viewport(width, height);
  if (!Object.hasOwn(labels, control)) throw Error("ANDROID_AUTH_CONTROL_INVALID");
  const candidates = nodes(xml).filter(
    (node) =>
      node.package === appId &&
      node.enabled === "true" &&
      node.clickable === "true" &&
      node["visible-to-user"] !== "false" &&
      [node.text, node["content-desc"]].includes(labels[control]),
  );
  if (candidates.length !== 1 || !candidates[0]) return null;
  const rect = bounds(candidates[0], width, height);
  return rect && rect.x2 - rect.x1 >= 40 && rect.y2 - rect.y1 >= 40
    ? { x: Math.floor((rect.x1 + rect.x2) / 2), y: Math.floor((rect.y1 + rect.y2) / 2) }
    : null;
}
export function androidAuthActivityObservation(text: string) {
  if (text.length > 4_000_000) throw Error("ANDROID_AUTH_ACTIVITY_INVALID");
  const lines = text.split(/\r?\n/);
  const top = lines.filter((line) => /\btopResumedActivity\s*[=:]/.test(line));
  const entries = top.length ? top : lines.filter((line) => /\bmResumedActivity\s*[=:]/.test(line));
  const component =
    entries.length === 1
      ? entries[0]?.match(/\bu\d+\s+([A-Za-z][\w.]*)\/([A-Za-z.][\w.$]*)\s/)
      : null;
  const pkg = component?.[1],
    activity = component?.[2];
  return {
    appForeground:
      pkg === appId && [".MainActivity", `${appId}.MainActivity`].includes(activity ?? ""),
    chromeCustomTabForeground:
      pkg === "com.android.chrome" &&
      activity === "org.chromium.chrome.browser.customtabs.CustomTabActivity",
    chromeFirstRunForeground:
      pkg === "com.android.chrome" &&
      activity === "org.chromium.chrome.browser.firstrun.FirstRunActivity",
    foregroundAmbiguous: entries.length !== 1 || !component,
  };
}
export function androidCustomTabControls(xml: string, width: number, height: number) {
  viewport(width, height);
  const chrome = nodes(xml).filter(
    (node) =>
      node.package === "com.android.chrome" &&
      node.enabled === "true" &&
      node["visible-to-user"] !== "false",
  );
  const web = chrome.filter((node) => node.class === "android.webkit.WebView");
  const frames = web.map((node) => bounds(node, width, height));
  const geometry =
    frames.length > 0 && frames.length <= 8 && frames.every((frame) => frame !== null);
  const close = chrome.filter(
    (node) =>
      node["resource-id"] === "com.android.chrome:id/close_button" &&
      node.class === "android.widget.ImageButton" &&
      node.clickable === "true",
  );
  const candidate = close.length === 1 && close[0] ? bounds(close[0], width, height) : null;
  return {
    webViewGeometryVerified: geometry,
    uniqueNativeCloseControl:
      close.length === 1 &&
      candidate !== null &&
      candidate.x2 - candidate.x1 >= 40 &&
      candidate.y2 - candidate.y1 >= 40,
    closeControlOutsideEveryWebView:
      geometry &&
      candidate !== null &&
      frames.every(
        (frame) =>
          frame !== null &&
          (candidate.x2 <= frame.x1 ||
            candidate.x1 >= frame.x2 ||
            candidate.y2 <= frame.y1 ||
            candidate.y1 >= frame.y2),
      ),
  };
}
const providerResult = z.strictObject({
  provider: z.enum(providers),
  initialAnonymousObserved: z.literal(true),
  providerButtonObserved: z.literal(true),
  chromeCustomTabForeground: z.literal(true),
  webViewGeometryVerified: z.literal(true),
  uniqueNativeCloseControl: z.literal(true),
  closeControlOutsideEveryWebView: z.literal(true),
  systemBackPresses: z.literal(1),
  appForegroundReturned: z.literal(true),
  anonymousReturnObserved: z.literal(true),
  errorStateAbsent: z.literal(true),
  consentStateAbsent: z.literal(true),
});
const identitySchema = androidGuideUiReceiptSchema.pick({
  toolingSourceSha: true,
  binarySourceSha: true,
  binary: true,
  verificationSha256: true,
  baselineReceiptSha256: true,
  device: true,
});
export const androidAuthCancelReceiptSchema = identitySchema.extend({
  version: z.literal(1),
  kind: z.literal("android-anonymous-custom-tab-cancellation"),
  observedAt: z.iso.datetime(),
  applicationId: z.literal(appId),
  browserPackage: z.literal("com.android.chrome"),
  browserFixture: androidChromeFixtureSchema,
  providers: z
    .array(providerResult)
    .length(3)
    .refine((value) => value.map((v) => v.provider).join(",") === "google,naver,kakao"),
  coldAnonymousReturnObserved: z.literal(true),
  explicitScreenshotsSuppressedBeforeNavigation: z.literal(true),
  adbCommandOutputPersisted: z.literal(false),
  rawHierarchyExported: z.literal(false),
  rawLogcatRead: z.literal(false),
  accountLoginPerformed: z.literal(false),
  credentialsEntered: z.literal(false),
  callbackExchangeVerified: z.literal(false),
  providerAcceptanceVerified: z.literal(false),
  privateDataAccess: z.literal(false),
  publicDataNavigation: z.literal(false),
  authenticationNavigation: z.literal(true),
  metroRequests: z.literal(0),
  physicalDeviceVerified: z.literal(false),
  remoteApiVerified: z.literal(false),
  oauthVerified: z.literal(false),
  storeSigned: z.literal(false),
  deployed: z.literal(false),
});
type Identity = z.infer<typeof identitySchema>;
export function verifyAndroidAuthCancelReceipt(value: unknown, expected: Identity) {
  const result = androidAuthCancelReceiptSchema.parse(value);
  if (
    JSON.stringify(identitySchema.strip().parse(result)) !==
    JSON.stringify(identitySchema.parse(expected))
  )
    throw Error("ANDROID_AUTH_IDENTITY_MISMATCH");
  return result;
}
export const androidAuthDiagnosticSchema = z.strictObject({
  provider: z.enum(providers).nullable(),
  stage: z.enum([
    "open-session",
    "anonymous",
    "provider-tapped",
    "browser",
    "system-back",
    "anonymous-returned",
    "cold-restart",
  ]),
  app: z
    .strictObject({
      anonymousGatePresent: z.boolean(),
      authorizingPresent: z.boolean(),
      errorPresent: z.boolean(),
      consentPresent: z.boolean(),
      authenticatedPresent: z.boolean(),
    })
    .nullable(),
  activity: z
    .strictObject({
      appForeground: z.boolean(),
      chromeCustomTabForeground: z.boolean(),
      chromeFirstRunForeground: z.boolean(),
      foregroundAmbiguous: z.boolean(),
    })
    .nullable(),
  browser: z
    .strictObject({
      webViewGeometryVerified: z.boolean(),
      uniqueNativeCloseControl: z.boolean(),
      closeControlOutsideEveryWebView: z.boolean(),
    })
    .nullable(),
});
export type AndroidAuthDiagnostic = z.infer<typeof androidAuthDiagnosticSchema>;
export function androidAuthFailureCode(error: unknown) {
  const chromeFailure = knownAndroidChromeFixtureFailure(error);
  if (chromeFailure) return chromeFailure;
  const code = error instanceof Error ? error.message : "";
  return new Set([
    "ANDROID_AUTH_CAPTURE_FORBIDDEN",
    "ANDROID_AUTH_HIERARCHY_INVALID",
    "ANDROID_AUTH_VIEWPORT_INVALID",
    "ANDROID_AUTH_CONTROL_INVALID",
    "ANDROID_AUTH_ACTIVITY_INVALID",
    "ANDROID_AUTH_IDENTITY_MISMATCH",
    "ANDROID_AUTH_BOUNDARY_REQUIRED",
    "ANDROID_AUTH_CONTROL_NOT_FOUND",
    "ANDROID_AUTH_ANONYMOUS_REQUIRED",
    "ANDROID_AUTH_CHROME_UNAVAILABLE",
    "ANDROID_AUTH_BROWSER_REQUIRED",
    "ANDROID_AUTH_RETURN_REQUIRED",
    "ANDROID_AUTH_COLD_LAUNCH_FAILED",
  ]).has(code)
    ? code
    : "ANDROID_AUTH_VALIDATION_FAILED";
}
export async function observeAndroidAuthCancellation(context: {
  shell: (args: string[]) => Promise<string>;
  width: number;
  height: number;
  boundaryEntered: boolean;
  screenshotsSuppressed: boolean;
  diagnostic: (value: AndroidAuthDiagnostic) => void;
}) {
  if (!context.boundaryEntered || !context.screenshotsSuppressed)
    throw Error("ANDROID_AUTH_BOUNDARY_REQUIRED");
  const { shell, width, height } = context;
  viewport(width, height);
  const file = `/data/local/tmp/baro-auth-${randomUUID()}.xml`;
  let provider: Provider | null = null,
    stage: AndroidAuthDiagnostic["stage"] = "open-session";
  let app: AndroidAuthDiagnostic["app"] = null,
    activity: AndroidAuthDiagnostic["activity"] = null,
    browser: AndroidAuthDiagnostic["browser"] = null;
  const report = () =>
    context.diagnostic(
      androidAuthDiagnosticSchema.parse({ provider, stage, app, activity, browser }),
    );
  async function hierarchy() {
    try {
      await shell(["uiautomator", "dump", "--compressed", file]);
      return await shell(["cat", file]);
    } finally {
      await shell(["rm", "-f", file]).catch(() => {});
    }
  }
  async function foreground() {
    activity = androidAuthActivityObservation(await shell(["dumpsys", "activity", "activities"]));
    return activity;
  }
  async function pause() {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  async function reach(control: keyof typeof labels) {
    for (let count = 0; count <= 24; count++) {
      const xml = await hierarchy();
      app = androidAnonymousAuthObservation(xml);
      report();
      if (!(await foreground()).appForeground) throw Error("ANDROID_AUTH_CONTROL_NOT_FOUND");
      const point = androidAuthAppControl(xml, width, height, control);
      if (point) return point;
      if (count < 24)
        await shell([
          "input",
          "swipe",
          String(Math.floor(width / 2)),
          String(Math.floor(height * 0.8)),
          String(Math.floor(width / 2)),
          String(Math.floor(height * 0.25)),
          "500",
        ]);
    }
    throw Error("ANDROID_AUTH_CONTROL_NOT_FOUND");
  }
  async function anonymous() {
    for (let attempt = 0; attempt < 20; attempt++) {
      app = androidAnonymousAuthObservation(await hierarchy());
      await foreground();
      report();
      if (
        activity?.appForeground &&
        app.anonymousGatePresent &&
        !app.authorizingPresent &&
        !app.errorPresent &&
        !app.consentPresent &&
        !app.authenticatedPresent
      )
        return;
      await pause();
    }
    throw Error("ANDROID_AUTH_ANONYMOUS_REQUIRED");
  }
  async function openSession() {
    stage = "open-session";
    const point = await reach("session");
    await shell(["input", "tap", String(point.x), String(point.y)]);
    stage = "anonymous";
    await anonymous();
  }
  if (!/^package:\S+/m.test(await shell(["pm", "path", "com.android.chrome"])))
    throw Error("ANDROID_AUTH_CHROME_UNAVAILABLE");
  await openSession();
  const results: z.input<typeof providerResult>[] = [];
  for (const current of providers) {
    provider = current;
    stage = "anonymous";
    browser = null;
    await anonymous();
    const point = await reach(current);
    await shell(["input", "tap", String(point.x), String(point.y)]);
    app = null;
    activity = null;
    stage = "provider-tapped";
    report();
    let verified = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const observedActivity = await foreground();
      stage = "browser";
      const xml = await hierarchy();
      app = androidAnonymousAuthObservation(xml);
      browser = androidCustomTabControls(xml, width, height);
      report();
      if (
        observedActivity.chromeCustomTabForeground &&
        browser.webViewGeometryVerified &&
        browser.uniqueNativeCloseControl &&
        browser.closeControlOutsideEveryWebView
      ) {
        verified = true;
        break;
      }
      if (observedActivity.chromeFirstRunForeground) break;
      await pause();
    }
    if (!verified) throw Error("ANDROID_AUTH_BROWSER_REQUIRED");
    if (!(await foreground()).chromeCustomTabForeground)
      throw Error("ANDROID_AUTH_BROWSER_REQUIRED");
    stage = "system-back";
    await shell(["input", "keyevent", "KEYCODE_BACK"]);
    app = null;
    activity = null;
    browser = null;
    report();
    await anonymous();
    if (!(await foreground()).appForeground) throw Error("ANDROID_AUTH_RETURN_REQUIRED");
    stage = "anonymous-returned";
    report();
    results.push({
      provider: current,
      initialAnonymousObserved: true,
      providerButtonObserved: true,
      chromeCustomTabForeground: true,
      webViewGeometryVerified: true,
      uniqueNativeCloseControl: true,
      closeControlOutsideEveryWebView: true,
      systemBackPresses: 1,
      appForegroundReturned: true,
      anonymousReturnObserved: true,
      errorStateAbsent: true,
      consentStateAbsent: true,
    });
  }
  stage = "cold-restart";
  report();
  await shell(["am", "force-stop", appId]);
  const launched = await shell(["am", "start", "-W", "-n", `${appId}/${appId}.MainActivity`]);
  if (!/^Status:\s*ok\r?$/m.test(launched)) throw Error("ANDROID_AUTH_COLD_LAUNCH_FAILED");
  await openSession();
  return results;
}
