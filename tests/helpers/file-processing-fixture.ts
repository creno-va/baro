/** Explicit offline fixture: real SQLite + real AES + R2 test adapter.
 * No configured active paid control and no actual provider proof/smoke is claimed. */
import { afterEach } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { CURRENT_POLICY_VERSIONS } from "../../src/contracts/consent";
import { V2_LIMITS } from "../../src/contracts/v2";
import { createCaseDataCipher } from "../../src/server/crypto";
import { createV2AccountingRepository } from "../../src/server/db/v2-accounting";
import { createV2Core } from "../../src/server/db/v2-core";
import { hex } from "../../src/server/modules/files/binary";
import {
  createFilesService,
  type FileServiceDependencies,
  type PrivateBucket,
} from "../../src/server/modules/files/service";
import { createTestDatabase } from "./d1";
import { seedTestSession } from "./session";

const NOW = "2026-10-06T00:00:00.000Z";
const dbs: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});
function r2() {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const calls = { get: 0, put: 0, delete: 0 };
  let putHook: (() => Promise<void>) | undefined;
  let getHook: (() => Promise<void>) | undefined;
  let deleteFails = false;
  let putAmbiguous = false;
  let wrongReceipt = false;
  const port = {
    async put(key: string, value: Uint8Array<ArrayBuffer>) {
      calls.put++;
      objects.set(key, value.slice());
      await putHook?.();
      if (putAmbiguous) throw new Error("synthetic transport");
      return { key, size: value.byteLength + (wrongReceipt ? 1 : 0) };
    },
    async get(key: string) {
      calls.get++;
      await getHook?.();
      const value = objects.get(key);
      return value ? { key, size: value.byteLength, body: new Response(value.slice()).body } : null;
    },
    async head(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength } : null;
    },
    async delete(key: string) {
      calls.delete++;
      if (deleteFails) throw new Error("synthetic delete");
      objects.delete(key);
    },
  } as unknown as PrivateBucket;
  return {
    port,
    objects,
    calls,
    setPutHook(h: () => Promise<void>) {
      putHook = h;
    },
    setGetHook(h: () => Promise<void>) {
      getHook = h;
    },
    setDeleteFails(v: boolean) {
      deleteFails = v;
    },
    setPutAmbiguous(v: boolean) {
      putAmbiguous = v;
    },
    setWrongReceipt(v: boolean) {
      wrongReceipt = v;
    },
  };
}
export async function fixture(
  overrides: Partial<FileServiceDependencies> = {},
  disabled: { admission?: true; probe?: true } = {},
) {
  const db = await createTestDatabase();
  dbs.push(db);
  const owner = await seedTestSession(db, { now: Date.parse(NOW), consent: true });
  const cipher = await createCaseDataCipher({
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
  });
  const core = createV2Core(db.binding, cipher);
  const actor = { ownerId: owner.userId, now: NOW };
  await createV2AccountingRepository(core).ensurePrincipal(actor);
  const workspaceId = crypto.randomUUID();
  const payload = await core.encrypt("v2_workspaces", workspaceId, actor.ownerId, 1, {
    subjectContext: "individual",
    jurisdiction: "KR",
  });
  db.sqlite
    .query(
      "INSERT INTO v2_workspaces(id,owner_id,status,confirmed_summary_revision,encrypted_payload,created_at,updated_at) VALUES(?,?,'active',1,?,?,?)",
    )
    .run(workspaceId, actor.ownerId, payload, NOW, NOW);
  db.sqlite.query("INSERT INTO v2_case_original_usage(workspace_id) VALUES(?)").run(workspaceId);
  const bucket = r2();
  let currentNow = NOW;
  const deps: FileServiceDependencies = {
    environment: "preview",
    bucket: bucket.port,
    clock: () => currentNow,
    testOnlyUnmeteredStorage: true,
    probe: async (input) => ({
      category: "document",
      format: "txt",
      byteLength: input.byteLength,
      pageCount: 1,
    }),
    ...overrides,
  };
  if (disabled.admission) delete deps.testOnlyUnmeteredStorage;
  if (disabled.probe) delete deps.probe;
  const service = createFilesService(core, deps);
  const rev = () =>
    Number(
      (
        db.sqlite.query("SELECT revision FROM v2_workspaces WHERE id=?").get(workspaceId) as {
          revision: number;
        }
      ).revision,
    );
  return {
    db,
    core,
    actor,
    workspaceId,
    bucket,
    service,
    rev,
    setNow(v: string) {
      currentNow = v;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function reserved(
  f: Fixture,
  bytes: number,
  name = "합성💙 자료.txt",
  key = crypto.randomUUID(),
) {
  return f.service.reserve(f.actor.ownerId, f.workspaceId, f.rev(), key, {
    name,
    byteLength: bytes,
    mediaType: "text/plain",
    autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
  });
}
export async function uploaded(f: Fixture, bytes = new TextEncoder().encode("synthetic original")) {
  const session = await reserved(f, bytes.byteLength);
  const parts = [];
  for (let index = 0; index < Math.ceil(bytes.byteLength / V2_LIMITS.chunkBytes); index++) {
    const chunk = bytes.slice(index * V2_LIMITS.chunkBytes, (index + 1) * V2_LIMITS.chunkBytes);
    parts.push(
      await f.service.putPart(
        f.actor.ownerId,
        f.workspaceId,
        session.fileId,
        session.uploadSession,
        index,
        new Response(chunk).body,
      ),
    );
  }
  const manifest = { byteLength: bytes.byteLength, contentHash: hex(sha256(bytes)), parts };
  const complete = await f.service.complete(f.actor.ownerId, f.workspaceId, session.fileId, {
    expectedRevision: f.rev(),
    uploadSession: session.uploadSession,
    manifest,
  });
  return { session, bytes, manifest, complete };
}
