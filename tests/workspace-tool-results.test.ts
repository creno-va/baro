import { expect, test } from "bun:test";
import { type V2AssistantMessage, v2MessageSchema } from "../src/contracts/v2";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { lookupCatalog } from "../src/server/modules/external-tools/catalog";
import { createExternalTools } from "../src/server/modules/external-tools/service";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { createWorkspacePipeline } from "../src/server/modules/workspace/pipeline";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import {
  publicStoredMessageSchema,
  storedMessageSchema,
} from "../src/server/modules/workspace/stored-message";
import { reportHttpFixture } from "./helpers/report-http-fixture";

const draft = {
  text: "외부 조회는 아직 연결되지 않아 실제 결과를 확인하지 못했어요.",
  references: [],
  warnings: [],
  facts: [],
  actions: [],
  parties: [],
  timeline: [],
  requestedSources: [],
  requestedMaterials: [],
  requestedTools: [],
};
const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
const access = {
  authorize: async () => true,
  reserve: async () => {
    throw new Error("NO_NETWORK_CLAIM");
  },
  signal: new AbortController().signal,
};

test("chat executes a bounded server tool round, audits actual statuses, rejects a repeated tool", async () => {
  const f = await reportHttpFixture();
  try {
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, {
      schemaVersion: "2",
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      workspaceRevision: f.rev(),
      createdAt: f.actor.now,
      role: "user",
      text: "사업자 상태와 피해 등록을 확인해 주세요.",
      selectedFileIds: [],
    });
    context.lookupTools = lookupCatalog({});
    const calls: { phase: string; input: unknown }[] = [];
    const pipeline = createWorkspacePipeline(
      {
        call: async (phase, input) => {
          calls.push({ phase, input });
          return phase === "workspace_audit"
            ? approved
            : calls.length === 1
              ? { ...draft, requestedTools: ["hometax_status", "thecheat"] }
              : draft;
        },
      },
      {
        reserve: async () => true,
        invocation: () => crypto.randomUUID(),
        lookup: async (tools) =>
          Promise.all(tools.map((tool) => createExternalTools({}).execute(tool, null, access))),
      },
    );
    const output = await pipeline.chat(context, "synthetic_lookup");
    expect(calls.map((c) => c.phase)).toEqual([
      "workspace_chat",
      "workspace_chat",
      "workspace_audit",
    ]);
    expect(output.toolResults.map((r) => r.status)).toEqual(["not_configured", "not_configured"]);
    expect(calls[2]?.input).toMatchObject({
      context: { toolLookupPerformed: true, toolResults: output.toolResults },
    });
    const repeated = createWorkspacePipeline(
      { call: async () => ({ ...draft, requestedTools: ["hometax_status"] }) },
      {
        reserve: async () => true,
        invocation: () => crypto.randomUUID(),
        lookup: async () => [await createExternalTools({}).execute("hometax_status", null, access)],
      },
    );
    await expect(repeated.chat(context, "synthetic_repeated_lookup")).rejects.toThrow(
      "POLICY_REJECTED",
    );
  } finally {
    f.db.close();
  }
});

test("encrypted tool results use an authorized separate endpoint while old strict messages remain readable", async () => {
  const f = await reportHttpFixture();
  try {
    const result = await createExternalTools({}).execute("registry", null, access);
    const message: V2AssistantMessage = {
      schemaVersion: "2",
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      workspaceRevision: f.rev(),
      createdAt: f.actor.now,
      role: "assistant",
      safety: "validated",
      text: draft.text,
      references: [],
      citations: [],
      warnings: [],
    };
    const stored = storedMessageSchema().parse({ ...message, toolResults: [result] });
    expect(v2MessageSchema().safeParse(stored).success).toBe(false);
    expect(publicStoredMessageSchema().parse(stored)).toEqual(message);
    const payload = await f.core.encrypt("v2_messages", message.id, f.actor.ownerId, 1, stored);
    f.db.sqlite
      .query(
        "INSERT INTO v2_operations(id,owner_id,workspace_id,kind,created_at) VALUES(?,?,?,'chat',?)",
      )
      .run(message.operationId, f.actor.ownerId, f.workspaceId, f.actor.now);
    f.db.sqlite
      .query(
        "INSERT INTO v2_messages(id,workspace_id,workspace_revision,operation_id,role,safety,encrypted_payload,created_at) VALUES(?,?,?,?,'assistant','validated',?,?)",
      )
      .run(message.id, f.workspaceId, f.rev(), message.operationId, payload, f.actor.now);
    const service = createWorkspaceService(f.core, { clock: () => f.actor.now });
    expect(await service.messages(f.actor.ownerId, f.workspaceId)).toEqual([message]);
    expect(await service.toolResults(f.actor.ownerId, f.workspaceId, message.id)).toEqual([result]);
    await expect(service.toolResults("other_owner", f.workspaceId, message.id)).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(
      service.toolResults(f.actor.ownerId, "other_workspace", message.id),
    ).rejects.toThrow("NOT_FOUND");
    f.app.route("/api/v2/cases", createWorkspacesApi());
    const path = `/api/v2/cases/${f.workspaceId}/messages/${message.id}/tool-results`;
    const response = await f.app.request(path, { headers: { cookie: f.cookie } }, f.env);
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({ schemaVersion: "2", results: [result] });
    expect((await f.app.request(path, {}, f.env)).status).toBe(401);
    const decrypt = f.core.decrypt.bind(f.core);
    f.core.decrypt = async (...args) => {
      const value = await decrypt(...args);
      f.db.sqlite
        .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
        .run(f.workspaceId);
      return value;
    };
    await expect(service.toolResults(f.actor.ownerId, f.workspaceId, message.id)).rejects.toThrow(
      "STALE_REVISION",
    );
  } finally {
    f.db.close();
  }
});
