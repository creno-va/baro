import { expect, test } from "bun:test";
import { createAccountClient } from "../src/client/api/account";
import { createAccountMockHandler } from "../src/client/api/mock/account";
import { createReportsMockHandler, type ReportMockState } from "../src/client/api/mock/reports";
import { createReportsClient, type DomainRequest } from "../src/client/api/reports";
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
  expect((await f.account.deletionAccess()).mock).toBe(true);
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
  const one = await f.request("/api/v2/cases/case-demo/reports", init);
  expect(await f.request("/api/v2/cases/case-demo/reports", init)).toEqual(one);
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
  await expect(f.account.deleteCase("case-demo", "wrong")).rejects.toThrow("DELETE");
  await f.account.deleteCase("case-demo", "DELETE");
  expect(f.read().cases).toEqual({});
  expect(f.read().workspace).toEqual({});
  expect(f.read().files).toEqual({});
  expect(f.read().reports).toEqual({});
  expect(f.read().reportHistory).toEqual({});
  expect(f.read().workspaceReceipts).toEqual({});
  expect(f.read().fileProcessing).toEqual({});
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
  const request: DomainRequest = async <T>(path, init) => {
    calls.push({ path, init });
    if (path.endsWith("usage"))
      return {
        schemaVersion: "2",
        day: "2026-10-06",
        timezone: "Asia/Seoul",
        resetAt: "2026-10-06T15:00:00Z",
        newCases: { used: 1, reserved: 0, remaining: 2, limit: 3 },
        aiResponses: { used: 2, reserved: 0, remaining: 28, limit: 30 },
        mediaSeconds: { used: 120, reserved: 0, remaining: 3480, limit: 3600 },
        storageBytes: { used: 100, reserved: 0, remaining: 9_999_999_900, limit: 10_000_000_000 },
        waitReasons: [],
      } as T;
    return { status: "accepted" } as T;
  };
  const api = createAccountClient(request);
  expect((await api.usage()).mediaMinutes).toEqual({ used: 2, limit: 60 });
  await api.deleteCase("synthetic-case", "DELETE");
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
