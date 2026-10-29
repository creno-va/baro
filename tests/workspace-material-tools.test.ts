import { expect, test } from "bun:test";
import type { V2Fact, V2UserMessage } from "../src/contracts/v2";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import {
  conversationMaterialIds,
  readMaterialWindow,
} from "../src/server/modules/workspace/materials";
import {
  assertWorkspaceFacts,
  createWorkspacePipeline,
  type WorkspaceContext,
} from "../src/server/modules/workspace/pipeline";
import { normalizeTimelineDates } from "../src/server/modules/workspace/timeline-dates";
import { readyFile, reportFixture } from "./helpers/report-fixture";

async function fixture() {
  const f = await reportFixture();
  const upload = await readyFile(f, "synthetic original");
  const fileId = upload.session.fileId;
  const row = f.db.sqlite
    .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
    .get(fileId) as { revision: number; coverage_snapshot_id: string };
  for (let ordinal = 0; ordinal < 40; ordinal++) {
    const id = crypto.randomUUID(),
      entity = crypto.randomUUID();
    const value = {
      id: entity,
      text: `합성 자료 구간 ${ordinal}의 원문입니다.`,
      position: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
      certainty: ordinal === 19 ? "uncertain" : "observed",
      userEdited: ordinal === 19,
      included: ordinal !== 18,
    };
    const encrypted = await f.core.encrypt(
      "v2_file_observations",
      id,
      f.actor.ownerId,
      row.revision,
      value,
    );
    f.db.sqlite
      .query(
        "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        entity,
        fileId,
        row.revision,
        row.revision,
        ordinal,
        encrypted,
        row.coverage_snapshot_id,
      );
  }
  const latest: V2UserMessage = {
    schemaVersion: "2",
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    workspaceRevision: f.rev(),
    createdAt: f.actor.now,
    role: "user",
    text: "첨부 자료의 뒤쪽 내용도 정리해 주세요.",
    selectedFileIds: [fileId],
  };
  return { ...f, fileId, fileRevision: row.revision, latest };
}

test("material tool reads beyond the first eight excerpts without leaking exclusions or losing positions", async () => {
  const f = await fixture();
  try {
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, f.latest);
    expect(context.materials).toHaveLength(31);
    expect(context.materialWindows?.[0]).toMatchObject({ observationCount: 40, nextOrdinal: 32 });
    const result = await readMaterialWindow(f.core, f.actor, f.workspaceId, {
      fileId: f.fileId,
      fileRevision: f.fileRevision,
      startOrdinal: 16,
      count: 32,
    });
    expect(result.materials).toHaveLength(23);
    expect(result.nextOrdinal).toBeNull();
    expect(result.materials.some((material) => material.text.includes("구간 18의"))).toBe(false);
    expect(result.materials.at(-1)?.reference.position).toMatchObject({ page: 1, paragraph: 40 });
    expect(
      result.materials.find((material) => material.text.includes("구간 19의"))?.coverage,
    ).toMatchObject({ observationCertainty: "uncertain", userEdited: true });
    const limited = await readMaterialWindow(
      f.core,
      f.actor,
      f.workspaceId,
      { fileId: f.fileId, fileRevision: f.fileRevision, startOrdinal: 16, count: 32 },
      16,
    );
    expect(limited.materials).toEqual([]);
    expect(limited.nextOrdinal).toBe(16);
  } finally {
    f.db.close();
  }
});

test("material window rejects wrong owner, workspace, revision and mid-decryption deletion", async () => {
  const f = await fixture();
  const request = { fileId: f.fileId, fileRevision: f.fileRevision, startOrdinal: 16, count: 8 };
  try {
    for (const [actor, workspace, input] of [
      [{ ...f.actor, ownerId: "other_owner" }, f.workspaceId, request],
      [f.actor, "other_workspace", request],
      [f.actor, f.workspaceId, { ...request, fileRevision: f.fileRevision + 1 }],
    ] as const)
      await expect(readMaterialWindow(f.core, actor, workspace, input)).rejects.toThrow(
        "MATERIAL_UNAVAILABLE",
      );
    const decrypt = f.core.decrypt.bind(f.core);
    f.core.decrypt = async (...args) => {
      const value = await decrypt(...args);
      f.db.sqlite.query("UPDATE v2_files SET state='deleting' WHERE id=?").run(f.fileId);
      return value;
    };
    await expect(readMaterialWindow(f.core, f.actor, f.workspaceId, request)).rejects.toThrow(
      "MATERIAL_UNAVAILABLE",
    );
  } finally {
    f.db.close();
  }
});

test("conversation attachments are prioritized, deduplicated and remain bounded", () => {
  expect(
    conversationMaterialIds({ selectedFileIds: ["current", "old"] }, [
      { selectedFileIds: ["old", "older"] },
    ]),
  ).toEqual(["current", "old", "older"]);
  expect(
    conversationMaterialIds(undefined, [
      { selectedFileIds: Array.from({ length: 101 }, (_, i) => `file${i}`) },
    ]),
  ).toHaveLength(100);
});
test("a follow-up reopens its earlier attachment and skips a deleted historical attachment", async () => {
  const f = await fixture();
  try {
    const operationId = (
      f.db.sqlite.query("SELECT operation_id FROM v2_files WHERE id=?").get(f.fileId) as {
        operation_id: string;
      }
    ).operation_id;
    const earlier = { ...f.latest, operationId };
    const encrypted = await f.core.encrypt("v2_messages", earlier.id, f.actor.ownerId, 1, earlier);
    f.db.sqlite
      .query(
        "INSERT INTO v2_messages(id,workspace_id,revision,workspace_revision,operation_id,role,encrypted_payload,created_at) VALUES(?,?,1,?,?,'user',?,?)",
      )
      .run(
        earlier.id,
        f.workspaceId,
        earlier.workspaceRevision,
        operationId,
        encrypted,
        earlier.createdAt,
      );
    const followup = {
      ...f.latest,
      id: crypto.randomUUID(),
      selectedFileIds: [],
      text: "그 자료의 뒤쪽도 확인해 주세요.",
    };
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, followup);
    expect(context.references.files.map((file) => file.id)).toContain(f.fileId);
    expect(context.materials.length).toBe(31);
    f.db.sqlite.query("UPDATE v2_files SET state='deleting' WHERE id=?").run(f.fileId);
    const after = await readWorkspaceContext(f.core, f.actor, f.workspaceId, followup);
    expect(after.materials).toEqual([]);
    expect(after.references.files).toEqual([]);
  } finally {
    f.db.close();
  }
});

test("all observations at one source position support exact quotes, but joined invented quotes do not", async () => {
  const f = await fixture();
  try {
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, f.latest);
    const first = context.materials[0];
    if (!first) throw new Error("Missing synthetic material");
    context.materials.push({ ...first, text: "같은 영상 프레임의 두 번째 관찰입니다." });
    const fact: V2Fact = {
      id: "synthetic_fact",
      text: "같은 영상 프레임의 두 번째 관찰입니다.",
      references: [first.reference],
      attribution: "user_material",
      certainty: "observed",
      significance: "neutral",
      userEdited: false,
      conflictingFactIds: [],
    };
    expect(() => assertWorkspaceFacts(context, [fact])).not.toThrow();
    expect(() =>
      assertWorkspaceFacts(context, [{ ...fact, text: `${first.text}\n${fact.text}` }]),
    ).toThrow();
    context.materials.push({ ...first, text: "발행일은 2025년 3월 2일입니다." });
    const entry = {
      id: "synthetic_event",
      revision: 1,
      date: "2025-03-02",
      datePrecision: "day" as const,
      event: "문서 발행",
      certainty: "observed" as const,
      references: [first.reference],
      factIds: [],
      userEdited: false,
    };
    expect(normalizeTimelineDates(context, [entry], () => null).timeline[0]?.date).toBe(
      "2025-03-02",
    );
    context.materials.push({ ...first, text: "발행일은 2025년 4월 2일입니다." });
    expect(normalizeTimelineDates(context, [entry], () => null).timeline[0]?.date).toBeNull();
  } finally {
    f.db.close();
  }
});

const approved = {
  pass: true,
  findings: [],
  unsupportedFactIds: [],
  legalClaimsSupported: true,
  strategyDetected: false,
};
const draft = {
  text: "자료 구간을 나누어 확인했습니다.",
  references: [],
  warnings: [],
  facts: [],
  actions: [],
  parties: [],
  timeline: [],
  requestedSources: [],
  requestedMaterials: [],
};
test("chat performs one authorized material round then independent audit, and rejects another file or loop", async () => {
  const f = await fixture();
  try {
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId, f.latest);
    const request = { fileId: f.fileId, fileRevision: f.fileRevision, startOrdinal: 16, count: 24 };
    const phases: string[] = [];
    const inputs: unknown[] = [];
    const pipeline = createWorkspacePipeline(
      {
        call: async (phase, input) => {
          phases.push(phase);
          inputs.push(input);
          return phase === "workspace_audit"
            ? approved
            : phases.length === 1
              ? { ...draft, requestedMaterials: [request] }
              : draft;
        },
      },
      {
        reserve: async () => true,
        invocation: () => crypto.randomUUID(),
        readMaterials: async (context, requests) => {
          const request = requests[0];
          if (!request) throw new Error("Missing synthetic window");
          const result = await readMaterialWindow(f.core, f.actor, f.workspaceId, request);
          return { ...context, materials: [...context.materials, ...result.materials] };
        },
      },
    );
    await pipeline.chat(context, "synthetic_material_tool");
    expect(phases).toEqual(["workspace_chat", "workspace_chat", "workspace_audit"]);
    expect(inputs[1]).toMatchObject({ materialLookupPerformed: true });
    for (const badRequest of [{ ...request, fileId: "unselected" }, request]) {
      const rejected = createWorkspacePipeline(
        { call: async () => ({ ...draft, requestedMaterials: [badRequest] }) },
        {
          reserve: async () => true,
          invocation: () => crypto.randomUUID(),
          readMaterials: async (context: WorkspaceContext) => context,
        },
      );
      await expect(rejected.chat(context, "synthetic_material_denied")).rejects.toThrow(
        "POLICY_REJECTED",
      );
    }
  } finally {
    f.db.close();
  }
});
