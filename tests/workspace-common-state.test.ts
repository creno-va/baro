import { afterEach, expect, test } from "bun:test";
import "../src/client/api/mock/cases";
import { clearMockStore, mockRequest, readStore, writeStore } from "../src/client/api/mock/runtime";
import {
  createWorkspaceMock,
  type WorkspaceMockRuntime,
  type WorkspaceMockState,
} from "../src/client/api/mock/workspace";
import type { CaseView, QuestionView } from "../src/client/api/types";
import { createWorkspaceApi } from "../src/client/api/workspace";

afterEach(clearMockStore);
test("B-created and confirmed case uses the same canonical namespaces in C after reload", async () => {
  clearMockStore();
  writeStore("session", {
    user: { id: "synthetic-owner", name: "합성 고객", accountType: "customer" },
    needsConsent: false,
  });
  const created = await mockRequest<CaseView>(
    "cases.create",
    {
      narrative:
        "공통 저장소 연결을 확인하기 위한 합성 사건입니다. 실제 사건 정보를 포함하지 않습니다.",
      subjectContext: "individual",
    },
    crypto.randomUUID(),
  );
  let questions = await mockRequest<{ questions: QuestionView[]; revision: number }>(
    "cases.getQuestions",
    { id: created.id },
    crypto.randomUUID(),
  );
  questions = await mockRequest(
    "cases.saveAnswers",
    {
      id: created.id,
      expectedRevision: questions.revision,
      answers: questions.questions.map((q) => ({ questionId: q.id, state: "unknown" })),
    },
    crypto.randomUUID(),
  );
  await mockRequest(
    "cases.advance",
    { id: created.id, expectedRevision: questions.revision },
    crypto.randomUUID(),
  );
  const reviewed = await mockRequest<CaseView>(
    "cases.get",
    { id: created.id },
    crypto.randomUUID(),
  );
  await mockRequest(
    "cases.confirmSummary",
    { id: created.id, expectedRevision: reviewed.revision },
    crypto.randomUUID(),
  );

  const initial: WorkspaceMockState = {
    session: { user: null, needsConsent: false },
    cases: {},
    caseOwners: {},
    workspace: {},
    files: {},
    reports: {},
  };
  const runtime: WorkspaceMockRuntime = {
    read: () =>
      Object.fromEntries(
        Object.entries(initial).map(([namespace, fallback]) => [
          namespace,
          readStore(namespace, fallback),
        ]),
      ) as WorkspaceMockState,
    update: (mutate) => {
      const state = runtime.read();
      const result = mutate(state);
      for (const [namespace, value] of Object.entries(state)) {
        writeStore(namespace, value);
        if (!(namespace in initial)) initial[namespace] = {};
      }
      return result;
    },
  };
  const handler = createWorkspaceMock(runtime);
  const transport = async (path: string, init?: RequestInit) =>
    (await handler(new Request(`http://localhost${path}`, init))) ??
    new Response(null, { status: 404 });
  const api = createWorkspaceApi(transport);
  const view = await api.get(created.id);
  expect(view.case.stage).toBe("active");
  expect(view.case.id).toBe(created.id);
  expect(view.case.summary).toBe(reviewed.summary);
  const changed = await api.setAction(created.id, view.actions[0]?.id ?? "", true);
  const b = await mockRequest<CaseView>("cases.get", { id: created.id }, crypto.randomUUID());
  expect(b.revision).toBe(changed.case.revision);
  expect((await createWorkspaceApi(transport).get(created.id)).actions[0]?.done).toBe(true);
  writeStore("session", {
    user: { id: "other-owner", name: "다른 합성 고객", accountType: "customer" },
    needsConsent: false,
  });
  await expect(api.get(created.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
});
