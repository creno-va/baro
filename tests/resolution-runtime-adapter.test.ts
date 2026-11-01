import { expect, test } from "bun:test";
import { v2ResolutionStateForGuidesSchema } from "../src/contracts/v2/resolution";
import { sqlClaim } from "../src/server/db/v2-core";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import {
  createResolutionRuntimeAdapter,
  type ResolutionRuntimeDependencies,
} from "../src/server/modules/resolution/runtime-adapter";
import { createResolutionService } from "../src/server/modules/resolution/service";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";
import { resolutionMutation, resolutionSource } from "./helpers/resolution-fixture";

/** Storage protocol integration. Report/analysis inputs are explicit synthetic projections;
 * production HTTP, semantic source authority and real provider acceptance remain separate. */
async function fixture() {
  const f = await customerWorkspaceFixture();
  const guard = {
    ownerId: f.owner.userId,
    workspaceId: f.workspace.id,
    expectedRevision: f.workspace.workspaceRevision,
    now: f.now,
  };
  const repository = createV2ReworkRepository(f.core, { clock: () => f.now });
  const schema = v2ResolutionStateForGuidesSchema(["www.easylaw.go.kr"]);
  const source = resolutionSource();
  const record = () =>
    repository.read(guard, guard.workspaceId, "resolution", guard.workspaceId, schema);
  let loads = 0;
  const runtime: ResolutionRuntimeDependencies = {
    loadSource: async () => {
      loads++;
      return source;
    },
    authorize: async () => true,
    publicationAuthority: async () => ({ sql: "1", values: [] }),
    now: () => f.now,
    newId: () => crypto.randomUUID(),
    guideHosts: ["www.easylaw.go.kr"],
  };
  const deps = createResolutionRuntimeAdapter(f.core, runtime);
  return {
    ...f,
    guard,
    record,
    deps,
    runtime,
    service: createResolutionService(deps),
    get loads() {
      return loads;
    },
  };
}
test("resolution public revisions map to immutable encrypted records without writing on GET", async () => {
  const f = await fixture();
  try {
    let state = await f.service.get(f.guard.ownerId, f.guard.workspaceId);
    expect(state.revision).toBe(1);
    expect(await f.record()).toBeNull();
    state = await f.service.update(f.guard.ownerId, f.guard.workspaceId, {
      ...resolutionMutation(state),
      action: "select",
      choice: "self",
      selectedFileIds: state.selectedFileIds,
      maskIdentifiers: true,
    });
    expect(state.revision).toBe(2);
    expect((await f.record())?.revision).toBe(1);
    state = await f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, {
      ...resolutionMutation(state),
      documentKind: "fact_statement",
      selectedFileIds: state.selectedFileIds,
      maskIdentifiers: true,
      factsConfirmed: true,
    });
    const draft = state.draft;
    if (!draft) throw Error("Missing synthetic draft");
    state = await f.service.update(f.guard.ownerId, f.guard.workspaceId, {
      ...resolutionMutation(state),
      action: "save_draft",
      draftId: draft.id,
      draftRevision: draft.revision,
      content: draft.content,
      reviewed: true,
    });
    const saved = await f.record();
    expect(saved?.revision).toBe(3);
    expect(saved?.value.revision).toBe(4);
    expect(saved?.value.draft?.status).toBe("saved");
    const encrypted = JSON.stringify(
      f.db.sqlite.query("SELECT encrypted_payload FROM v2_rework_parts").all(),
    );
    expect(encrypted).not.toContain("사용자 확인 사실");
    expect(encrypted).not.toContain("합성 사용자는");
    expect(
      (await createResolutionService(f.deps).get(f.guard.ownerId, f.guard.workspaceId)).draft,
    ).toEqual(state.draft);
    f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.guard.ownerId);
    expect((await f.service.get(f.guard.ownerId, f.guard.workspaceId)).draft?.id).toBe(draft.id);
    await expect(
      f.service.update(f.guard.ownerId, f.guard.workspaceId, {
        ...resolutionMutation(state),
        action: "pause",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await f.record())?.value.draft?.id).toBe(draft.id);
    await expect(f.service.get("other-owner", f.guard.workspaceId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    f.db.sqlite.close();
  }
});
test("concurrent resolution drafts publish once at the same stored revision", async () => {
  const f = await fixture();
  try {
    const initial = await f.service.get(f.guard.ownerId, f.guard.workspaceId);
    const selected = await f.service.update(f.guard.ownerId, f.guard.workspaceId, {
      ...resolutionMutation(initial),
      action: "select",
      choice: "self",
      selectedFileIds: initial.selectedFileIds,
      maskIdentifiers: true,
    });
    const input = {
      ...resolutionMutation(selected),
      documentKind: "fact_statement",
      selectedFileIds: selected.selectedFileIds,
      maskIdentifiers: true,
      factsConfirmed: true,
    };
    const results = await Promise.allSettled([
      f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, input),
      f.service.prepareDraft(f.guard.ownerId, f.guard.workspaceId, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect((await f.record())?.revision).toBe(2);
    expect((await f.record())?.value.revision).toBe(3);
    expect(
      f.db.sqlite
        .query(
          "SELECT count(*) count FROM v2_rework_records WHERE kind='resolution' AND state='published'",
        )
        .get(),
    ).toEqual({ count: 2 });
  } finally {
    f.db.sqlite.close();
  }
});
test("the root authority predicate joins final publication and cannot publish an invalid source", async () => {
  const f = await fixture();
  try {
    const state = await f.service.get(f.guard.ownerId, f.guard.workspaceId);
    f.runtime.publicationAuthority = async () => ({ sql: "0", values: [] });
    await expect(
      f.service.update(f.guard.ownerId, f.guard.workspaceId, {
        ...resolutionMutation(state),
        action: "select",
        choice: "self",
        selectedFileIds: state.selectedFileIds,
        maskIdentifiers: true,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(await f.record()).toBeNull();
    expect(
      f.db.sqlite
        .query(
          "SELECT count(*) count FROM v2_rework_records WHERE kind='resolution' AND state='published'",
        )
        .get(),
    ).toEqual({ count: 0 });
  } finally {
    f.db.sqlite.close();
  }
});
test("consent revoked at the final authority callback cannot escape the atomic write fence", async () => {
  const f = await fixture();
  try {
    const state = await f.service.get(f.guard.ownerId, f.guard.workspaceId);
    let seenNow = "";
    f.runtime.publicationAuthority = async () => (now) => {
      seenNow = now;
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.guard.ownerId);
      return { sql: "1", values: [] };
    };
    await expect(
      f.service.update(f.guard.ownerId, f.guard.workspaceId, {
        ...resolutionMutation(state),
        action: "select",
        choice: "self",
        selectedFileIds: state.selectedFileIds,
        maskIdentifiers: true,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(seenNow).toBe(f.now);
    expect(await f.record()).toBeNull();
    expect((await f.service.get(f.guard.ownerId, f.guard.workspaceId)).revision).toBe(1);
  } finally {
    f.db.sqlite.close();
  }
});
test("metadata-only state saves use the live workspace guard without bumping factual revision", async () => {
  const f = await fixture();
  try {
    const initial = await f.service.get(f.guard.ownerId, f.guard.workspaceId);
    let state = await f.service.update(f.guard.ownerId, f.guard.workspaceId, {
      ...resolutionMutation(initial),
      action: "select",
      choice: "self",
      selectedFileIds: initial.selectedFileIds,
      maskIdentifiers: true,
    });
    expect(
      f.db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(f.guard.workspaceId),
    ).toEqual({ revision: f.guard.expectedRevision });
    f.db.sqlite
      .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
      .run(f.guard.workspaceId);
    state = await f.service.update(f.guard.ownerId, f.guard.workspaceId, {
      ...resolutionMutation(state),
      action: "pause",
    });
    expect(state.status).toBe("paused");
    expect(
      f.db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(f.guard.workspaceId),
    ).toEqual({ revision: f.guard.expectedRevision + 1 });
    expect((await f.record())?.workspaceRevision).toBe(f.guard.expectedRevision + 1);
  } finally {
    f.db.sqlite.close();
  }
});
test("owner/deletion/fresh authorization checks precede private source loading", async () => {
  const f = await fixture();
  try {
    await expect(f.service.get("other-owner", f.guard.workspaceId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(f.loads).toBe(0);
    f.runtime.authorize = async () => false;
    await expect(f.service.get(f.guard.ownerId, f.guard.workspaceId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(f.loads).toBe(0);
    f.runtime.authorize = async () => true;
    f.db.sqlite.query("DELETE FROM v2_workspaces WHERE id=?").run(f.guard.workspaceId);
    await expect(f.service.get(f.guard.ownerId, f.guard.workspaceId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(f.loads).toBe(0);
  } finally {
    f.db.sqlite.close();
  }
});
test("the adapter rejects forged public revisions and ignores source-supplied stored state", async () => {
  const f = await fixture();
  try {
    const initial = await f.service.get(f.guard.ownerId, f.guard.workspaceId);
    f.runtime.loadSource = async () => ({
      ...resolutionSource(),
      stored: { ...initial, selection: "lawyer" },
    });
    expect((await f.deps.load(f.guard.ownerId, f.guard.workspaceId)).stored).toBeNull();
    expect(
      await f.deps.saveCAS(f.guard.ownerId, f.guard.workspaceId, {
        expectedRevision: initial.revision,
        basis: initial.basis,
        state: { ...initial, revision: initial.revision + 2 },
      }),
    ).toBe(false);
    expect(await f.record()).toBeNull();
  } finally {
    f.db.sqlite.close();
  }
});
test("root mutation receipts publish with the exact record in the same authority-fenced claim", async () => {
  const f = await fixture();
  try {
    f.db.sqlite.exec(
      "CREATE TABLE resolution_test_receipts(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,record_revision INTEGER NOT NULL)",
    );
    f.runtime.publicationStatements = (claimId, recordId, revision) => [
      f.core.statement(
        `INSERT INTO resolution_test_receipts(id,record_id,record_revision) SELECT ?,?,? WHERE ${sqlClaim}`,
        ["receipt", recordId, revision, claimId],
      ),
    ];
    const initial = await f.service.get(f.guard.ownerId, f.guard.workspaceId);
    const input = {
      ...resolutionMutation(initial),
      action: "select",
      choice: "self",
      selectedFileIds: initial.selectedFileIds,
      maskIdentifiers: true,
    };
    f.runtime.publicationAuthority = async () => ({ sql: "0", values: [] });
    await expect(
      f.service.update(f.guard.ownerId, f.guard.workspaceId, input),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(f.db.sqlite.query("SELECT count(*) count FROM resolution_test_receipts").get()).toEqual({
      count: 0,
    });
    f.runtime.publicationAuthority = async () => ({ sql: "1", values: [] });
    const next = await f.service.update(f.guard.ownerId, f.guard.workspaceId, input);
    const record = await f.record();
    expect(next.revision).toBe(2);
    expect(record).not.toBeNull();
    expect(
      f.db.sqlite.query("SELECT record_id,record_revision FROM resolution_test_receipts").get(),
    ).toEqual({ record_id: record?.id, record_revision: record?.revision });
    await expect(
      f.service.update(f.guard.ownerId, f.guard.workspaceId, input),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(f.db.sqlite.query("SELECT count(*) count FROM resolution_test_receipts").get()).toEqual({
      count: 1,
    });
  } finally {
    f.db.sqlite.close();
  }
});
