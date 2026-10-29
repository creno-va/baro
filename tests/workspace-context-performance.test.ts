import { expect, test } from "bun:test";
import { fragmentText, utf8Bytes } from "../src/server/db/v2-core";
import { createV2StagingRepository } from "../src/server/db/v2-staging";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { readWorkspaceContext } from "../src/server/modules/workspace/context";
import { reportFixture } from "./helpers/report-fixture";

test("comparison context reads current facts and summary without unrelated chat, files or sources", async () => {
  const f = await reportFixture();
  const original = await readWorkspaceContext(f.core, f.actor, f.workspaceId);
  const reads: string[] = [];
  const prepare = f.db.binding.prepare.bind(f.db.binding);
  f.db.binding.prepare = (sql) => {
    reads.push(sql);
    return prepare(sql);
  };
  const comparison = await readWorkspaceContext(
    f.core,
    f.actor,
    f.workspaceId,
    undefined,
    [],
    "precedent_comparison",
  );
  expect(comparison.facts).toEqual(original.facts);
  expect(comparison.confirmedSummary).toEqual(original.confirmedSummary);
  expect(comparison.calendar).toEqual(original.calendar);
  expect(comparison.contextCoverage?.factsPartial).toBe(original.contextCoverage?.factsPartial);
  expect(comparison.contextCoverage?.summaryPartial).toBe(original.contextCoverage?.summaryPartial);
  expect(comparison.contextCoverage).toMatchObject({
    messagesPartial: true,
    materialsPartial: true,
    sourcesPartial: true,
  });
  expect(
    reads.some((sql) =>
      /FROM v2_(messages|files|material_observations|citation_bindings|actions|timeline_entries)\b/.test(
        sql,
      ),
    ),
  ).toBe(false);
  expect(comparison.messages).toEqual([]);
  expect(comparison.materials).toEqual([]);
  expect(comparison.citations).toEqual([]);
});

for (const bytes of [null, 1048576, 1048577]) {
  test(`context reads a summary once using the correct byte boundary (${bytes ?? "small"})`, async () => {
    const f = await reportFixture();
    const repo = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
    const original = (await repo.readIntake(f.actor, f.workspaceId))?.summary;
    if (!original) throw new Error("Missing synthetic summary");
    if (bytes !== null) {
      original.revision = 2;
      // JSON whitespace pads the encrypted snapshot to an exact UTF-8 byte
      // boundary without changing its content or weakening integrity checks.
      const json = JSON.stringify(original);
      const text = json + " ".repeat(bytes - utf8Bytes(json));
      const parts = fragmentText(text);
      const snapshotId = crypto.randomUUID();
      const staging = createV2StagingRepository(f.core);
      const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
      expect(
        await staging.begin(guard(), {
          id: snapshotId,
          purpose: "summary",
          targetId: f.workspaceId,
          revision: original.revision,
          partCount: parts.length,
          byteLength: bytes,
        }),
      ).toBe(true);
      for (const [index, part] of parts.entries())
        expect(await staging.append(guard(), snapshotId, index, part)).toBe(true);
      expect(
        await staging.seal(guard(), snapshotId, {
          schemaVersion: "2",
          purpose: "summary",
          targetId: f.workspaceId,
          revision: original.revision,
        }),
      ).toBe(true);
      expect(await staging.publish(guard(), snapshotId)).toBe(true);
      f.db.sqlite
        .query("UPDATE v2_summaries SET snapshot_id=?,revision=2 WHERE workspace_id=?")
        .run(snapshotId, f.workspaceId);
      f.db.sqlite
        .query("UPDATE v2_intakes SET confirmed_summary_revision=2 WHERE id=?")
        .run(f.workspaceId);
      f.db.sqlite
        .query("UPDATE v2_workspaces SET confirmed_summary_revision=2 WHERE id=?")
        .run(f.workspaceId);
    }
    const reads: string[] = [];
    const prepare = f.db.binding.prepare.bind(f.db.binding);
    f.db.binding.prepare = (sql) => {
      reads.push(sql);
      return prepare(sql);
    };
    const context = await readWorkspaceContext(f.core, f.actor, f.workspaceId);
    const partial = bytes !== null && bytes > 1048576;
    expect(context.intake.summary?.overview).toBe(original.overview);
    expect(context.intake.summary?.facts).toEqual([]);
    expect(context.contextCoverage).toMatchObject({
      summaryPartial: partial,
      factsPartial: false,
      partiesPartial: false,
    });
    expect(reads.filter((sql) => sql.startsWith("SELECT i.summary_id,s.snapshot_id"))).toHaveLength(
      partial ? 1 : 0,
    );
    expect(
      reads.filter(
        (sql) => sql === "SELECT * FROM v2_private_parts WHERE snapshot_id=? ORDER BY part_index",
      ),
    ).toHaveLength(partial ? 0 : 1);
    if (!partial) expect(context.confirmedSummary).toEqual(original);
    else expect(context.confirmedSummary?.unknowns).not.toEqual(original.unknowns);
  });
}
