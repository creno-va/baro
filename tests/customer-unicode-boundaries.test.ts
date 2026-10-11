import { afterEach, expect, test } from "bun:test";
import { validateUpload } from "../src/client/api/files";
import { casesMockHandlers as cases } from "../src/client/api/mock/cases";
import { clearMockStore, readStore, writeStore } from "../src/client/api/mock/runtime";
import { createWorkspaceApi } from "../src/client/api/workspace";
import { v2UploadReservationRequestSchema } from "../src/contracts/v2";
import { intake, summary, workspace } from "./fixtures/contracts/v2";

afterEach(() => clearMockStore());

test("upload filename validation accepts the contract's full Unicode range and retains rejection boundaries", () => {
  for (const name of [
    `${"😀".repeat(251)}.txt`,
    `${"a".repeat(251)}.txt`,
    `  😀${"b".repeat(250)}.txt`,
  ]) {
    const input = {
      name,
      byteLength: 1,
      mediaType: "text/plain",
      autoProcessConsentVersion: "synthetic-v1",
    };
    expect(v2UploadReservationRequestSchema.safeParse(input).success).toBe(true);
    expect(() => validateUpload({ name, size: 1, type: "text/plain" })).not.toThrow();
  }
  for (const name of [
    `${"😀".repeat(252)}.txt`,
    `${"a".repeat(252)}.txt`,
    "",
    "   ",
    "dir/file.txt",
    "dir\\file.txt",
    "file\u0000.txt",
    "file\u007f.txt",
  ]) {
    expect(() => validateUpload({ name, size: 1, type: "text/plain" })).toThrow();
  }
});

for (const narrative of [`${"a".repeat(1999)}😀tail`, "😀".repeat(2001)]) {
  test(`mock intake fact retains 2000 complete code points: ${narrative.startsWith("a") ? "boundary" : "emoji"}`, () => {
    clearMockStore();
    writeStore("session", {
      user: { id: "synthetic-customer", name: "Synthetic", accountType: "customer" },
      needsConsent: false,
    });
    const context = () => ({ key: crypto.randomUUID() });
    const item = cases["cases.create"]({ narrative, subjectContext: "individual" }, context());
    let questions = cases["cases.getQuestions"]({ id: item.id });
    for (let round = 0; round < 2; round++) {
      questions = cases["cases.saveAnswers"](
        {
          id: item.id,
          expectedRevision: questions.revision,
          answers: questions.questions
            .filter((question) => !question.answerState)
            .map((question) => ({ questionId: question.id, state: "unknown" })),
        },
        context(),
      );
      questions = cases["cases.advance"](
        { id: item.id, expectedRevision: questions.revision },
        context(),
      );
    }
    const view = cases["cases.get"]({ id: item.id });
    const fact = view.summaryDetails?.facts[0];
    expect(fact?.text).toBe([...narrative].slice(0, 2000).join(""));
    expect([...(fact?.text ?? "")]).toHaveLength(2000);
    expect(fact?.attribution).toBe("user_statement");
    expect(readStore<Record<string, { narrative: string }>>("intake", {})[item.id]?.narrative).toBe(
      narrative,
    );
  });
}

test("real workspace titles retain Unicode boundaries, ASCII limits and the empty narrative fallback", async () => {
  for (const narrative of [`${"a".repeat(59)}😀tail`, "😀".repeat(61), "a".repeat(61), ""]) {
    const client = createWorkspaceApi(async (path) => {
      const route = new URL(path, "http://local").pathname;
      if (route.endsWith("/workspace")) return Response.json({ ...workspace, currentJobId: null });
      if (route.endsWith("/intake")) return Response.json({ ...intake, narrative });
      if (route.endsWith("/summary")) return Response.json(summary);
      if (route.endsWith("/files")) return Response.json([]);
      if (route.endsWith("/messages") || route.endsWith("/actions") || route.endsWith("/timeline"))
        return Response.json({ items: [], nextCursor: null });
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }, null);
    const view = await client.get(workspace.id);
    expect(view.case.title).toBe([...narrative].slice(0, 60).join("") || workspace.title);
    expect(view.case.id).toBe(workspace.id);
    expect(view.case.summary).toBe(summary.overview);
  }
});
