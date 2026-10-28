import { expect, test } from "bun:test";
import { createFilesApi } from "../src/client/api/files";
import { createWorkspaceApi } from "../src/client/api/workspace";
import type { V2Derivative, V2FileObservation } from "../src/contracts/v2";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { createV2Core } from "../src/server/db/v2-core";
import {
  readWorkspaceFile,
  readWorkspaceFileCoverage,
} from "../src/server/modules/files/workspace-read";
import { countD1Calls } from "./helpers/d1-call-count";
import { readyFile } from "./helpers/report-fixture";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

type Fixture = Awaited<ReturnType<typeof reportHttpFixture>>;
async function addObservations(f: Fixture, start: number, end: number) {
  const source = f.db.sqlite
    .query("SELECT revision,coverage_snapshot_id FROM v2_files WHERE id=?")
    .get(f.selectedFileId) as { revision: number; coverage_snapshot_id: string };
  for (let ordinal = start; ordinal < end; ordinal++) {
    const id = crypto.randomUUID(),
      entityId = crypto.randomUUID();
    const value: V2FileObservation = {
      id: entityId,
      text: `합성 관측 ${ordinal} END_${ordinal}`,
      position: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
      certainty: "observed",
      userEdited: false,
      included: true,
    };
    const payload = await f.core.encrypt(
      "v2_file_observations",
      id,
      f.actor.ownerId,
      source.revision,
      value,
    );
    f.db.sqlite
      .query(
        "INSERT INTO v2_file_observations(id,entity_id,file_id,revision,file_revision,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        entityId,
        f.selectedFileId,
        source.revision,
        source.revision,
        ordinal,
        payload,
        source.coverage_snapshot_id,
      );
  }
}
function transport(f: Fixture, cookie = f.cookie) {
  return async (path: string, init?: RequestInit) =>
    f.app.request(
      path,
      {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init?.headers)), cookie },
      },
      f.env,
    );
}
const path = (f: Fixture) => `/api/v2/cases/${f.workspaceId}/files/${f.selectedFileId}`;

test("large observations keep compact bound while workspace reads metadata and report lists read coverage", async () => {
  const f = await reportHttpFixture();
  f.app.route("/api/v2/cases", createWorkspacesApi());
  for (let i = 0; i < 4; i++) await readyFile(f, `합성 추가 원본 ${i}`);
  await addObservations(f, 0, 8);
  const call = transport(f);
  expect((await call(path(f))).status).toBe(200);
  const meter = countD1Calls(f.db.binding),
    core = createV2Core(meter.binding, f.core.cipher);
  expect(
    (await readWorkspaceFile(core, f.actor.ownerId, f.workspaceId, f.selectedFileId)).observations,
  ).toHaveLength(8);
  const compact = { ...meter.work };
  meter.reset();
  const reads: string[] = [];
  meter.before((sql) => reads.push(...sql));
  expect(
    await readWorkspaceFileCoverage(core, f.actor.ownerId, f.workspaceId, f.selectedFileId),
  ).toMatchObject({
    id: f.selectedFileId,
    revision: 2,
    status: "ready",
    coverage: { pageCount: 1 },
  });
  expect(meter.work).toEqual({ calls: 7, statements: 7 });
  expect(compact).toEqual({ calls: 14, statements: 14 });
  expect(reads.some((sql) => /v2_file_observations|v2_file_derivatives|v2_blobs/.test(sql))).toBe(
    false,
  );
  await addObservations(f, 8, 11);
  await expect(
    readWorkspaceFile(core, f.actor.ownerId, f.workspaceId, f.selectedFileId),
  ).rejects.toMatchObject({ code: "SNAPSHOT_STREAM_REQUIRED" });
  const defaultDetail = await call(path(f));
  expect(defaultDetail.status).toBe(500);
  expect(await defaultDetail.json()).toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  const projected = await call(`${path(f)}?view=coverage`);
  expect(projected.status).toBe(200);
  expect(projected.headers.get("cache-control")).toBe("private, no-store");
  expect(Object.keys(await projected.json()).sort()).toEqual([
    "coverage",
    "id",
    "revision",
    "status",
  ]);
  const client = createWorkspaceApi(call);
  const workspace = await client.get(f.workspaceId);
  expect(workspace.files).toHaveLength(6);
  expect(workspace.files.find((file) => file.id === f.selectedFileId)).toMatchObject({
    extractedText: "",
    coverage: "자료 확인에서 처리 범위를 확인할 수 있어요.",
  });
  expect((await client.getFiles(f.workspaceId)).files).toHaveLength(6);
  const files = createFilesApi(call);
  expect(await files.list(f.workspaceId)).toHaveLength(6); // ReportReview's list path.
  let after = -1,
    count = 0,
    pages = 0;
  do {
    const page = await files.review(f.workspaceId, f.selectedFileId, after);
    count += page.observations.length;
    pages++;
    if (page.nextAfterOrdinal === null) break;
    after = page.nextAfterOrdinal;
  } while (pages < 4);
  expect([count, pages]).toEqual([11, 3]);
  const report = await f.reports.get(f.actor.ownerId, f.workspaceId);
  expect(report.content).toContain("포함한 추출 내용 11개");
  for (let i = 0; i < 11; i++) expect(report.content).not.toContain(`END_${i}`);
  expect(
    f.db.sqlite
      .query("SELECT count(*) AS n FROM v2_file_observations WHERE file_id=? AND file_revision=2")
      .get(f.selectedFileId),
  ).toEqual({ n: 11 });
  const original = await files.original(f.workspaceId, f.selectedFileId);
  expect(await original.text()).toBe(f.original);
});

test("derivatives alone above eight preserve compact bound and do not block coverage lists", async () => {
  const f = await reportHttpFixture();
  f.app.route("/api/v2/cases", createWorkspacesApi());
  const file = await readWorkspaceFile(f.core, f.actor.ownerId, f.workspaceId, f.selectedFileId);
  const manifest = file.manifest;
  if (!manifest) throw new Error("Synthetic file manifest missing");
  const source = f.db.sqlite
    .query("SELECT coverage_snapshot_id FROM v2_files WHERE id=?")
    .get(f.selectedFileId) as { coverage_snapshot_id: string };
  // Read-contract fixture only: derivative metadata reuses the fixture's stored
  // text bytes. This does not assert processing or physical derivative provenance.
  const blob = f.db.sqlite.query("SELECT id FROM v2_blobs WHERE state='stored' LIMIT 1").get() as {
    id: string;
  };
  const add = async (ordinal: number) => {
    const id = crypto.randomUUID(),
      value: V2Derivative = {
        id: crypto.randomUUID(),
        kind: "extracted_text",
        byteLength: file.byteLength,
        contentHash: manifest.contentHash,
        sourcePosition: { kind: "document", page: 1, paragraph: ordinal + 1, table: null },
      };
    const payload = await f.core.encrypt(
      "v2_file_derivatives",
      id,
      f.actor.ownerId,
      file.revision,
      value,
    );
    f.db.sqlite
      .query(
        "INSERT INTO v2_file_derivatives(id,entity_id,file_id,file_revision,kind,blob_id,ordinal,encrypted_payload,snapshot_id) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        value.id,
        file.id,
        file.revision,
        value.kind,
        blob.id,
        ordinal,
        payload,
        source.coverage_snapshot_id,
      );
  };
  for (let ordinal = 0; ordinal < 8; ordinal++) await add(ordinal);
  const compact = await readWorkspaceFile(f.core, f.actor.ownerId, f.workspaceId, file.id);
  expect(compact.observations).toHaveLength(0);
  expect(compact.derivatives).toHaveLength(8);
  await add(8);
  await expect(
    readWorkspaceFile(f.core, f.actor.ownerId, f.workspaceId, file.id),
  ).rejects.toMatchObject({ code: "SNAPSHOT_STREAM_REQUIRED" });
  const call = transport(f);
  expect((await call(path(f))).status).toBe(500);
  expect((await call(`${path(f)}?view=coverage`)).status).toBe(200);
  expect(await createFilesApi(call).list(f.workspaceId)).toHaveLength(2);
  expect((await createWorkspaceApi(call).get(f.workspaceId)).files).toHaveLength(2);
});

test("coverage projection has strict query, session, owner, workspace and existing read consent rules", async () => {
  const f = await reportHttpFixture(),
    call = transport(f);
  for (const query of ["view=full", "view=coverage&extra=1", "view="])
    expect((await call(`${path(f)}?${query}`)).status).toBe(400);
  expect((await transport(f, "")(`${path(f)}?view=coverage`)).status).toBe(401);
  const other = await seedTestSession(f.db, { consent: true });
  expect((await transport(f, other.cookie)(`${path(f)}?view=coverage`)).status).toBe(404);
  expect(
    (await call(`${path(f).replace(f.workspaceId, crypto.randomUUID())}?view=coverage`)).status,
  ).toBe(404);
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  expect((await call(`${path(f)}?view=coverage`)).status).toBe(200);
});

for (const change of [
  "owner",
  "workspace_delete",
  "account_delete",
  "file_delete",
  "revision",
  "coverage",
  "state",
  "metadata",
] as const)
  test(`coverage projection rejects ${change} during snapshot decryption`, async () => {
    const f = await reportHttpFixture(),
      other = await seedTestSession(f.db);
    let changed = false;
    const core = createV2Core(f.db.binding, {
      ...f.core.cipher,
      decrypt: async (input, context) => {
        const text = await f.core.cipher.decrypt(input, context);
        if (changed || context.table !== "v2_private_parts") return text;
        changed = true;
        if (change === "owner")
          f.db.sqlite
            .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
            .run(other.userId, f.workspaceId);
        else if (change.endsWith("_delete")) {
          const kind = change.slice(0, -7),
            id =
              kind === "account"
                ? f.actor.ownerId
                : kind === "workspace"
                  ? f.workspaceId
                  : f.selectedFileId;
          f.db.sqlite.query("INSERT INTO v2_tombstones VALUES(?,?,?)").run(kind, id, f.actor.now);
        } else if (change === "revision")
          f.db.sqlite
            .query("UPDATE v2_files SET revision=revision+1 WHERE id=?")
            .run(f.selectedFileId);
        else if (change === "coverage")
          f.db.sqlite
            .query(
              "UPDATE v2_files SET coverage_snapshot_id=(SELECT coverage_snapshot_id FROM v2_files WHERE id<>? AND state='ready' LIMIT 1) WHERE id=?",
            )
            .run(f.selectedFileId, f.selectedFileId);
        else if (change === "metadata")
          f.db.sqlite
            .query("UPDATE v2_files SET encrypted_payload='replaced' WHERE id=?")
            .run(f.selectedFileId);
        else
          f.db.sqlite
            .query("UPDATE v2_files SET state='processing' WHERE id=?")
            .run(f.selectedFileId);
        return text;
      },
    });
    await expect(
      readWorkspaceFileCoverage(core, f.actor.ownerId, f.workspaceId, f.selectedFileId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(changed).toBe(true);
  });

for (const change of [
  "owner",
  "target",
  "purpose",
  "revision",
  "unpublished",
  "oversized",
  "parts",
  "ciphertext",
] as const)
  test(`coverage projection preserves snapshot ${change} guard`, async () => {
    const f = await reportHttpFixture();
    const row = f.db.sqlite
      .query("SELECT revision,encrypted_payload,coverage_snapshot_id FROM v2_files WHERE id=?")
      .get(f.selectedFileId) as {
      revision: number;
      encrypted_payload: string;
      coverage_snapshot_id: string;
    };
    // Published snapshots are immutable. Construct an independent malformed
    // fixture instead of disabling or bypassing their UPDATE triggers.
    const saved = f.db.sqlite
      .query("SELECT * FROM v2_private_snapshots WHERE id=?")
      .get(row.coverage_snapshot_id) as Record<string, string | number | null>;
    const id = crypto.randomUUID(),
      revision = row.revision + 1,
      header: Record<string, string | number | null> = { ...saved, id, revision };
    if (change === "owner") {
      const other = await seedTestSession(f.db);
      header.owner_id = other.userId;
    } else if (change === "target") header.target_id = crypto.randomUUID();
    else if (change === "purpose") header.purpose = "summary";
    else if (change === "revision") header.revision = Number(header.revision) + 1;
    else if (change === "unpublished") header.state = "staging";
    else if (change === "oversized") header.byte_length = 4194305;
    f.db.sqlite
      .query(
        `INSERT INTO v2_private_snapshots(${Object.keys(header).join(",")}) VALUES(${Object.keys(
          header,
        )
          .map(() => "?")
          .join(",")})`,
      )
      .run(...Object.values(header));
    if (change === "ciphertext")
      f.db.sqlite
        .query(
          "INSERT INTO v2_private_parts(id,snapshot_id,part_index,byte_length,encrypted_payload) SELECT ?,?,part_index,byte_length,encrypted_payload FROM v2_private_parts WHERE snapshot_id=?",
        )
        .run(crypto.randomUUID(), id, row.coverage_snapshot_id);
    const metadata = JSON.parse(
      await f.core.cipher.decrypt(row.encrypted_payload, {
        table: "v2_files",
        column: "encrypted_payload",
        rowId: f.selectedFileId,
        userId: f.actor.ownerId,
        revision: row.revision,
      }),
    );
    const encrypted = await f.core.encrypt(
      "v2_files",
      f.selectedFileId,
      f.actor.ownerId,
      revision,
      metadata,
    );
    f.db.sqlite
      .query("UPDATE v2_files SET revision=?,encrypted_payload=?,coverage_snapshot_id=? WHERE id=?")
      .run(revision, encrypted, id, f.selectedFileId);
    await expect(
      readWorkspaceFileCoverage(f.core, f.actor.ownerId, f.workspaceId, f.selectedFileId),
    ).rejects.toBeInstanceOf(Error);
  });

for (const change of [
  "probe_pages",
  "probe_bytes",
  "probe_missing",
  "metadata_cipher",
  "current_job",
] as const)
  test(`coverage projection preserves compact metadata and ready source check: ${change}`, async () => {
    const f = await reportHttpFixture();
    const row = f.db.sqlite
      .query("SELECT revision,encrypted_payload FROM v2_files WHERE id=?")
      .get(f.selectedFileId) as { revision: number; encrypted_payload: string };
    const metadata = JSON.parse(
      await f.core.cipher.decrypt(row.encrypted_payload, {
        table: "v2_files",
        column: "encrypted_payload",
        rowId: f.selectedFileId,
        userId: f.actor.ownerId,
        revision: row.revision,
      }),
    );
    if (change === "probe_pages") metadata.probe.pageCount++;
    if (change === "probe_bytes") metadata.probe.byteLength++;
    if (change === "probe_missing") metadata.probe = null;
    const encrypted =
      change === "metadata_cipher"
        ? "corrupted"
        : await f.core.encrypt(
            "v2_files",
            f.selectedFileId,
            f.actor.ownerId,
            row.revision,
            metadata,
          );
    f.db.sqlite
      .query("UPDATE v2_files SET encrypted_payload=? WHERE id=?")
      .run(encrypted, f.selectedFileId);
    if (change === "current_job") {
      expect(() =>
        f.db.sqlite
          .query("UPDATE v2_files SET current_job_id='synthetic-unexpected-job' WHERE id=?")
          .run(f.selectedFileId),
      ).toThrow("v2_file_ready");
      expect(
        (await readWorkspaceFileCoverage(f.core, f.actor.ownerId, f.workspaceId, f.selectedFileId))
          .status,
      ).toBe("ready");
      return;
    }
    await expect(
      readWorkspaceFile(f.core, f.actor.ownerId, f.workspaceId, f.selectedFileId),
    ).rejects.toBeInstanceOf(Error);
    await expect(
      readWorkspaceFileCoverage(f.core, f.actor.ownerId, f.workspaceId, f.selectedFileId),
    ).rejects.toBeInstanceOf(Error);
  });

for (const change of [
  "id",
  "revision",
  "status",
  "coverage",
  "extra",
  "forbidden",
  "deleted",
  "failed",
] as const)
  test(`file list refuses ${change} coverage result without serving stale ready metadata`, async () => {
    const f = await reportHttpFixture(),
      call = transport(f);
    const client = createFilesApi(async (url, init) => {
      if (!url.includes("?view=coverage")) return call(url, init);
      if (["forbidden", "deleted", "failed"].includes(change))
        return Response.json(
          { error: { code: "NOT_FOUND" } },
          { status: change === "forbidden" ? 403 : change === "deleted" ? 404 : 500 },
        );
      const response = await call(url, init),
        value = (await response.json()) as Record<string, unknown>;
      value[change] =
        change === "id"
          ? "other-file"
          : change === "revision"
            ? 999
            : change === "coverage"
              ? null
              : "processing";
      return Response.json(value);
    });
    await expect(client.list(f.workspaceId)).rejects.toBeInstanceOf(Error);
  });
