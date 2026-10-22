import { ApiError } from "@baro/api-client";
import type { SessionScope } from "@baro/client-core";
import {
  MOBILE_CHALLENGE_PATH,
  MOBILE_CHALLENGE_TIMEOUT_MS,
  mobileChallengeAttemptSchema,
  mobileChallengeMessageSchema,
  mobileChallengeReadySchema,
  mobileChallengeSecretSchema,
} from "@baro/contracts/mobile-challenge";
import type { MobileConfig } from "../../../config/environment";

export type ChallengeState =
  | { kind: "idle" }
  | { kind: "preparing"; attemptId: string }
  | { kind: "active"; attemptId: string; uri: string };
const failed = () =>
  new ApiError(
    "VALIDATION_ERROR",
    "보안 확인이 끝나지 않았어요. 입력은 유지했으니 다시 시도해 주세요.",
    true,
  );
const unavailable = () =>
  new ApiError("UNAVAILABLE", "보안 확인을 불러오지 못했어요. 입력은 유지돼요.", true);
const foreign = () =>
  new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");

export function createChallengeModel(dependencies: {
  config: MobileConfig;
  scope: SessionScope;
  newId: () => string;
  newSecret: () => Promise<string>;
  schedule?: (callback: () => void, ms: number) => () => void;
}) {
  let state: ChallengeState = { kind: "idle" };
  const subscribers = new Set<() => void>();
  let active:
    | {
        id: string;
        uri: string;
        secret?: string;
        generation: number;
        signal: AbortSignal;
        top: string | null;
        loaded: boolean;
        connected: boolean;
        finish: (token?: string, error?: ApiError) => void;
      }
    | undefined;
  const publish = (next: ChallengeState) => {
    state = next;
    for (const notify of subscribers) notify();
  };
  const schedule =
    dependencies.schedule ??
    ((callback, ms) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
  const attempt = (id: string) => {
    const current = active;
    if (!current || current.id !== id) return;
    if (!dependencies.scope.isCurrent(current.generation) || current.signal.aborted) {
      current.finish(undefined, foreign());
      return;
    }
    return current;
  };
  const messageSource = (url: string, uri: string) => {
    try {
      const source = new URL(url),
        expected = new URL(uri);
      return (
        !source.username &&
        !source.password &&
        !source.hash &&
        source.origin === expected.origin &&
        (source.href === expected.href || (source.pathname === "/" && !source.search))
      );
    } catch {
      return false;
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(notify: () => void) {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    request(signal?: AbortSignal): Promise<string> {
      if (active)
        return Promise.reject(
          new ApiError("UNAVAILABLE", "진행 중인 보안 확인을 먼저 마쳐 주세요.", true),
        );
      const combined = signal
        ? AbortSignal.any([signal, dependencies.scope.signal()])
        : dependencies.scope.signal();
      if (combined.aborted) return Promise.reject(foreign());
      let id: string;
      try {
        id = mobileChallengeAttemptSchema.parse(dependencies.newId());
      } catch {
        return Promise.reject(unavailable());
      }
      const source = new URL(MOBILE_CHALLENGE_PATH, dependencies.config.apiBaseUrl);
      source.searchParams.set("attemptId", id);
      return new Promise<string>((resolve, reject) => {
        let cancelTimer: (() => void) | undefined;
        const abort = () => current.finish(undefined, foreign());
        const current: NonNullable<typeof active> = {
          id,
          uri: source.href,
          generation: dependencies.scope.snapshot(),
          signal: combined,
          top: null,
          loaded: false,
          connected: false,
          finish(token, error) {
            if (active !== current) return;
            active = undefined;
            delete current.secret;
            cancelTimer?.();
            combined.removeEventListener("abort", abort);
            publish({ kind: "idle" });
            if (token) resolve(token);
            else reject(error ?? failed());
          },
        };
        active = current;
        combined.addEventListener("abort", abort, { once: true });
        cancelTimer = schedule(
          () => current.finish(undefined, failed()),
          MOBILE_CHALLENGE_TIMEOUT_MS,
        );
        if (combined.aborted) {
          abort();
          return;
        }
        publish({ kind: "preparing", attemptId: id });
        void dependencies
          .newSecret()
          .then((secret) => {
            if (active !== current || !attempt(id)) return;
            const parsed = mobileChallengeSecretSchema.safeParse(secret);
            if (!parsed.success) {
              current.finish(undefined, unavailable());
              return;
            }
            current.secret = parsed.data;
            publish({ kind: "active", attemptId: id, uri: current.uri });
          })
          .catch(() => current.finish(undefined, unavailable()));
      });
    },
    cancel(id?: string) {
      if (active && (!id || active.id === id)) active.finish();
    },
    load(id: string, url: string) {
      const current = attempt(id);
      if (!current) return;
      if (url === "about:blank" && !current.loaded) return;
      if (url !== current.uri) {
        current.finish(undefined, unavailable());
        return;
      }
      current.top = url;
      current.loaded = true;
    },
    allowNavigation(id: string, request: { url: string; isTopFrame?: boolean }) {
      const current = attempt(id);
      if (!current) return false;
      if (request.url === current.uri) return true;
      if (request.isTopFrame === true) return request.url === "about:blank" && !current.loaded;
      if (["about:blank", "about:srcdoc"].includes(request.url)) return true;
      try {
        const url = new URL(request.url);
        return (
          url.origin === "https://challenges.cloudflare.com" &&
          !url.username &&
          !url.password &&
          !url.hash
        );
      } catch {
        return false;
      }
    },
    connectScript(id: string) {
      const current = attempt(id);
      if (!current?.secret || current.top !== current.uri) return "true;";
      // Never give a newly navigated frame this secret, even if Android omits
      // isTopFrame or reports the top URL for an iframe's bridge message.
      return `if(window.location.href===${JSON.stringify(current.uri)}){window.__baroChallengeConnect?.(${JSON.stringify(current.secret)});}true;`;
    },
    message(id: string, url: string, data: string): "connect" | "ignore" {
      const current = attempt(id);
      if (
        !current ||
        current.top !== current.uri ||
        !messageSource(url, current.uri) ||
        data.length > 4096
      )
        return "ignore";
      let value: unknown;
      try {
        value = JSON.parse(data);
      } catch {
        return "ignore";
      }
      const ready = mobileChallengeReadySchema.safeParse(value);
      if (ready.success && ready.data.attemptId === id && !current.connected) {
        current.connected = true;
        return "connect";
      }
      const parsed = mobileChallengeMessageSchema.safeParse(value);
      if (!parsed.success || parsed.data.attemptId !== id || parsed.data.secret !== current.secret)
        return "ignore";
      if (parsed.data.type === "token") current.finish(parsed.data.token);
      else
        current.finish(undefined, parsed.data.reason === "unavailable" ? unavailable() : failed());
      return "ignore";
    },
    failed(id: string) {
      attempt(id)?.finish(undefined, unavailable());
    },
  };
}
export type ChallengeModel = ReturnType<typeof createChallengeModel>;
