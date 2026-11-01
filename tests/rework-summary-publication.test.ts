import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { v2SummarySchema } from "../src/contracts/v2";
import { createV2ReworkRepository } from "../src/server/db/v2-rework";
import { prepareReconciledSummary } from "../src/server/db/v2-rework-summary";
import {
  confirmCustomerSummary,
  customerWorkspaceFixture,
  runCustomerJob,
} from "./helpers/customer-workspace";

const fixtures: Awaited<ReturnType<typeof customerWorkspaceFixture>>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture(confirm = true) {
  const f = await customerWorkspaceFixture();
  fixtures.push(f);
  await runCustomerJob(f, "intake_questions");
  const intake = await f.service.intake(f.owner.userId, f.workspace.id);
  if (!intake?.batches[0]?.questions[0]) throw new Error("fixture");
  await f.service.answers(f.owner.userId, f.workspace.id, crypto.randomUUID(), {
    expectedRevision: intake.revision,
    answers: [{ questionId: intake.batches[0].questions[0].id, status: "unknown" }],
  });
  await runCustomerJob(f, "intake_summary");
  const workspace = confirm
    ? await confirmCustomerSummary(f)
    : await f.service.find(f.owner.userId, f.workspace.id);
  const before = (
    await f.repository.readIntake({ ownerId: f.owner.userId, now: f.now }, f.workspace.id)
  )?.summary;
  if (!before) throw new Error("fixture summary");
  const g = {
    ownerId: f.owner.userId,
    now: f.now,
    workspaceId: f.workspace.id,
    expectedRevision: workspace.workspaceRevision,
  };
  const firstFact = before.facts[0];
  if (!firstFact) throw new Error("fixture fact");
  const after = v2SummarySchema.parse({
    ...before,
    revision: before.revision + 1,
    overview: "사용자가 변경안을 확인한 새로운 요약",
    facts: Array.from({ length: 110 }, (_, i) => ({
      ...firstFact,
      id: `fact_${i}`,
      text: `사용자가 설명한 합성 사실 ${i}. `.repeat(30),
    })),
  });
  return {
    ...f,
    g,
    before,
    after,
    records: createV2ReworkRepository(f.core, { clock: () => f.now }),
  };
}
test("a large reconciliation publishes the canonical summary and confirmation receipt atomically while preserving the prior version", async () => {
  const f = await fixture();
  const input = {
    snapshotId: crypto.randomUUID(),
    beforeRevision: f.before.revision,
    summary: f.after,
    authority: { sql: "1", values: [] },
  };
  const prepared = await prepareReconciledSummary(f.core, f.g, input);
  expect(prepared).not.toBeNull();
  expect((await f.repository.readIntake(f.g, f.workspace.id))?.summary).toEqual(f.before);
  // An interrupted confirmation can reuse its already sealed exact candidate.
  const resumed = await prepareReconciledSummary(f.core, f.g, input);
  expect(resumed).not.toBeNull();
  if (!resumed) throw new Error("missing sealed candidate");
  const schema = z.strictObject({ confirmedSummaryRevision: z.number() });
  const receipt = await f.records.write(f.g, {
    kind: "reconciliation",
    expectedVersion: 0,
    schema,
    value: { confirmedSummaryRevision: f.after.revision },
    bumpWorkspace: true,
    ...resumed,
  });
  expect(receipt?.value.confirmedSummaryRevision).toBe(f.after.revision);
  const next = await f.repository.readIntake(f.g, f.workspace.id);
  expect(next?.status).toBe("confirmed");
  expect(next?.summary).toEqual(f.after);
  expect((await f.repository.findWorkspace(f.g, f.workspace.id))?.workspaceRevision).toBe(
    f.g.expectedRevision + 1,
  );
  expect(f.db.sqlite.query("SELECT revision FROM v2_summaries ORDER BY revision").all()).toEqual([
    { revision: 1 },
    { revision: 2 },
  ]);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_facts WHERE summary_revision=2").get(),
  ).toEqual({ n: 110 });
});
test("reconciliation can replace the first reviewing summary and activate it only with the user's confirmation", async () => {
  const f = await fixture(false);
  expect((await f.repository.readIntake(f.g, f.workspace.id))?.status).toBe("reviewing_summary");
  const prepared = await prepareReconciledSummary(f.core, f.g, {
    snapshotId: crypto.randomUUID(),
    beforeRevision: f.before.revision,
    summary: f.after,
    authority: { sql: "1", values: [] },
  });
  if (!prepared) throw new Error("missing first candidate");
  expect(
    (await f.repository.findWorkspace(f.g, f.workspace.id))?.confirmedSummaryRevision,
  ).toBeNull();
  expect(
    await f.records.write(f.g, {
      kind: "reconciliation",
      expectedVersion: 0,
      schema: z.object({ ok: z.boolean() }),
      value: { ok: true },
      bumpWorkspace: true,
      ...prepared,
    }),
  ).not.toBeNull();
  expect(await f.repository.findWorkspace(f.g, f.workspace.id)).toMatchObject({
    status: "active",
    confirmedSummaryRevision: f.after.revision,
  });
  expect(await f.repository.readIntake(f.g, f.workspace.id)).toMatchObject({
    status: "confirmed",
    confirmedSummaryRevision: f.after.revision,
  });
});
for (const changed of ["consent", "revision", "proposal"] as const)
  test(`confirmation cannot publish after ${changed} changes during staging`, async () => {
    const f = await fixture();
    const prepared = await prepareReconciledSummary(f.core, f.g, {
      snapshotId: crypto.randomUUID(),
      beforeRevision: f.before.revision,
      summary: f.after,
      authority: { sql: "w.status='active'", values: [] },
    });
    expect(prepared).not.toBeNull();
    if (!prepared) throw new Error("missing candidate");
    if (changed === "consent")
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.owner.userId);
    if (changed === "revision")
      f.db.sqlite
        .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
        .run(f.workspace.id);
    if (changed === "proposal")
      f.db.sqlite
        .query("UPDATE v2_workspaces SET status='archived' WHERE id=?")
        .run(f.workspace.id);
    expect(
      await f.records.write(f.g, {
        kind: "reconciliation",
        expectedVersion: 0,
        schema: z.object({ ok: z.boolean() }),
        value: { ok: true },
        bumpWorkspace: true,
        ...prepared,
      }),
    ).toBeNull();
    expect(f.db.sqlite.query("SELECT revision FROM v2_summaries").all()).toEqual([{ revision: 1 }]);
    expect(
      f.db.sqlite.query("SELECT count(*) n FROM v2_rework_records WHERE state='published'").get(),
    ).toEqual({ n: 0 });
  });

test("a cancelled older staging candidate cannot block a later reviewed proposal", async () => {
  const f = await fixture();
  expect(
    await prepareReconciledSummary(f.core, f.g, {
      snapshotId: crypto.randomUUID(),
      beforeRevision: f.before.revision,
      summary: f.after,
      authority: { sql: "1", values: [] },
    }),
  ).not.toBeNull();
  f.db.sqlite.query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?").run(f.workspace.id);
  const g = { ...f.g, expectedRevision: f.g.expectedRevision + 1 };
  const next = {
    ...f.after,
    overview: "사용자가 다시 검토한 변경안",
    facts: f.after.facts.map((fact) => ({ ...fact, text: `새로 확인한 내용: ${fact.text}` })),
  };
  const prepared = await prepareReconciledSummary(f.core, g, {
    snapshotId: crypto.randomUUID(),
    beforeRevision: f.before.revision,
    summary: next,
    authority: { sql: "1", values: [] },
  });
  expect(prepared).not.toBeNull();
  if (!prepared) throw new Error("missing newer candidate");
  expect(
    await f.records.write(g, {
      kind: "reconciliation",
      expectedVersion: 0,
      schema: z.object({ ok: z.boolean() }),
      value: { ok: true },
      bumpWorkspace: true,
      ...prepared,
    }),
  ).not.toBeNull();
  expect((await f.repository.readIntake(g, f.workspace.id))?.summary?.overview).toBe(next.overview);
});
