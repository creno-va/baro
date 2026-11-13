import { afterEach, expect, test } from "bun:test";
import { caseDisplayTitle } from "../src/contracts/v2";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { sourceDigest } from "../src/server/modules/reports/source";
import { reportFixture } from "./helpers/report-fixture";

const fixtures: Awaited<ReturnType<typeof reportFixture>>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.db.close();
});
async function fixture() {
  const f = await reportFixture();
  fixtures.push(f);
  return f;
}
async function rename(f: Awaited<ReturnType<typeof fixture>>, title: string) {
  const workspace = createV2WorkspaceRepository(f.core.binding, f.core.cipher);
  const metadata = await workspace.metadata(f.actor, f.workspaceId);
  if (!metadata) throw new Error("Missing synthetic case metadata");
  expect(
    await workspace.rename(
      { ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() },
      title,
      caseDisplayTitle(metadata.narrative, metadata.caseTitle),
      {
        operationId: crypto.randomUUID(),
        key: crypto.randomUUID(),
        requestHash: "a".repeat(64),
        route: `/api/v2/cases/${f.workspaceId}/title`,
        kind: "chat",
      },
    ),
  ).toBe(true);
}

test("new snapshots pin the custom case title; rename does not rewrite saved titles, source digest or PDF", async () => {
  const f = await fixture();
  await rename(f, "합성 반환 약정 · 첫 사건명");
  const before = await sourceDigest(f.core, f.actor, f.workspaceId);
  const first = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const pdf = await f.reports.pdf(f.actor.ownerId, first.id);
  const bytes = await new Response(pdf.body).arrayBuffer();
  expect(first.title).toBe("합성 반환 약정 · 첫 사건명");
  await rename(f, "합성 상대 주장 검토 · 바꾼 사건명");
  // A display-name change alone is not a new legal/factual basis. Generation
  // pins W instead of changing legacy source-digest bytes or stale semantics.
  expect(await sourceDigest(f.core, f.actor, f.workspaceId)).toBe(before);
  const saved = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(saved.title).toBe(first.title);
  expect(saved.content).toBe(first.content);
  expect(saved.stale).toBe(false);
  expect(await f.reports.html(f.actor.ownerId, first.id)).toContain(first.title);
  const retained = await f.reports.pdf(f.actor.ownerId, first.id);
  expect(await new Response(retained.body).arrayBuffer()).toEqual(bytes);
  const next = await f.reports.generate(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: first.revision,
  });
  expect(next.title).toBe("합성 상대 주장 검토 · 바꾼 사건명");
  expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).title).toBe(next.title);
});

for (const timing of ["title_decrypt", "final_publication"] as const) {
  test(`rename during ${timing} cannot publish a title from a different workspace revision`, async () => {
    const f = await fixture();
    await rename(f, "처음 이름");
    const decrypt = f.core.decrypt;
    const encrypt = f.core.encrypt;
    let intakeReads = 0;
    let changed = false;
    const change = async () => {
      if (!changed) {
        changed = true;
        await rename(f, "생성 중 바뀐 이름");
      }
    };
    f.core.decrypt = async (...args) => {
      const value = await decrypt(...args);
      if (args[0] === "v2_intakes" && ++intakeReads === 1 && timing === "title_decrypt")
        await change();
      return value;
    };
    f.core.encrypt = async (...args) => {
      const value = await encrypt(...args);
      if (args[0] === "v2_reports" && timing === "final_publication") await change();
      return value;
    };
    await expect(f.reports.get(f.actor.ownerId, f.workspaceId)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(changed).toBe(true);
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_reports").get()).toEqual({ n: 0 });
    f.core.decrypt = decrypt;
    f.core.encrypt = encrypt;
    expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).title).toBe("생성 중 바뀐 이름");
  });
}

test("masking removes identifiers from the generated case title in HTML without rewriting the stored original", async () => {
  const f = await fixture();
  await rename(f, "합성 사건 010-1234-5678");
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const masked = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: report.revision,
    content: report.content,
    excludedFileIds: [],
    maskIdentifiers: true,
  });
  expect(masked.title).not.toContain("010-1234-5678");
  expect(await f.reports.html(f.actor.ownerId, masked.id)).not.toContain("010-1234-5678");
  expect(await f.reports.html(f.actor.ownerId, report.id)).toContain("010-1234-5678");
});
