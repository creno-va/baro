import { describe, expect, test } from "bun:test";
import { createReworkClient, type OperationRequestOptions } from "@baro/api-client";
import { createSessionScope, type SessionView } from "@baro/client-core";
import { renderToString } from "react-dom/server";
import { ApiError } from "../src/client/api/errors";
import { v2ReworkVersionSchema } from "../src/contracts/v2";
import { CaseInputError } from "../src/product-ui/intake/CaseInputError";
import { CaseInputView } from "../src/product-ui/intake/CaseInputView";
import {
  createCaseInputController,
  narrativeLength,
  narrativeLengthError,
} from "../src/product-ui/intake/controller";
import type { CaseInputController } from "../src/product-ui/intake/useCaseInputController";
import { workspace } from "./fixtures/contracts/v2";

type Ports = Parameters<typeof createCaseInputController>[0];
const story = "  합성 계약 자료를 확인하고 당시 일을 정리하려고 합니다.  ";
const owner = {
  user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
  needsConsent: false,
} satisfies SessionView;
const other: SessionView = {
  user: { id: "synthetic-other", name: "다른 합성 사용자", accountType: "customer" },
  needsConsent: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function fixture(requireSession = true) {
  let session: SessionView = owner;
  let reads = 0;
  let read: Ports["getSession"] = async () => session;
  const writes: { input: Parameters<Ports["createCase"]>[0]; owner: string }[] = [];
  let write: Ports["createCase"] = async () => ({ id: "synthetic-case" });
  const navigation: string[] = [];
  const redirects: string[] = [];
  const controller = createCaseInputController({
    requireSession: () => requireSession,
    getSession: () => {
      reads++;
      return read();
    },
    createCase: (input, options) => {
      writes.push({ input, owner: options.expectedOwner });
      return write(input, options);
    },
    pathname: () => "/new",
    replace: (href) => redirects.push(href),
    assign: (href) => navigation.push(href),
  });
  controller.connect();
  return {
    controller,
    writes,
    navigation,
    redirects,
    reads: () => reads,
    setSession: (next: SessionView) => {
      session = next;
    },
    setRead: (next: Ports["getSession"]) => {
      read = next;
    },
    setWrite: (next: Ports["createCase"]) => {
      write = next;
    },
    ready: async () => {
      await controller.loadSession();
      controller.setNarrative(story);
    },
  };
}

describe("new case input lifecycle", () => {
  test("instances start deterministically and never share a private draft", async () => {
    const first = fixture();
    const second = fixture();
    expect(first.controller.getSnapshot()).toEqual(second.controller.getSnapshot());
    await first.ready();
    first.controller.setCasePurpose("respond_to_claim");
    expect(second.controller.getSnapshot()).toMatchObject({
      narrative: "",
      casePurpose: "prepare_claim",
      session: null,
      loading: true,
    });
  });

  test("the 10..5000 limit counts trimmed Unicode code points and never sends invalid input", async () => {
    expect(narrativeLength("  😀가\n  ")).toBe(2);
    expect(narrativeLengthError("😀".repeat(10))).toBe("");
    expect(narrativeLengthError("😀".repeat(5000))).toBe("");
    const f = fixture();
    await f.ready();
    for (const narrative of ["  😀".repeat(3), "😀".repeat(9), "😀".repeat(5001)]) {
      f.controller.setNarrative(narrative);
      await f.controller.create();
      expect(f.controller.getSnapshot().lengthError).not.toBe("");
      expect(f.controller.getSnapshot().narrative).toBe(narrative);
      f.controller.dismissLengthError();
      expect(f.controller.getSnapshot().lengthError).toBe("");
    }
    expect(f.writes).toHaveLength(0);
    expect(f.reads()).toBe(1);
  });

  test("busy submissions collapse to one owner-bound write and an ACK cannot be submitted again", async () => {
    const f = fixture();
    await f.ready();
    f.controller.setCasePurpose("respond_to_claim");
    const entered = deferred<void>();
    const ack = deferred<{ id: string }>();
    f.setWrite(() => {
      entered.resolve();
      return ack.promise;
    });
    const pending = f.controller.create();
    await entered.promise;
    await f.controller.create();
    expect(f.writes).toEqual([
      {
        input: {
          narrative: story.trim(),
          subjectContext: "individual",
          casePurpose: "respond_to_claim",
        },
        owner: owner.user?.id,
      },
    ]);
    expect(f.controller.getSnapshot().busy).toBe(true);
    ack.resolve({ id: "synthetic-case" });
    await pending;
    await f.controller.create();
    expect(f.writes).toHaveLength(1);
    expect(f.navigation).toEqual(["/cases/synthetic-case/intake"]);
    expect(f.controller.getSnapshot()).toMatchObject({ created: "synthetic-case", busy: false });
  });

  test("a changed owner during fresh authorization cancels the draft before any write", async () => {
    const f = fixture();
    await f.ready();
    const fresh = deferred<SessionView>();
    f.setRead(() => fresh.promise);
    const pending = f.controller.create();
    fresh.resolve(other);
    await pending;
    expect(f.writes).toHaveLength(0);
    expect(f.navigation).toHaveLength(0);
    expect(f.controller.getSnapshot()).toMatchObject({
      narrative: "",
      created: null,
      busy: false,
      session: other,
    });
  });

  test("an account switch discards a late creation ACK without restoring the old draft or route", async () => {
    const f = fixture();
    await f.ready();
    const entered = deferred<void>();
    const ack = deferred<{ id: string }>();
    f.setWrite(() => {
      entered.resolve();
      return ack.promise;
    });
    const pending = f.controller.create();
    await entered.promise;
    f.setSession(other);
    await f.controller.loadSession();
    ack.resolve({ id: "previous-owner-case" });
    await pending;
    expect(f.controller.getSnapshot()).toMatchObject({
      session: other,
      narrative: "",
      created: null,
      busy: false,
    });
    expect(f.navigation).toEqual([]);
  });

  test("role and consent identity changes clear the draft, while an existing lawyer can create", async () => {
    const f = fixture();
    await f.ready();
    const lawyer: SessionView = { ...owner, user: { ...owner.user, accountType: "lawyer" } };
    f.setSession(lawyer);
    await f.controller.loadSession();
    expect(f.controller.getSnapshot().narrative).toBe("");
    f.controller.setNarrative(story);
    await f.controller.create();
    expect(f.writes).toHaveLength(1);
    const consent = fixture();
    await consent.ready();
    consent.controller.setCasePurpose("respond_to_claim");
    consent.setSession({ ...owner, needsConsent: true });
    await consent.controller.loadSession();
    await consent.controller.create();
    expect(consent.controller.getSnapshot()).toMatchObject({
      narrative: "",
      casePurpose: "prepare_claim",
    });
    expect(consent.writes).toHaveLength(0);
    expect(consent.redirects).toEqual(["/consent?returnTo=%2Fnew"]);
  });

  test("out-of-order session responses cannot restore an earlier identity", async () => {
    const f = fixture();
    await f.ready();
    const old = deferred<SessionView>();
    f.setRead(() => old.promise);
    const pending = f.controller.loadSession();
    f.setRead(async () => other);
    await f.controller.loadSession();
    old.resolve(owner);
    expect(await pending).toBeNull();
    expect(f.controller.getSnapshot()).toMatchObject({
      session: other,
      narrative: "",
      loading: false,
    });
  });

  test("unmount fences both a pending session and a late creation response", async () => {
    const reading = fixture();
    const session = deferred<SessionView>();
    reading.setRead(() => session.promise);
    const pendingSession = reading.controller.loadSession();
    reading.controller.disconnect();
    session.resolve(owner);
    expect(await pendingSession).toBeNull();
    expect(reading.controller.getSnapshot().session).toBeNull();

    const writing = fixture();
    await writing.ready();
    const entered = deferred<void>();
    const ack = deferred<{ id: string }>();
    writing.setWrite(() => {
      entered.resolve();
      return ack.promise;
    });
    const pendingWrite = writing.controller.create();
    await entered.promise;
    writing.controller.disconnect();
    ack.resolve({ id: "late-case" });
    await pendingWrite;
    expect(writing.controller.getSnapshot().created).toBeNull();
    expect(writing.navigation).toEqual([]);
  });

  for (const peerTab of [false, true])
    test(`explicit ${peerTab ? "peer-tab" : "same-tab"} signout revokes pending reads immediately`, async () => {
      const f = fixture();
      await f.ready();
      const stale = deferred<SessionView>();
      f.setRead(() => stale.promise);
      const pending = f.controller.loadSession();
      const event = peerTab
        ? Object.assign(new Event("storage"), {
            key: "baro-session-changed",
            newValue: '{"reason":"signout"}',
          })
        : Object.assign(new Event("baro-session-changed"), { detail: { reason: "signout" } });
      f.controller.sessionChanged(event);
      expect(f.controller.getSnapshot()).toMatchObject({
        narrative: "",
        loading: false,
        session: { user: null, needsConsent: false },
      });
      stale.resolve(owner);
      expect(await pending).toBeNull();
      const before = f.reads();
      expect(await f.controller.loadSession()).toBeNull();
      expect(f.reads()).toBe(before);
      expect(f.redirects).toEqual(peerTab ? ["/login"] : []);
    });

  test("unavailable authorization preserves a hidden draft and retries only on explicit intent", async () => {
    const f = fixture();
    await f.ready();
    const unavailable = new ApiError("UNAVAILABLE", "합성 인증 장애", true);
    f.setRead(async () => {
      throw unavailable;
    });
    await f.controller.create();
    expect(f.writes).toHaveLength(0);
    expect(f.controller.getSnapshot()).toMatchObject({
      narrative: story,
      sessionError: unavailable,
      busy: false,
    });
    expect(f.reads()).toBe(2);
    f.setRead(async () => owner);
    await f.controller.loadSession();
    expect(f.controller.getSnapshot()).toMatchObject({ narrative: story, sessionError: null });
    await f.controller.create();
    expect(f.writes).toHaveLength(1);
  });

  test("unauthenticated session errors retain the required login destination", async () => {
    const f = fixture();
    f.setRead(async () => {
      throw new ApiError("UNAUTHENTICATED", "합성 만료");
    });
    await f.controller.loadSession();
    await f.controller.create();
    expect(f.writes).toHaveLength(0);
    expect(f.controller.getSnapshot()).toMatchObject({
      session: { user: null, needsConsent: false },
      sessionError: null,
      loading: false,
    });
    expect(f.redirects).toEqual(["/login?returnTo=%2Fnew"]);
  });

  test("explicit lost-response retry keeps the shared client's recovery key despite challenge rotation", async () => {
    const f = fixture();
    const keys: (string | undefined)[] = [];
    const tokens: unknown[] = [];
    let attempt = 0;
    let challenge = 0;
    const storage = new Map<string, string>();
    const client = createReworkClient({
      scope: createSessionScope(),
      session: async () => owner,
      challenge: async () => `synthetic-${++challenge}`,
      newKey: () => crypto.randomUUID(),
      fingerprint: async (value) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
      keyStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value);
        },
        removeItem: (key) => {
          storage.delete(key);
        },
      },
      request: async <T,>(
        _operation: string,
        input: unknown,
        options: OperationRequestOptions = {},
      ) => {
        keys.push(options.key);
        tokens.push((input as { turnstileToken: string }).turnstileToken);
        if (++attempt === 1) throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
        return {
          contractVersion: v2ReworkVersionSchema.value,
          workspace,
          context: {
            casePurpose: "prepare_claim",
            subjectContext: "individual",
            procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
          },
        } as T;
      },
    });
    f.setWrite((input, options) => client.createCase(input, options));
    await f.ready();
    await f.controller.create();
    expect(attempt).toBe(1);
    expect(f.controller.getSnapshot()).toMatchObject({
      narrative: story,
      created: null,
      busy: false,
    });
    expect(storage.size).toBe(1);
    expect(JSON.stringify([...storage])).not.toContain(story.trim());
    await f.controller.create();
    expect(attempt).toBe(2);
    expect(keys[0]).toBeDefined();
    expect(keys[1]).toBe(keys[0]);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(storage.size).toBe(0);
    expect(f.navigation).toEqual([`/cases/${workspace.id}/intake`]);
  });
});

function viewController(overrides: Partial<CaseInputController> = {}): CaseInputController {
  return {
    session: owner,
    loading: false,
    sessionError: null,
    narrative: "",
    casePurpose: "prepare_claim",
    busy: false,
    error: null,
    created: null,
    lengthError: "",
    narrativeRef: { current: null },
    count: 0,
    canCreate: true,
    submit: () => {},
    refresh: () => {},
    setNarrative: () => {},
    setCasePurpose: () => {},
    dismissLengthError: () => {},
    ...overrides,
  };
}

describe("new case input native view", () => {
  test("unresolved or unavailable required authorization never renders a private draft", () => {
    for (const override of [
      { loading: true },
      { canCreate: false },
      { sessionError: new ApiError("UNAVAILABLE", "합성 확인 실패", true) },
    ]) {
      const html = renderToString(
        <CaseInputView
          requireSession
          controller={viewController({ narrative: "private-synthetic-sentinel", ...override })}
        />,
      );
      expect(html).not.toContain("private-synthetic-sentinel");
      expect(html).not.toContain("<textarea");
      expect(html).not.toContain('type="submit"');
    }
  });

  test("the composer preserves a native labeled textarea, full Unicode capacity and submit semantics", () => {
    const narrative = '<img src=x onerror="synthetic()">\n😀한글';
    const html = renderToString(
      <CaseInputView
        requireSession
        controller={viewController({ narrative, count: narrativeLength(narrative) })}
      />,
    );
    expect(html).toContain('for="narrative"');
    expect(html).toContain('name="narrative"');
    expect(html).toContain(
      'aria-describedby="subject-context-help narrative-minimum narrative-count"',
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-label="저장하고 계속"');
    expect(html.replaceAll("<!-- -->", "")).toContain("10자 이상 입력해주세요");
    expect(html).toContain("&lt;img");
    expect(html).toContain("\n😀한글</textarea>");
    expect(html).not.toMatch(
      /maxLength=|contenteditable=|\sstyle=|<img\b|<[^>]+\son(?:keydown|keypress|submit|error)=/i,
    );
  });

  test("purpose selection exposes the matching three real examples and native radio state", () => {
    const prepare = renderToString(<CaseInputView requireSession controller={viewController()} />);
    expect(prepare).toContain("빌려준 돈을 못 받았어요");
    expect(prepare).toContain("보증금을 돌려받고 싶어요");
    expect(prepare).toContain("계약에 문제가 생겼어요");
    const response = renderToString(
      <CaseInputView
        requireSession
        controller={viewController({ casePurpose: "respond_to_claim" })}
      />,
    );
    expect(response).toMatch(/<input[^>]*checked=""[^>]*value="respond_to_claim"/);
    expect(response).toContain("돈을 갚으라는 연락을 받았어요");
    expect(response).toContain("고소했다는 연락을 받았어요");
    expect(response).toContain("계약 책임을 묻는 연락을 받았어요");
    expect(response).not.toContain("빌려준 돈을 못 받았어요");
    expect(response).toContain("상대방의 주장과 내가 기억하는 일을 적어주세요.");
  });

  test("busy state blocks all entry controls and completed ACK supplies a real recovery link", () => {
    const busy = renderToString(
      <CaseInputView requireSession controller={viewController({ busy: true })} />,
    );
    expect(busy).toMatch(/<fieldset[^>]*disabled=""/);
    expect(busy).toMatch(/<textarea[^>]*disabled=""/);
    expect(busy).toMatch(/<button[^>]*aria-busy="true"[^>]*disabled=""/);
    const saved = renderToString(
      <CaseInputView requireSession controller={viewController({ created: "saved-case" })} />,
    );
    expect(saved).toContain('href="/cases/saved-case/intake"');
    expect(saved).toContain("질문 이어가기");
    expect(saved).not.toContain('type="submit"');
  });

  test("public entry keeps consent/login links and native controls disabled", () => {
    for (const needsConsent of [false, true]) {
      const html = renderToString(
        <CaseInputView
          requireSession={false}
          controller={viewController({
            session: { user: needsConsent ? owner.user : null, needsConsent },
            canCreate: false,
          })}
        />,
      );
      expect(html).toContain(`href="/${needsConsent ? "consent" : "login"}"`);
      expect(html).toMatch(/<textarea[^>]*disabled=""/);
      expect(html).not.toContain('type="submit"');
    }
  });

  test("error actions preserve login, consent, explicit retry and conflict recovery semantics", () => {
    const cases = [
      [new ApiError("UNAUTHENTICATED", "합성 만료"), "로그인하기", 'href="/login"'],
      [new ApiError("CONSENT_REQUIRED", "합성 동의"), "동의 확인", 'href="/consent"'],
      [
        new ApiError("CONFLICT", "합성 충돌"),
        "최신 내용 불러오기",
        "다른 화면에서 저장한 내용이 있어요.",
      ],
      [new ApiError("UNAVAILABLE", "합성 장애", true), "다시 시도", 'type="button"'],
    ] as const;
    for (const [error, action, detail] of cases) {
      const html = renderToString(<CaseInputError error={error} retry={() => {}} />);
      expect(html).toContain(action);
      expect(html).toContain(detail);
    }
    expect(
      renderToString(
        <CaseInputError
          error={new ApiError("VALIDATION_ERROR", "합성 검증 실패")}
          retry={() => {}}
        />,
      ),
    ).not.toContain("다시 시도");
  });
});
