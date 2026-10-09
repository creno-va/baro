import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createWorkspaceApi } from "../src/client/api/workspace";
import { createFilesApi } from "../src/server/api/v2/files";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import {
  customerWorkspaceFixture,
  executeCustomerJob,
  runCustomerJob,
} from "./helpers/customer-workspace";

for (const completeDuringRead of [false, true])
  test(`chat completes between message snapshot and job lookup=${completeDuringRead}`, async () => {
    const f = await customerWorkspaceFixture(new Date().toISOString());
    let release!: () => void;
    try {
      await runCustomerJob(f, "intake_questions");
      const intake = await f.service.intake(f.owner.userId, f.workspace.id);
      await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
        expectedRevision: intake!.revision,
        answers: intake!.batches[0]!.questions.map((q) => ({
          questionId: q.id,
          status: "unknown",
        })),
      });
      await runCustomerJob(f, "intake_summary");
      const summary = await f.service.intake(f.owner.userId, f.workspace.id);
      await f.service.confirm(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
        expectedRevision: summary!.revision,
        summaryRevision: summary!.summary!.revision,
      });
      const workspace = await f.service.find(f.owner.userId, f.workspace.id),
        jobId = crypto.randomUUID(),
        operationId = crypto.randomUUID();
      expect(
        await f.jobs.admitWorkspace(
          {
            ownerId: f.owner.userId,
            now: f.now,
            workspaceId: f.workspace.id,
            expectedRevision: workspace.workspaceRevision,
          },
          { operationId, key: crypto.randomUUID(), requestHash: "b".repeat(64) },
          jobId,
          "chat_response",
          {
            id: crypto.randomUUID(),
            request: {
              expectedRevision: workspace.workspaceRevision,
              text: "합성 후속 대화를 추가합니다.",
              selectedFileIds: [],
            },
          },
        ),
      ).toBe(true);
      const params = {
        ownerId: f.owner.userId,
        workspaceId: f.workspace.id,
        workspaceRevision: workspace.workspaceRevision + 1,
        jobId,
      };
      const env = { ...f.owner.env, CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, "") };
      const app = new Hono()
        .route("/api/v2/cases", createWorkspacesApi())
        .route("/api/v2/cases", createFilesApi());
      let reached!: () => void,
        hold = completeDuringRead;
      const readStarted = new Promise<void>((resolve) => {
          reached = resolve;
        }),
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
      const transport = async (path: string, init?: RequestInit) => {
        const response = await app.request(
          path,
          {
            ...init,
            headers: {
              ...Object.fromEntries(new Headers(init?.headers)),
              cookie: f.owner.cookie,
              origin: env.BETTER_AUTH_URL,
            },
          },
          env,
        );
        if (hold && path.includes("/messages?")) {
          hold = false;
          expect(response.status).toBe(200);
          reached();
          await gate;
        }
        return response;
      };
      if (!completeDuringRead)
        expect((await executeCustomerJob(f, params)).result.status).toBe("completed");
      const client = createWorkspaceApi(transport, null),
        reading = client.get(f.workspace.id);
      if (completeDuringRead) {
        await readStarted;
        expect((await executeCustomerJob(f, params)).result.status).toBe("completed");
        release();
      }
      const view = await reading;
      const answer = f.db.sqlite
        .query("SELECT id FROM v2_messages WHERE operation_id=? AND role='assistant'")
        .get(operationId) as { id: string };
      expect(answer).toBeTruthy();
      expect(view.messages.some((m) => m.id === answer.id)).toBe(true);
      expect(view.messages.some((m) => m.status === "pending" || m.status === "failed")).toBe(
        false,
      );
      if (completeDuringRead)
        expect((await client.get(f.workspace.id)).messages.some((m) => m.id === answer.id)).toBe(
          true,
        );
    } finally {
      release?.();
      f.db.close();
    }
  });
