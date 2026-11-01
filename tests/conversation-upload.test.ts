import { expect, test } from "bun:test";
import type { FileView, WorkspaceView } from "../src/client/api/types";
import {
  beginConversationUpload,
  queuedConversationUpload,
} from "../src/components/workspace/conversation-upload";
import { conversationState } from "./helpers/conversation-state";

function fixture() {
  const state = conversationState();
  state.summaryConfirmed = true;
  const view: WorkspaceView = {
    case: {
      id: "synthetic-case",
      title: "합성 사건",
      subjectContext: "individual",
      stage: "active",
      revision: 8,
      updatedAt: "2026-11-01T00:00:00.000Z",
      summary: "합성 사실",
      schemaVersion: "2",
      summaryDetails: {
        schemaVersion: "2",
        revision: 2,
        intakeRevision: 3,
        createdAt: "2026-11-01T00:00:00.000Z",
        overview: "합성 사실",
        facts: [],
        parties: [],
        unknowns: ["미확인"],
        notices: ["합성"],
      },
    },
    messages: [],
    actions: [],
    timeline: [],
    files: [],
    facts: [],
    people: [],
    unknowns: ["미확인"],
    pagination: { messages: false, actions: false, timeline: false },
  };
  const queue = beginConversationUpload(view, view.case, state, 3, "원래 입력", []);
  if (!queue) throw new Error("Missing baseline");
  const ack: FileView = {
    id: "file",
    revision: 1,
    name: "합성.txt",
    mimeType: "text/plain",
    sizeBytes: 8,
    status: "processing",
    coverage: "처리 중",
    extractedText: "",
    uploadContentHash: "a".repeat(64),
  };
  queue.ids.push(ack.id);
  queue.files.set(ack.id, ack);
  const fresh = structuredClone(view),
    current = structuredClone(state);
  fresh.case.revision = 15;
  fresh.case.updatedAt = "2026-11-01T00:01:00.000Z";
  current.workspaceRevision = 15;
  fresh.files = [{ ...ack, revision: 2, status: "ready" }];
  return {
    view,
    state,
    queue,
    fresh,
    current,
    decide: () =>
      queuedConversationUpload(
        queue,
        fresh,
        fresh.case,
        current,
        3,
        "원래 입력",
        ["file"],
        new Set(["file"]),
        false,
      ),
  };
}
test("first upload admission tolerates only technical revisions with the same frozen semantic sources and acknowledged original", () => {
  const f = fixture();
  expect(f.decide()).toBe("ready");
  f.view.case.summaryDetails!.overview = "mutated old reference";
  expect(f.decide()).toBe("ready");
  f.current.analysis = { ...f.current.analysis, status: "running", currentJobId: "job" };
  expect(f.decide()).toBe("waiting");
});
test.each([
  "summary",
  "context",
  "message",
  "action",
  "timeline",
  "unknown",
  "other_file",
  "partial",
  "hash",
  "name",
  "size",
  "mime",
  "failure",
  "workspace",
  "confirmation",
])("changed %s source stops a queued first admission", (kind) => {
  const f = fixture();
  switch (kind) {
    case "summary":
      f.fresh.case.summaryDetails!.overview = "다른 정본";
      break;
    case "context":
      f.current.caseContext.procedure.description = "다른 설명";
      break;
    case "message":
      f.fresh.messages.push({
        id: "peer",
        role: "user",
        text: "다른 사실",
        status: "complete",
        createdAt: "2026-11-01T00:00:00.000Z",
      });
      break;
    case "action":
      f.fresh.actions.push({ id: "peer", title: "다른 행동", detail: "", done: false });
      break;
    case "timeline":
      f.fresh.timeline.push({ id: "peer", date: "", title: "다른 일정", detail: "" });
      break;
    case "unknown":
      f.fresh.unknowns = [];
      break;
    case "other_file":
      f.fresh.files.push({ ...f.fresh.files[0]!, id: "peer" });
      break;
    case "partial":
      f.fresh.pagination!.messages = true;
      break;
    case "hash":
      f.fresh.files[0]!.uploadContentHash = "b".repeat(64);
      break;
    case "name":
      f.fresh.files[0]!.name = "다른.txt";
      break;
    case "size":
      f.fresh.files[0]!.sizeBytes++;
      break;
    case "mime":
      f.fresh.files[0]!.mimeType = "application/pdf";
      break;
    case "failure":
      f.fresh.files[0]!.status = "failed";
      break;
    case "workspace":
      f.current.workspaceRevision++;
      break;
    case "confirmation":
      f.current.summaryConfirmed = false;
      break;
  }
  expect(f.decide()).toBe("changed");
});
test("already sent, different owner epoch/input/selection, incomplete original and edited ready files never rebase", () => {
  const f = fixture();
  const check = (
    epoch = 3,
    text = "원래 입력",
    ids = ["file"],
    processed = new Set(["file"]),
    attempted = false,
  ) =>
    queuedConversationUpload(
      f.queue,
      f.fresh,
      f.fresh.case,
      f.current,
      epoch,
      text,
      ids,
      processed,
      attempted,
    );
  expect(check(3, "원래 입력", ["file"], new Set(["file"]), true)).toBe("changed");
  expect(check(4)).toBe("changed");
  expect(check(3, "다른 입력")).toBe("changed");
  expect(check(3, "원래 입력", [])).toBe("changed");
  expect(check(3, "원래 입력", ["file"], new Set())).toBe("changed");
  f.queue.files.get("file")!.status = "ready";
  expect(check()).toBe("changed");
});
test("partial history or a missing canonical summary cannot establish an automatic queue baseline", () => {
  const f = fixture();
  f.view.pagination!.timeline = true;
  expect(beginConversationUpload(f.view, f.view.case, f.state, 3, "입력", [])).toBeNull();
  f.view.pagination!.timeline = false;
  delete f.view.case.summaryDetails;
  expect(beginConversationUpload(f.view, f.view.case, f.state, 3, "입력", [])).toBeNull();
});
