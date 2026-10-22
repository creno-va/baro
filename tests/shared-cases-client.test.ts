import { expect, test } from "bun:test";
import {
  ApiError,
  type CaseOperationStorage,
  createCasesClient,
  type OperationRequest,
  type OperationRequestOptions,
} from "@baro/api-client";
import { createSessionBoundClient, createSessionScope } from "@baro/client-core";

const id = "synthetic_case";
const narrative = "상담 준비를 위한 합성 사건입니다. 약속한 날짜가 지나도 대금을 받지 못했습니다.";
const input = { narrative, subjectContext: "individual" as const };
const workspace = (revision = 1, intakeRevision = 1) => ({
  schemaVersion: "2",
  id,
  title: "사건 작업 공간",
  subjectContext: "individual",
  jurisdiction: "KR",
  status: "intake",
  archivedFrom: null,
  workspaceRevision: revision,
  intakeRevision,
  confirmedSummaryRevision: null,
  currentJobId: null,
  legacySnapshotId: null,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
});
const metadata = (revision = 1) => ({
  schemaVersion: "2",
  revision,
  status: "collecting",
  narrative,
  batches: [],
  confirmedSummaryRevision: null,
  currentJobId: null,
  summary: null,
});
function memoryStorage() {
  const records = new Map<string, string>();
  const storage: CaseOperationStorage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => {
      records.set(key, value);
    },
    removeItem: (key) => {
      records.delete(key);
    },
  };
  return { records, storage };
}
async function fingerprint(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function client(
  request: OperationRequest,
  storage: CaseOperationStorage,
  scope = createSessionScope(),
  challenge: () => Promise<string> = async () => "synthetic-challenge",
) {
  return createCasesClient({
    request,
    storage,
    scope,
    mode: "real",
    persistence: "required",
    newKey: () => crypto.randomUUID(),
    fingerprint,
    challenge,
  });
}

test("an app restart replays a response-lost creation with the same key and no stored narrative", async () => {
  const { records, storage } = memoryStorage();
  const keys = new Set<string>();
  const attempts: { key: string; body: unknown }[] = [];
  let lost = true;
  const request: OperationRequest = async <T>(
    operation: string,
    _input?: unknown,
    options = {},
  ) => {
    if (operation === "cases.owner")
      return {
        user: { id: "synthetic_owner_a", accountType: "customer" },
        needsConsent: false,
      } as T;
    if (operation === "cases.intake") return metadata() as T;
    if (operation === "cases.create") {
      const requestOptions = options as { key: string; body: unknown };
      attempts.push(requestOptions);
      keys.add(requestOptions.key);
      if (lost) {
        lost = false;
        throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
      }
      return workspace() as T;
    }
    throw new Error("UNEXPECTED_TEST_OPERATION");
  };
  await expect(client(request, storage).create(input)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(records.size).toBe(1);
  expect(JSON.stringify([...records])).not.toContain(narrative);
  const recovered = await client(request, storage).create(input);
  expect(recovered.id).toBe(id);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]?.key).toBe(attempts[1]?.key);
  expect(attempts[0]?.body).toEqual(attempts[1]?.body);
  expect(keys.size).toBe(1);
  expect(records.size).toBe(0);
});

test("required persistence failure cannot reach challenge or case creation, including retry", async () => {
  let attempts = 0,
    challenges = 0;
  const request: OperationRequest = async <T>(operation: string) => {
    if (operation !== "cases.owner") attempts++;
    return { user: { id: "synthetic_owner_a", accountType: "customer" }, needsConsent: false } as T;
  };
  const storage: CaseOperationStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("synthetic full storage");
    },
    removeItem: () => {},
  };
  const cases = client(request, storage, createSessionScope(), async () => {
    challenges++;
    return "synthetic";
  });
  for (let attempt = 0; attempt < 2; attempt++)
    await expect(cases.create(input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(attempts).toBe(0);
  expect(challenges).toBe(0);
});

test("a failed durable wire write leaves no in-memory shortcut into the next attempt", async () => {
  const { records, storage } = memoryStorage();
  let failWire = true,
    writes = 0;
  const durable: CaseOperationStorage = {
    ...storage,
    setItem: (key, value) => {
      if (key.startsWith("baro-cases-wire:") && failWire) throw new Error("synthetic full storage");
      storage.setItem(key, value);
    },
  };
  const request: OperationRequest = async <T>(operation: string) => {
    if (operation === "cases.owner")
      return {
        user: { id: "synthetic_owner_a", accountType: "customer" },
        needsConsent: false,
      } as T;
    if (operation === "cases.workspace") return workspace(writes ? 4 : 3, writes ? 3 : 2) as T;
    if (operation === "cases.intake") return metadata(writes ? 3 : 2) as T;
    if (operation === "cases.latestJob") return null as T;
    if (operation === "cases.saveAnswers") {
      expect([...records.keys()].some((key) => key.startsWith("baro-cases-wire:"))).toBe(true);
      writes++;
      return metadata(3) as T;
    }
    throw new Error("UNEXPECTED_TEST_OPERATION");
  };
  const cases = client(request, durable);
  const answers = {
    expectedRevision: 3,
    answers: [{ questionId: "question_synthetic", state: "answered" as const, value: "합성 답변" }],
  };
  await expect(cases.saveAnswers(id, answers)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(writes).toBe(0);
  failWire = false;
  await cases.saveAnswers(id, answers);
  expect(writes).toBe(1);
  expect(JSON.stringify([...records])).not.toContain("합성 답변");
});

test("identity transitions reject late reads and prevent submission after a late challenge", async () => {
  const scope = createSessionScope();
  const { storage } = memoryStorage();
  let release!: (value: unknown) => void;
  const operations: string[] = [];
  let signal: AbortSignal | undefined;
  const read: OperationRequest = async <T>(
    operation: string,
    _input?: unknown,
    options?: OperationRequestOptions,
  ) => {
    operations.push(operation);
    signal = options?.signal;
    return new Promise<T>((resolve) => {
      release = (value) => resolve(value as T);
    });
  };
  const old = client(read, storage, scope).get(id);
  scope.transition("synthetic_owner_b");
  expect(signal?.aborted).toBe(true);
  release(workspace());
  await expect(old).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(operations).toEqual(["cases.workspace"]);

  const secondScope = createSessionScope();
  let challengeReady!: () => void, releaseChallenge!: (value: string) => void;
  const started = new Promise<void>((resolve) => {
    challengeReady = resolve;
  });
  const writes: string[] = [];
  const request: OperationRequest = async <T>(operation: string) => {
    writes.push(operation);
    return { user: { id: "synthetic_owner_a", accountType: "customer" }, needsConsent: false } as T;
  };
  const pending = client(request, storage, secondScope, () => {
    challengeReady();
    return new Promise((resolve) => {
      releaseChallenge = resolve;
    });
  }).create(input);
  await started;
  secondScope.invalidate();
  releaseChallenge("synthetic-late-token");
  await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(writes).toEqual(["cases.owner"]);
});

test("session-bound facade refreshes held method references and retries failed construction", async () => {
  const scope = createSessionScope();
  let factories = 0,
    fail = false;
  const api = createSessionBoundClient(scope, () => {
    if (fail) {
      fail = false;
      throw new Error("synthetic factory failure");
    }
    const instance = ++factories;
    return { get: async () => instance };
  });
  const held = api.get;
  expect(await held()).toBe(1);
  scope.invalidate();
  fail = true;
  expect(() => held()).toThrow("synthetic factory failure");
  expect(await held()).toBe(2);
  expect(factories).toBe(2);
});

test("parallel creation checks each owner before coalescing key persistence and challenge", async () => {
  const { storage } = memoryStorage();
  let creates = 0,
    challenges = 0,
    ownerReads = 0;
  const delayed: CaseOperationStorage = {
    ...storage,
    setItem: async (key, value) => {
      await Bun.sleep(5);
      await storage.setItem(key, value);
    },
  };
  const request: OperationRequest = async <T>(operation: string) => {
    if (operation === "cases.owner") {
      ownerReads++;
      return {
        user: { id: "synthetic_owner_a", accountType: "customer" },
        needsConsent: false,
      } as T;
    }
    if (operation === "cases.intake") return metadata() as T;
    if (operation === "cases.create") {
      creates++;
      return workspace() as T;
    }
    throw new Error("UNEXPECTED_TEST_OPERATION");
  };
  const cases = client(request, delayed, createSessionScope(), async () => {
    challenges++;
    return "synthetic";
  });
  const [one, two] = await Promise.all([cases.create(input), cases.create({ ...input })]);
  expect(one.id).toBe(two.id);
  expect(creates).toBe(1);
  expect(ownerReads).toBe(2);
  expect(challenges).toBe(1);
});

test("an unannounced owner switch cannot join a pending mutation for the previous owner's case", async () => {
  const { storage } = memoryStorage();
  let owner = "synthetic_owner_a";
  let reached!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request: OperationRequest = async <T>(operation: string) => {
    if (operation === "cases.intake") return metadata() as T;
    if (operation === "cases.workspace") {
      if (owner !== "synthetic_owner_a") throw new ApiError("NOT_FOUND", "합성 다른 계정의 사건");
      reached();
      await gate;
      throw new ApiError("UNAVAILABLE", "합성 이전 요청 종료", true);
    }
    throw new Error("UNEXPECTED_TEST_OPERATION");
  };
  const cases = client(request, storage);
  const old = cases.advance(id, { expectedRevision: 1 });
  void old.catch(() => {});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await started;
    owner = "synthetic_owner_b";
    await expect(
      Promise.race([
        cases.advance(id, { expectedRevision: 1 }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("OWNER_CHECK_NOT_REACHED")), 1000);
        }),
      ]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    clearTimeout(timeout);
    release();
    await old.catch(() => {});
  }
});

test("a cached key cannot bypass required storage after the device store becomes unavailable", async () => {
  const { storage } = memoryStorage();
  let locked = false,
    reads = 0,
    creates = 0;
  const durable: CaseOperationStorage = {
    ...storage,
    getItem: (key) => {
      reads++;
      if (locked) throw new Error("synthetic locked store");
      return storage.getItem(key);
    },
  };
  const request: OperationRequest = async <T>(operation: string) => {
    if (operation === "cases.owner")
      return {
        user: { id: "synthetic_owner_a", accountType: "customer" },
        needsConsent: false,
      } as T;
    creates++;
    throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
  };
  const cases = client(request, durable);
  await expect(cases.create(input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  locked = true;
  await expect(cases.create(input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(reads).toBe(2);
  expect(creates).toBe(1);
});

test("durable keys are owner-bound while an unresolved original owner request stays recoverable", async () => {
  const { records, storage } = memoryStorage();
  const scope = createSessionScope();
  let owner = "synthetic_owner_a",
    lost = true;
  const keys: { owner: string; key: string }[] = [];
  const request: OperationRequest = async <T>(
    operation: string,
    _input?: unknown,
    options = {},
  ) => {
    if (operation === "cases.owner")
      return { user: { id: owner, accountType: "customer" }, needsConsent: false } as T;
    if (operation === "cases.intake") return metadata() as T;
    if (operation === "cases.create") {
      keys.push({ owner, key: (options as { key: string }).key });
      if (lost) {
        lost = false;
        throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
      }
      return workspace() as T;
    }
    throw new Error("UNEXPECTED_TEST_OPERATION");
  };
  await expect(client(request, storage, scope).create(input)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  owner = "synthetic_owner_b";
  scope.transition(owner);
  await client(request, storage, scope).create(input);
  expect(keys[0]?.key).not.toBe(keys[1]?.key);
  expect(records.size).toBe(1);
  owner = "synthetic_owner_a";
  scope.transition(owner);
  await client(request, storage, scope).create(input);
  expect(keys[2]?.key).toBe(keys[0]?.key);
  expect(records.size).toBe(0);
});

test("a misconfigured fingerprint port cannot persist editor text", async () => {
  const { records, storage } = memoryStorage();
  let writes = 0;
  const request: OperationRequest = async <T>(operation: string) => {
    if (operation !== "cases.owner") writes++;
    return { user: { id: "synthetic_owner_a", accountType: "customer" }, needsConsent: false } as T;
  };
  const cases = createCasesClient({
    request,
    mode: "real",
    scope: createSessionScope(),
    persistence: "required",
    storage,
    newKey: () => crypto.randomUUID(),
    fingerprint: async () => narrative,
    challenge: async () => "synthetic",
  });
  await expect(cases.create(input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(records.size).toBe(0);
  expect(writes).toBe(0);
});

test("closing a feature cancels its instance without changing the session or making a request", async () => {
  const { storage } = memoryStorage();
  const scope = createSessionScope(),
    controller = new AbortController();
  let calls = 0;
  const request: OperationRequest = async <T>() => {
    calls++;
    return null as T;
  };
  const cases = createCasesClient({
    request,
    mode: "real",
    scope,
    signal: controller.signal,
    persistence: "required",
    storage,
    newKey: () => crypto.randomUUID(),
    fingerprint,
    challenge: async () => "synthetic",
  });
  const reason = new Error("synthetic closed feature");
  controller.abort(reason);
  await expect(cases.get(id)).rejects.toBe(reason);
  expect(scope.snapshot()).toBe(0);
  expect(calls).toBe(0);
});
