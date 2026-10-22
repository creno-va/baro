import { expect, test } from "bun:test";
import { ApiError, type WorkspaceAcknowledgement } from "@baro/api-client";
import type { WorkspaceView } from "@baro/client-core";
import type { SessionState } from "../apps/mobile/src/features/session/model";
import { createWorkspaceModel } from "../apps/mobile/src/features/workspace/model";

const owner = (id = "a"): SessionState => ({
  phase: "ready",
  busy: false,
  role: "customer",
  session: { user: { id, name: "합성 계정", accountType: "customer" }, needsConsent: false },
  consent: null,
  error: null,
});
export const workspaceFixture = (): WorkspaceView => ({
  case: {
    id: "case_a",
    title: "합성 사건",
    schemaVersion: "2",
    subjectContext: "individual",
    stage: "active",
    revision: 7,
    updatedAt: "2026-10-22T00:00:00.000Z",
    summary: "합성 요약",
    summaryNeedsConfirmation: false,
  },
  messages: [],
  actions: [{ id: "action_a", revision: 3, title: "준비", detail: "합성 안내", done: false }],
  timeline: [],
  files: [
    {
      id: "file_a",
      name: "합성 자료",
      mimeType: "text/plain",
      sizeBytes: 12,
      status: "ready",
      extractedText: "",
      coverage: "범위 검토 필요",
    },
  ],
  pagination: { messages: true, actions: false, timeline: false },
});
async function settled() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function fixture() {
  let session = owner(),
    value = workspaceFixture(),
    ack: (r: WorkspaceAcknowledgement) => void = () => {},
    failure: unknown,
    beforeAck: Promise<void> | undefined,
    readDelay: Promise<void> | undefined,
    shouldAck = true,
    reads = 0,
    sessionRefreshes = 0;
  let poll: (() => void) | undefined;
  const listeners = new Set<() => void>(),
    calls: unknown[] = [],
    signals: AbortSignal[] = [];
  const get = async () => {
    reads++;
    const result = structuredClone(value);
    await readDelay;
    return result;
  };
  const write = async (kind: WorkspaceAcknowledgement["kind"], input: unknown) => {
    calls.push(structuredClone(input));
    const capturedAck = ack;
    await beforeAck;
    if (shouldAck) capturedAck({ kind, caseId: value.case.id });
    if (failure) throw failure;
    return structuredClone(value);
  };
  const model = createWorkspaceModel({
    caseId: "case_a",
    session: {
      getSnapshot: () => session,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      refresh: async () => {
        sessionRefreshes++;
      },
    },
    schedule(callback) {
      poll = callback;
      return () => {
        poll = undefined;
      };
    },
    createClient(signal, _owner, acknowledged) {
      signals.push(signal);
      ack = acknowledged;
      return {
        get,
        sendMessage: async (_id, input) => write("message", input),
        retryMessage: async (_id, messageId, revision) => write("retry", { messageId, revision }),
        setAction: async (_id, actionId, done, revision) =>
          write("action", { actionId, done, revision }),
        saveTimeline: async (_id, entry) => write("timeline", entry),
        loadMore: async (_id, collection) => {
          calls.push(collection);
          return get();
        },
      };
    },
  });
  const stop = model.start();
  return {
    model,
    stop,
    calls,
    signals,
    setSession(next: SessionState) {
      session = next;
      for (const listener of listeners) listener();
    },
    setValue(next: WorkspaceView) {
      value = next;
    },
    value: () => value,
    fail(cause: unknown, acknowledged = false) {
      failure = cause;
      shouldAck = acknowledged;
    },
    holdRead(delay?: Promise<void>) {
      readDelay = delay;
    },
    holdWrite(delay: Promise<void>) {
      beforeAck = delay;
    },
    poll: () => poll,
    reads: () => reads,
    refreshes: () => sessionRefreshes,
  };
}
test("lost ACK retains the original message revision and selection across read/foreground recreation; replay never uses the newer snapshot", async () => {
  const f = fixture();
  await settled();
  f.model.setText("합성 비공개 내용");
  f.model.selectFile("file_a");
  f.fail(new ApiError("UNAVAILABLE", "합성 응답 유실"));
  await f.model.send();
  expect(f.model.getSnapshot().pending?.kind).toBe("message");
  f.model.setText("원래 입력을 덮어쓰면 안 됨");
  f.setValue({ ...f.value(), case: { ...f.value().case, revision: 8 } });
  f.setSession({ ...owner(), phase: "checking" });
  expect(f.signals[0]?.aborted).toBe(true);
  expect(f.model.getSnapshot().text).toBe("");
  f.setSession(owner());
  await settled();
  expect(f.model.getSnapshot().value?.case.revision).toBe(8);
  await f.model.replay();
  expect(f.calls).toEqual([
    { text: "합성 비공개 내용", selectedFileIds: ["file_a"], expectedRevision: 7 },
    { text: "합성 비공개 내용", selectedFileIds: ["file_a"], expectedRevision: 7 },
  ]);
  f.stop();
});
test("accepted message clears its editor before failed projection read; it cannot be resent as a new operation", async () => {
  const f = fixture();
  await settled();
  f.model.setText("합성 내용");
  f.fail(new ApiError("UNAVAILABLE", "합성 조회 실패"), true);
  await f.model.send();
  expect(f.model.getSnapshot()).toMatchObject({
    text: "",
    selectedFileIds: [],
    pending: null,
    busy: false,
  });
  await f.model.send();
  await f.model.replay();
  expect(f.calls).toHaveLength(1);
  f.stop();
});
test("account change hides private drafts and ignores old acknowledgement/results even if abort is ignored", async () => {
  const f = fixture();
  await settled();
  f.model.setText("A 계정 비공개 내용");
  let release = () => {};
  f.holdWrite(
    new Promise<void>((done) => {
      release = done;
    }),
  );
  const writing = f.model.send();
  await settled();
  f.setSession(owner("b"));
  await settled();
  f.model.setText("B 계정 입력");
  release();
  await writing;
  expect(f.model.getSnapshot().text).toBe("B 계정 입력");
  expect(f.model.getSnapshot().pending).toBeNull();
  f.setSession(owner());
  await settled();
  expect(f.model.getSnapshot().text).toBe("");
  f.stop();
});
test("background/consent retires reads and polling; same owner may restore drafts only after fresh access", async () => {
  const f = fixture();
  await settled();
  f.model.setText("보관할 메모리 입력");
  f.setValue({
    ...f.value(),
    messages: [
      {
        id: "job:a",
        role: "assistant",
        text: "처리 중",
        status: "pending",
        createdAt: "2026-10-22T00:00:00Z",
      },
    ],
  });
  await f.model.refresh();
  expect(f.poll()).toBeDefined();
  f.setSession({ ...owner(), phase: "consent" });
  expect(f.poll()).toBeUndefined();
  expect(f.model.getSnapshot().value).toBeNull();
  f.setSession(owner());
  await settled();
  expect(f.model.getSnapshot().text).toBe("보관할 메모리 입력");
  f.stop();
  expect(f.poll()).toBeUndefined();
  expect(f.model.getSnapshot().value).toBeNull();
});
test("owner denial hides content and requests fresh session; 404 removes deleted selected case", async () => {
  const f = fixture();
  await settled();
  f.model.setText("합성 입력");
  f.fail(new ApiError("UNAUTHENTICATED", "계정 변경"));
  await f.model.send();
  expect(f.refreshes()).toBe(1);
  expect(f.model.getSnapshot().value).toBeNull();
  f.setSession(owner());
  await settled();
  f.fail(new ApiError("NOT_FOUND", "삭제됨"));
  await f.model.replay();
  expect(f.model.getSnapshot()).toMatchObject({ value: null, pending: null, text: "" });
  f.stop();
});
test("native action retry preserves entity revision and explicit done intent after a newer projection", async () => {
  const f = fixture();
  await settled();
  const action = f.value().actions[0];
  if (!action) throw new Error("FIXTURE");
  f.fail(new ApiError("UNAVAILABLE", "합성 응답 유실"));
  await f.model.setAction(action);
  f.setValue({ ...f.value(), actions: [{ ...action, revision: 4, done: true }] });
  await f.model.refresh();
  await f.model.replay();
  expect(f.calls).toEqual([
    { actionId: "action_a", done: true, revision: 3 },
    { actionId: "action_a", done: true, revision: 3 },
  ]);
  f.stop();
});
test("timeline dates validate through shared schema and conflict preserves edits until explicit discard", async () => {
  const f = fixture();
  await settled();
  f.model.editTimeline();
  f.model.changeTimeline({ title: "합성 일정", date: "2026-02-31", datePrecision: "day" });
  await f.model.saveTimeline();
  expect(f.calls).toHaveLength(0);
  f.model.changeTimeline({ date: "", datePrecision: "unknown" });
  f.fail(new ApiError("CONFLICT", "다른 변경"));
  await f.model.saveTimeline();
  expect(f.model.getSnapshot().timeline?.title).toBe("합성 일정");
  expect(f.model.getSnapshot().conflict).toBe(true);
  await f.model.replay();
  expect(f.calls).toHaveLength(1);
  await f.model.refresh(true);
  expect(f.model.getSnapshot()).toMatchObject({ timeline: null, pending: null, conflict: false });
  f.stop();
});
test("an accepted timeline clears its editor on failed readback; pending summary prevents another message", async () => {
  const f = fixture();
  await settled();
  f.model.editTimeline();
  f.model.changeTimeline({ title: "합성 일정" });
  f.fail(new ApiError("UNAVAILABLE", "합성 읽기 실패"), true);
  await f.model.saveTimeline();
  expect(f.model.getSnapshot()).toMatchObject({ timeline: null, pending: null });
  f.setValue({ ...f.value(), case: { ...f.value().case, summaryNeedsConfirmation: true } });
  await f.model.refresh();
  f.model.setText("요약 확인 전");
  await f.model.send();
  expect(f.calls).toHaveLength(1);
  f.stop();
});
test("late read after cancellation cannot overwrite a newer request; stop retires all signals", async () => {
  const f = fixture();
  await settled();
  let release = () => {};
  f.holdRead(
    new Promise<void>((done) => {
      release = done;
    }),
  );
  const reading = f.model.refresh();
  await settled();
  f.model.cancel();
  f.holdRead();
  f.setValue({ ...f.value(), case: { ...f.value().case, revision: 9 } });
  await f.model.refresh();
  release();
  await reading;
  expect(f.model.getSnapshot().value?.case.revision).toBe(9);
  f.stop();
  expect(f.signals.every((signal) => signal.aborted)).toBe(true);
});
test("retry is explicit, captures workspace revision and ignores nonretryable failures; pagination uses the shared continuation", async () => {
  const f = fixture();
  await settled();
  f.setValue({
    ...f.value(),
    messages: [
      {
        id: "job:a",
        role: "assistant",
        text: "실패",
        status: "failed",
        retryable: true,
        createdAt: "2026-10-22T00:00:00Z",
      },
    ],
  });
  await f.model.refresh();
  expect(f.poll()).toBeUndefined();
  await f.model.retry("unknown");
  await f.model.retry("job:a");
  expect(f.calls[0]).toEqual({ messageId: "job:a", revision: 7 });
  await f.model.more("messages");
  expect(f.calls[1]).toBe("messages");
  f.stop();
});
test("archived workspace remains readable and cannot open an editor or toggle actions", async () => {
  const f = fixture();
  await settled();
  f.setValue({ ...f.value(), case: { ...f.value().case, stage: "archived" } });
  await f.model.refresh();
  f.model.editTimeline();
  expect(f.model.getSnapshot().timeline).toBeNull();
  const action = f.value().actions[0];
  if (!action) throw new Error("FIXTURE");
  await f.model.setAction(action);
  expect(f.calls).toHaveLength(0);
  expect(f.model.getSnapshot().value?.case.stage).toBe("archived");
  f.stop();
});
test("blur discards unwatched drafts so an intervening logout and same-owner login cannot revive them", async () => {
  const f = fixture();
  await settled();
  f.model.setText("로그아웃 전에 입력한 합성 비공개 내용");
  f.stop();
  f.setSession({ ...owner(), phase: "anonymous", session: null });
  f.setSession(owner());
  const stop = f.model.start();
  await settled();
  expect(f.model.getSnapshot().text).toBe("");
  expect(f.model.getSnapshot().pending).toBeNull();
  stop();
});
