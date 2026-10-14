import { expect, test } from "bun:test";
import type { V2File } from "../src/contracts/v2";
import { createV2DeletionRepository } from "../src/server/db/v2-deletion";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import { createV2JobsRepository } from "../src/server/db/v2-jobs";
import { createV2WorkspaceRepository } from "../src/server/db/v2-workspace";
import { uploaded } from "./helpers/file-processing-fixture";
import { reportFixture } from "./helpers/report-fixture";

// Real SQLite/AES publication with synthetic content and the existing R2 adapter.
// These races do not claim native extraction, provider or preview success.
async function fixture() {
  const f = await reportFixture();
  const upload = await uploaded(f);
  const files = createV2FilesRepository(f.core);
  const jobs = createV2JobsRepository(f.core);
  const jobId = crypto.randomUUID();
  const guard = () => ({ ...f.actor, workspaceId: f.workspaceId, expectedRevision: f.rev() });
  expect(
    await jobs.admitFile(guard(), {
      fileId: upload.session.fileId,
      fileRevision: 2,
      jobId,
      admission: {
        operationId: crypto.randomUUID(),
        key: crypto.randomUUID(),
        requestHash: "a".repeat(64),
      },
      quotas: [],
    }),
  ).toBe(true);
  const lease = await jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 120_000).toISOString(),
  );
  const current = await files.read(f.actor, upload.session.fileId);
  if (!lease || !current) throw new Error("Missing synthetic processing file");
  const ready: V2File = {
    ...current,
    revision: current.revision + 1,
    status: "ready",
    currentJobId: null,
    coverage: {
      category: "document",
      status: "complete",
      pageCount: 1,
      pages: [{ page: 1, status: "processed" }],
    },
    observations: [
      {
        id: "synthetic-observation",
        text: "합성 자료의 관측 문구입니다.",
        position: { kind: "document", page: 1, paragraph: null, table: null },
        certainty: "observed",
        userEdited: false,
        included: true,
      },
    ],
    derivatives: [],
  };
  const publish = () => files.writeProcessed(guard(), ready, lease.lease, {});
  const summaryIdentity = () =>
    f.db.sqlite
      .query(
        "SELECT i.summary_id,s.snapshot_id,s.revision,p.encrypted_payload FROM v2_intakes i JOIN v2_summaries s ON s.id=i.summary_id JOIN v2_private_snapshots p ON p.id=s.snapshot_id WHERE i.id=?",
      )
      .get(f.workspaceId);
  return { ...f, files, guard, ready, publish, summaryIdentity };
}

for (const change of ["ready", "delete", "exclude"] as const) {
  test(`summary retains its revision fence when file ${change} leaves the summary snapshot unchanged`, async () => {
    const f = await fixture();
    if (change !== "ready") expect(await f.publish()).toBe(true);
    const before = f.summaryIdentity();
    const revision = f.rev();
    let changed = false;
    const repository = createV2WorkspaceRepository(f.core.binding, {
      ...f.core.cipher,
      decrypt: async (input, context) => {
        const plaintext = await f.core.cipher.decrypt(input, context);
        if (changed || context.table !== "v2_private_parts" || context.targetId !== f.workspaceId)
          return plaintext;
        changed = true;
        if (change === "ready") expect(await f.publish()).toBe(true);
        if (change === "delete")
          expect(
            await createV2DeletionRepository(f.core).file(f.guard(), f.ready.id, f.ready.revision),
          ).toBe(true);
        if (change === "exclude")
          expect(
            await f.files.editObservations(f.guard(), f.ready.id, {
              expectedRevision: f.ready.revision,
              edits: [
                {
                  observationId: "synthetic-observation",
                  text: "합성 자료의 관측 문구입니다.",
                  included: false,
                },
              ],
            }),
          ).toBe(true);
        return plaintext;
      },
    });
    // An incomplete iterator becomes STALE_REVISION in the actual HTTP route.
    // No plaintext is yielded after any of these successful concurrent writes.
    expect(await repository.summaryFragments(f.actor, f.workspaceId).next()).toMatchObject({
      done: true,
    });
    expect(changed).toBe(true);
    expect(f.rev()).toBe(revision + 1);
    expect(f.summaryIdentity()).toEqual(before);
    const file = await f.files.read(f.actor, f.ready.id);
    if (change === "delete") expect(file).toBeNull();
    else {
      expect(file?.status).toBe("ready");
      expect(file?.observations[0]?.included).toBe(change !== "exclude");
    }
    let text = "";
    let complete = false;
    for await (const part of repository.summaryFragments(f.actor, f.workspaceId)) {
      text += part.text;
      complete = part.complete;
    }
    expect(complete).toBe(true);
    expect(JSON.parse(text)).toMatchObject({ revision: 1, facts: [], parties: [] });
  });
}
