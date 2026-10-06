import { expect, test } from "bun:test";
import { createAccountClient } from "../src/client/api/account";
import { createAccountMockHandler } from "../src/client/api/mock/account";
import { casesMockHandlers } from "../src/client/api/mock/cases";
import { createReportsMockHandler, type ReportMockState } from "../src/client/api/mock/reports";
import { clearMockStore, readStore, writeStore } from "../src/client/api/mock/runtime";
import {
  createReportsClient,
  type DomainRequest,
  type DomainRequestInit,
} from "../src/client/api/reports";
import type { CaseView, QuestionView, ReportView, SessionView } from "../src/client/api/types";
import { createZip, maskReportText } from "../src/components/reports/download";

function fixture() {
  let raw = JSON.stringify({
    session: {
      user: { id: "synthetic-owner", name: "예시 이용자", accountType: "customer" },
      needsConsent: false,
    },
    cases: {
      "case-demo": {
        id: "case-demo",
        title: "합성 상담 준비",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: "2026-10-06T10:00:00.000Z",
        summary: "합성 사실: 010-1234-5678, demo@example.test",
      },
    },
    workspace: {
      "case-demo": {
        messages: [{ role: "assistant" }],
        timeline: [{ date: "2026-10-01", title: "자료 확인", detail: "합성 기록" }],
      },
    },
    files: {
      "case-demo": [
        {
          id: "file-demo",
          name: "../합성 자료.txt",
          mimeType: "text/plain",
          sizeBytes: 20,
          status: "ready",
          coverage: "합성 텍스트 전체",
          extractedText: "안전한 합성 자료",
        },
      ],
    },
    reports: {},
    lawyers: { mine: { published: true } },
    workspaceReceipts: { "POST:/api/v2/cases/case-demo/chat:key:body": {} },
    fileProcessing: { "file-demo": { at: 1, failed: false } },
  });
  const read = () => JSON.parse(raw) as ReportMockState;
  const update = (action: (state: ReportMockState) => void) => {
    const value = read();
    action(value);
    raw = JSON.stringify(value);
  };
  const removed: string[] = [];
  const runtime = {
    read,
    update,
    original: async () => new Blob(["안전한 합성 자료"], { type: "text/plain" }),
    removeOriginals: async (_ownerId: string, id?: string) => {
      removed.push(id ?? "all");
    },
  };
  const reports = createReportsMockHandler(runtime),
    account = createAccountMockHandler(runtime);
  const request: DomainRequest = (path, init) =>
    path.includes("/reports") ? reports(path, init) : account(path, init);
  return {
    read,
    update,
    removed,
    request,
    reports: createReportsClient(request),
    account: createAccountClient(request),
  };
}
test("review edits and masking persist through storage reload; old versions retain their reviewed content", async () => {
  const f = fixture();
  const report = await f.reports.get("case-demo");
  expect((await f.account.deletionAccess()).canDelete).toBe(true);
  expect(report.maskIdentifiers).toBe(false);
  const saved = await f.reports.save("case-demo", {
    content: "검토한 사실 01012345678 demo@example.test",
    maskIdentifiers: true,
    excludedFileIds: ["file-demo"],
  });
  expect(saved.revision).toBe(2);
  expect(saved.id).not.toBe(report.id);
  const fresh = createReportsClient(f.request);
  expect(await fresh.get("case-demo")).toEqual(saved);
  const next = await fresh.generate("case-demo");
  expect(next.revision).toBe(3);
  expect(f.read().reportHistory?.[saved.id]?.content).toContain("검토한 사실");
  expect(maskReportText(saved.content)).not.toContain("01012345678");
  expect(maskReportText(saved.content)).not.toContain("demo@example.test");
  expect(maskReportText("연락: 02-123-4567 / +82 10 1234 5678")).toBe(
    "연락: [전화번호 가림] / [전화번호 가림]",
  );
  expect(maskReportText("합성 거래번호 99901012345678999")).toContain("99901012345678999");
});
test("revision conflict and mutation-key replay prevent silent overwrites and duplicate report versions", async () => {
  const f = fixture();
  const old = await f.reports.get("case-demo");
  const other = createReportsClient(f.request);
  await other.get("case-demo");
  await f.reports.save("case-demo", {
    content: "첫 화면의 검토",
    maskIdentifiers: false,
    excludedFileIds: [],
  });
  await expect(
    other.save("case-demo", {
      content: "오래된 화면",
      maskIdentifiers: false,
      excludedFileIds: [],
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const init = {
    method: "POST",
    headers: { "idempotency-key": "synthetic-key" },
    body: { expectedRevision: old.revision + 1 },
  };
  const one = await f.request<ReportView>("/api/v2/cases/case-demo/reports", init);
  expect(await f.request<ReportView>("/api/v2/cases/case-demo/reports", init)).toEqual(one);
  await expect(
    f.request("/api/v2/cases/case-demo/reports", { ...init, body: { expectedRevision: 99 } }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
test("stale source revisions are shown, excluded or removed originals cannot enter ZIP", async () => {
  const f = fixture();
  const report = await f.reports.get("case-demo");
  f.update((state) => {
    const item = state.cases["case-demo"];
    if (item) item.revision++;
  });
  expect((await f.reports.get("case-demo")).stale).toBe(true);
  const saved = await f.reports.save("case-demo", {
    content: "수정 내용",
    maskIdentifiers: false,
    excludedFileIds: ["file-demo"],
  });
  await expect(f.reports.zip(saved.id, ["file-demo"])).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  f.update((state) => {
    state.files["case-demo"] = [];
  });
  await expect(f.reports.zip(report.id, ["file-demo"])).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
});
test("case deletion removes listing, workspace, files and every report version across reload; account deletion clears profile and session", async () => {
  const f = fixture();
  const report = await f.reports.get("case-demo");
  f.update((state) => {
    state.fileUploads = {
      "pending-upload": { caseId: "case-demo", ownerId: "mock-owner" },
      "other-upload": { caseId: "other-case", ownerId: "mock-owner" },
    };
    state.fileExtractions = { "file-demo": "합성 원문", "pending-upload": "예약 자료" };
    state.fileProcessing = { "pending-upload": { at: 1 }, "other-upload": { at: 1 } };
    state.fileUploadReceipts = {
      "synthetic-owner/case-demo/key": { fileId: "pending-upload", fingerprint: "synthetic" },
      "synthetic-owner/other-case/key": { fileId: "other-upload", fingerprint: "synthetic" },
    };
  });
  await expect(f.account.deleteCase("case-demo", "wrong")).rejects.toThrow("DELETE");
  await f.account.deleteCase("case-demo", "DELETE");
  expect(f.read().cases).toEqual({});
  expect(f.read().workspace).toEqual({});
  expect(f.read().fileExtractions).toEqual({});
  expect(Object.keys(f.read().fileUploads ?? {})).toEqual(["other-upload"]);
  expect(Object.keys(f.read().fileProcessing ?? {})).toEqual(["other-upload"]);
  expect(Object.keys(f.read().fileUploadReceipts ?? {})).toEqual([
    "synthetic-owner/other-case/key",
  ]);
  expect(f.read().files).toEqual({});
  expect(f.read().reports).toEqual({});
  expect(f.read().reportHistory).toEqual({});
  expect(f.read().workspaceReceipts).toEqual({});
  expect(f.removed).toEqual(["case-demo"]);
  await expect(f.reports.get("case-demo")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(f.reports.pdf(report.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await f.account.deleteAccount("DELETE");
  expect(f.read().session.user).toBeNull();
  expect(Object.keys(f.read())).not.toContain("lawyers");
  expect(f.removed).toEqual(["case-demo", "all"]);
  await expect(f.account.usage()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});
test("anonymous, unconsented and nonexistent cases cannot read reports or download originals", async () => {
  const f = fixture();
  await expect(f.reports.get("other-owner-case")).rejects.toMatchObject({ code: "NOT_FOUND" });
  f.update((state) => {
    state.session.needsConsent = true;
  });
  await expect(f.reports.get("case-demo")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  f.update((state) => {
    state.session.user = null;
  });
  await expect(f.account.deleteAccount("DELETE")).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});
test("real account usage converts seconds to minutes and deletion uses the existing guarded wire contracts", async () => {
  const calls: { path: string; init: unknown }[] = [];
  const request: DomainRequest = async <T>(path: string, init?: DomainRequestInit) => {
    calls.push({ path, init });
    if (path.endsWith("usage"))
      return {
        schemaVersion: "2",
        day: "2026-10-06",
        timezone: "Asia/Seoul",
        resetAt: "2026-10-06T15:00:00Z",
        newCases: { used: 1, reserved: 0, remaining: 2, limit: 3 },
        aiResponses: { used: 2, reserved: 0, remaining: 28, limit: 30 },
        mediaSeconds: { used: 120, reserved: 60, remaining: 3420, limit: 3600 },
        storageBytes: { used: 100, reserved: 0, remaining: 9_999_999_900, limit: 10_000_000_000 },
        waitReasons: [],
      } as T;
    return { status: "accepted" } as T;
  };
  const api = createAccountClient(request);
  const usage = await api.usage();
  expect(usage.mediaMinutes).toEqual({ used: 3, limit: 60 });
  expect(usage.includesReservations).toBe(true);
  expect(usage.resetAt).toBe("2026-10-06T15:00:00Z");
  await api.deleteCase("synthetic-case", "DELETE", "1");
  await api.deleteAccount("DELETE");
  expect(calls[1]?.path).toBe("/api/cases/synthetic-case");
  expect(calls[1]?.init).toMatchObject({ method: "DELETE" });
  expect(calls[2]?.init).toMatchObject({ method: "DELETE", body: { confirmation: "DELETE" } });
});
test("download rejects HTML masquerading as PDF and ZIP stores valid UTF-8 paths and actual original bytes", async () => {
  const bad: DomainRequest = async <T>() =>
    new Blob(["<html>not a PDF</html>"], { type: "application/pdf" }) as T;
  await expect(createReportsClient(bad).pdf("synthetic-report")).rejects.toThrow("형식");
  const archive = await createZip([{ name: "../합성.txt", blob: new Blob(["합성 원본"]) }]);
  const bytes = new Uint8Array(await archive.arrayBuffer());
  expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
  const view = new DataView(bytes.buffer);
  const length = view.getUint16(26, true);
  const name = new TextDecoder().decode(bytes.slice(30, 30 + length));
  expect(name).not.toContain("/");
  expect(name).not.toContain("..");
  const text = new TextDecoder().decode(
    bytes.slice(30 + length, 30 + length + view.getUint32(18, true)),
  );
  expect(text).toBe("합성 원본");
});

test("consent refusal blocks new processing but keeps owner deletion available", async () => {
  const f = fixture();
  f.update((state) => {
    state.session.needsConsent = true;
  });
  await expect(f.reports.get("case-demo")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
  expect((await f.account.deletionAccess()).canDelete).toBe(true);
  await f.account.deleteCase("case-demo", "DELETE");
  expect(f.read().cases).toEqual({});
  await f.account.deleteAccount("DELETE");
  expect(f.read().session.user).toBeNull();
});

test("failed binary cleanup preserves a retryable case and an account switch cannot clear another session", async () => {
  const f = fixture();
  let fail = true;
  const account = createAccountClient(
    createAccountMockHandler({
      read: f.read,
      update: f.update,
      removeOriginals: async (ownerId, caseId) => {
        expect(ownerId).toBe("synthetic-owner");
        if (fail) throw new Error("원본 정리 실패");
        expect(caseId).toBe("case-demo");
      },
    }),
  );
  await expect(account.deleteCase("case-demo", "DELETE")).rejects.toThrow("원본 정리 실패");
  expect(f.read().cases["case-demo"]).toBeDefined();
  fail = false;
  await account.deleteCase("case-demo", "DELETE");
  expect(f.read().cases["case-demo"]).toBeUndefined();
  const other = createAccountClient(
    createAccountMockHandler({
      read: f.read,
      update: f.update,
      removeOriginals: async () =>
        f.update((value) => {
          if (value.session.user) value.session.user.id = "other-owner";
        }),
    }),
  );
  await expect(other.deleteAccount("DELETE")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(f.read().session.user?.id).toBe("other-owner");
});

test("canonical shared namespaces enforce ownership and deleting one account preserves another owner's case and profile", async () => {
  const f = fixture();
  f.update((state) => {
    const own = state.cases["case-demo"];
    if (!own) throw new Error("fixture missing");
    state.cases["peer-case"] = { ...own, id: "peer-case" };
    state.caseOwners = { "case-demo": "synthetic-owner", "peer-case": "peer-owner" };
    state.consents = { "synthetic-owner": { accepted: true }, "peer-owner": { accepted: true } };
    state.intake = {
      "case-demo": { narrative: "자기 합성 입력" },
      "peer-case": { narrative: "다른 합성 입력" },
    };
    state.caseRequests = {
      "own:create:key": { ownerId: "synthetic-owner", fingerprint: "{}", result: own },
      "own:answers:key": {
        ownerId: "synthetic-owner",
        fingerprint: JSON.stringify({ id: "case-demo" }),
        result: {},
      },
      "peer:create:key": {
        ownerId: "peer-owner",
        fingerprint: "{}",
        result: state.cases["peer-case"],
      },
    };
    state.lawyers = {
      profiles: [{ id: "own-profile" }, { id: "peer-profile" }],
      owners: { "synthetic-owner": "own-profile", "peer-owner": "peer-profile" },
    };
  });
  await expect(f.reports.get("peer-case")).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(f.account.deleteCase("peer-case", "DELETE")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect((await f.account.usage()).newCases.used).toBe(1);
  await f.account.deleteAccount("DELETE");
  expect(Object.keys(f.read().cases)).toEqual(["peer-case"]);
  expect(f.read().caseOwners).toEqual({ "peer-case": "peer-owner" });
  expect(f.read().consents).toEqual({ "peer-owner": { accepted: true } });
  expect(Object.keys(f.read().intake ?? {})).toEqual(["peer-case"]);
  expect(Object.keys(f.read().caseRequests ?? {})).toEqual(["peer:create:key"]);
  expect(f.read().lawyers).toEqual({
    profiles: [{ id: "peer-profile" }],
    owners: { "peer-owner": "peer-profile" },
  });
  expect(f.read().session.user).toBeNull();
  expect(f.read().deletedAccountIds).toEqual(["synthetic-owner"]);
});

test("deleting a case while its original is loading prevents a late ZIP download", async () => {
  const f = fixture();
  const report = await f.reports.get("case-demo");
  const reports = createReportsClient(
    createReportsMockHandler({
      read: f.read,
      update: f.update,
      original: async () => {
        await f.account.deleteCase("case-demo", "DELETE");
        return new Blob(["합성 원본"]);
      },
    }),
  );
  await expect(reports.zip(report.id, ["file-demo"])).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("retry after a lost report mutation response replays the committed version instead of generating twice", async () => {
  const f = fixture();
  let loseResponse = true;
  const keys: string[] = [];
  const report = createReportsClient(async <T>(path: string, init?: DomainRequestInit) => {
    const result = await f.request<T>(path, init);
    if (init?.method === "POST") {
      keys.push(init.headers?.["idempotency-key"] ?? "");
      if (loseResponse) {
        loseResponse = false;
        throw Object.assign(new Error("합성 응답 유실"), { code: "UNAVAILABLE" });
      }
    }
    return result;
  });
  await report.get("case-demo");
  await expect(report.generate("case-demo")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await report.generate("case-demo")).revision).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  expect(Object.values(f.read().reportHistory ?? {})).toHaveLength(2);
});

test("B intake and D report/delete share actual canonical namespaces across adapter reload", async () => {
  clearMockStore();
  try {
    writeStore("session", {
      user: { id: "canonical-owner", name: "합성 고객", accountType: "customer" },
      needsConsent: false,
    });
    writeStore("consents", { "canonical-owner": { synthetic: true } });
    const item = casesMockHandlers["cases.create"](
      {
        narrative: "친구에게 돈을 빌려준 뒤 합성 자료로 상담을 준비합니다.",
        subjectContext: "individual",
      },
      { key: crypto.randomUUID() },
    ) as CaseView;
    const questions = casesMockHandlers["cases.getQuestions"]({ id: item.id }) as {
      questions: QuestionView[];
      revision: number;
    };
    const answered = casesMockHandlers["cases.saveAnswers"](
      {
        id: item.id,
        expectedRevision: questions.revision,
        answers: questions.questions.map((question) => ({
          questionId: question.id,
          state: "unknown",
        })),
      },
      { key: crypto.randomUUID() },
    ) as { revision: number };
    const advanced = casesMockHandlers["cases.advance"](
      { id: item.id, expectedRevision: answered.revision },
      { key: crypto.randomUUID() },
    ) as { revision: number };
    casesMockHandlers["cases.confirmSummary"](
      { id: item.id, expectedRevision: advanced.revision },
      { key: crypto.randomUUID() },
    );
    const read = (): ReportMockState => ({
      session: readStore<SessionView>("session", { user: null, needsConsent: false }),
      cases: readStore("cases", {}),
      caseOwners: readStore("caseOwners", {}),
      consents: readStore("consents", {}),
      intake: readStore("intake", {}),
      caseRequests: readStore("caseRequests", {}),
      workspace: readStore("workspace", {}),
      files: readStore("files", {}),
      reports: readStore("reports", {}),
      reportHistory: readStore("reportHistory", {}),
      reportSources: readStore("reportSources", {}),
      reportRequests: readStore("reportRequests", {}),
      deletedCaseIds: readStore("deletedCaseIds", []),
    });
    const update = (action: (value: ReportMockState) => void) => {
      const value = read();
      action(value);
      for (const [namespace, data] of Object.entries(value)) writeStore(namespace, data);
    };
    const runtime = { read, update, original: async () => new Blob(["합성 자료"]) };
    const handler = createReportsMockHandler(runtime);
    const reports = createReportsClient(handler);
    const report = await reports.get(item.id);
    expect(report.content).toContain("친구에게 돈");
    const saved = await reports.save(item.id, {
      content: "직접 검토한 합성 사실",
      maskIdentifiers: true,
      excludedFileIds: [],
    });
    expect(await createReportsClient(handler).get(item.id)).toEqual(saved);
    await createAccountClient(createAccountMockHandler(runtime)).deleteCase(item.id, "DELETE");
    expect(casesMockHandlers["cases.list"]()).toEqual([]);
    expect(readStore("intake", {})).toEqual({});
    expect(readStore("caseRequests", {})).toEqual({});
    await expect(reports.get(item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await createAccountClient(createAccountMockHandler(runtime)).deleteAccount("DELETE");
    expect(readStore<SessionView>("session", { user: null, needsConsent: false }).user).toBeNull();
    expect(readStore("consents", {})).toEqual({});
  } finally {
    clearMockStore();
  }
});
