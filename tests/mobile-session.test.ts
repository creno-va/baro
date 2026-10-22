import { expect, test } from "bun:test";
import { createSessionScope } from "@baro/client-core";
import { CURRENT_POLICY_VERSIONS } from "@baro/contracts/consent";
import type { ClientSession } from "@baro/contracts/session";
import { createSessionModel } from "../apps/mobile/src/features/session/model";
import { bindSessionLifecycle } from "../apps/mobile/src/platform/auth/lifecycle";
import { createAuthReturnQueue } from "../apps/mobile/src/platform/auth/return-queue";

const anonymous: ClientSession = { user: null, needsConsent: false };
const owner = (id: string, needsConsent = false): ClientSession => ({
  user: { id, name: `합성 ${id}`, accountType: "customer" },
  needsConsent,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(initial = anonymous) {
  let session = initial,
    reads = 0,
    saves = 0;
  const scope = createSessionScope();
  const dependencies: Parameters<typeof createSessionModel>[0] = {
    scope,
    readSession: async () => {
      reads++;
      return session;
    },
    getConsent: async () => ({
      required: { ...CURRENT_POLICY_VERSIONS },
      consent: null,
      needsConsent: true,
    }),
    saveConsent: async () => {
      saves++;
      session = { ...session, needsConsent: false };
    },
    login: {
      start: async (_provider, role) => {
        session = { user: { id: "new", name: "합성", accountType: role }, needsConsent: false };
        return { type: "verified", session };
      },
      complete: async () => {
        session = owner("returned");
        return { type: "verified", session };
      },
      cancel: async () => {
        session = anonymous;
        scope.invalidate();
      },
    },
    ownsReturn: async () => true,
    signOut: async () => {
      session = anonymous;
      return { serverRevoked: true };
    },
    openPolicy: async () => {},
  };
  return {
    scope,
    dependencies,
    setSession: (value: ClientSession) => {
      session = value;
    },
    stats: () => ({ reads, saves }),
  };
}
test("anonymous role selection invokes login and consent is not inferred from a selected role", async () => {
  const f = fixture(),
    model = createSessionModel(f.dependencies);
  await model.refresh();
  expect(model.getSnapshot().phase).toBe("anonymous");
  model.selectRole("lawyer");
  await model.signIn("naver");
  expect(model.getSnapshot()).toMatchObject({
    phase: "ready",
    role: "lawyer",
    session: { user: { id: "new" } },
  });
});

test("both policy and age confirmation plus the actual owner's readback are required to leave consent", async () => {
  const f = fixture(owner("a", true)),
    model = createSessionModel(f.dependencies);
  await model.refresh();
  expect(model.getSnapshot().phase).toBe("consent");
  await model.acceptConsent({ policies: false, over14: true });
  await model.acceptConsent({ policies: true, over14: false });
  expect(f.stats().saves).toBe(0);
  await model.acceptConsent({ policies: true, over14: true });
  expect(f.stats().saves).toBe(1);
  expect(model.getSnapshot().phase).toBe("ready");
  const g = fixture(owner("a", true));
  const swapped = createSessionModel(g.dependencies);
  await swapped.refresh();
  g.dependencies.saveConsent = async () => {
    g.setSession(owner("b"));
  };
  await swapped.acceptConsent({ policies: true, over14: true });
  expect(swapped.getSnapshot()).toMatchObject({ phase: "error", session: null });
});

test("policy versions unknown to the installed app cannot be silently accepted", async () => {
  const f = fixture(owner("a", true));
  f.dependencies.getConsent = async () => ({
    required: { ...CURRENT_POLICY_VERSIONS, termsVersion: "synthetic-new-version" },
    consent: null,
    needsConsent: true,
  });
  const model = createSessionModel(f.dependencies);
  await model.refresh();
  await model.acceptConsent({ policies: true, over14: true });
  expect(f.stats().saves).toBe(0);
  expect(model.getSnapshot().phase).toBe("consent");
  expect(model.getSnapshot().error).toContain("업데이트");
});

test("foreground revalidation hides private state and rejects the previous foreground's late response", async () => {
  const f = fixture(),
    late = deferred<ClientSession>();
  let calls = 0;
  f.dependencies.readSession = () => (++calls === 1 ? late.promise : Promise.resolve(owner("b")));
  const model = createSessionModel(f.dependencies);
  const first = model.refresh();
  const signal = f.scope.signal();
  model.pause();
  expect(signal.aborted).toBe(true);
  expect(model.getSnapshot().session).toBeNull();
  await model.resume();
  late.resolve(owner("a"));
  await first;
  expect(model.getSnapshot().session?.user?.id).toBe("b");
});

test("background browser work stays alive but cannot publish private readiness before foreground verification", async () => {
  const f = fixture(),
    gate = deferred<ClientSession>();
  f.dependencies.login.start = async () => ({ type: "verified", session: await gate.promise });
  const model = createSessionModel(f.dependencies);
  await model.refresh();
  const login = model.signIn("google");
  model.pause();
  await model.resume();
  expect(f.stats().reads).toBe(1);
  model.pause();
  f.setSession(owner("a"));
  gate.resolve(owner("a"));
  await login;
  expect(model.getSnapshot()).toMatchObject({ phase: "checking", session: null, busy: false });
  await model.resume();
  expect(model.getSnapshot()).toMatchObject({ phase: "ready", session: { user: { id: "a" } } });
});

test("cold return ownership lookup wins over startup refresh and lifecycle cleanup removes listeners", async () => {
  const f = fixture(),
    gate = deferred<boolean>(),
    finished = deferred<void>();
  f.dependencies.ownsReturn = () => gate.promise;
  const model = createSessionModel(f.dependencies),
    queue = createAuthReturnQueue();
  let listeners = 0;
  queue.push("synthetic-validated-return");
  const unsubscribe = model.subscribe(() => {
    if (model.getSnapshot().session?.user?.id === "returned") finished.resolve();
  });
  const stop = bindSessionLifecycle({
    model,
    returns: queue,
    currentState: () => "active",
    subscribe: () => {
      listeners++;
      return () => {
        listeners--;
      };
    },
  });
  expect(f.stats().reads).toBe(0);
  gate.resolve(true);
  await finished.promise;
  expect(model.getSnapshot().session?.user?.id).toBe("returned");
  stop();
  unsubscribe();
  expect(listeners).toBe(0);
  expect(model.getSnapshot().session).toBeNull();
});

test("logout hides the owner immediately, ignores late returns and never claims failed local clearing succeeded", async () => {
  const f = fixture(owner("a")),
    gate = deferred<{ serverRevoked: boolean }>();
  f.dependencies.signOut = () => gate.promise;
  const model = createSessionModel(f.dependencies);
  await model.refresh();
  const pending = model.signOut();
  expect(model.getSnapshot()).toMatchObject({ phase: "checking", session: null });
  await model.receiveReturn("synthetic-old-return");
  gate.resolve({ serverRevoked: false });
  await pending;
  expect(model.getSnapshot()).toMatchObject({ phase: "anonymous", session: null });
  expect(model.getSnapshot().error).toContain("서버 연결");
  const failed = fixture(owner("a"));
  failed.dependencies.signOut = async () => {
    throw new Error("SYNTHETIC_PRIVATE_STORAGE");
  };
  const closed = createSessionModel(failed.dependencies);
  await closed.refresh();
  await closed.signOut();
  expect(closed.getSnapshot()).toMatchObject({ phase: "error", session: null });
  expect(closed.getSnapshot().error).not.toContain("SYNTHETIC_PRIVATE_STORAGE");
});

test("cancellation retires an in-flight login result and policy link failures remain safe and actionable", async () => {
  const f = fixture(),
    gate = deferred<ClientSession>();
  f.dependencies.login.start = async () => ({ type: "verified", session: await gate.promise });
  f.dependencies.openPolicy = async () => {
    throw new Error("SYNTHETIC_PRIVATE_LINK_DETAIL");
  };
  const model = createSessionModel(f.dependencies);
  await model.refresh();
  const login = model.signIn("kakao");
  await model.cancelLogin();
  gate.resolve(owner("late"));
  await login;
  expect(model.getSnapshot()).toMatchObject({ phase: "anonymous", session: { user: null } });
  await model.openPolicy("privacy");
  expect(model.getSnapshot().error).toContain("다시 시도");
  expect(model.getSnapshot().error).not.toContain("SYNTHETIC_PRIVATE_LINK_DETAIL");
});

test("opening the system browser retires private work once without aborting its current auth exchange", async () => {
  const f = fixture(owner("a")),
    gate = deferred<ClientSession>();
  f.dependencies.login.start = async () => ({ type: "verified", session: await gate.promise });
  const model = createSessionModel(f.dependencies);
  await model.refresh();
  const old = f.scope.signal();
  const login = model.signIn("google");
  expect(old.aborted).toBe(true);
  const auth = f.scope.signal();
  model.pause();
  expect(auth.aborted).toBe(false);
  await model.resume();
  gate.resolve(owner("b"));
  await login;
  expect(model.getSnapshot().session?.user?.id).toBe("b");
});
