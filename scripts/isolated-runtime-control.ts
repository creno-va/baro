import { z } from "zod";
import {
  CaseDataCryptoError,
  createCaseDataCipher,
  type EncryptionContext,
} from "../src/server/crypto";
import { removeWorkflow } from "../src/server/modules/deletion/service";
import type { AnalysisWorkflowParams } from "../src/workflows/analysis";

const configuration = z.object({
  DRILL_ENVIRONMENT: z.literal("isolated-test"),
  DRILL_RUN_ID: z.string().regex(/^\d+-\d+$/),
  RELEASE_SHA: z.string().regex(/^[a-f0-9]{40}$/),
  DRILL_TOKEN: z.string().regex(/^[a-f0-9]{64}$/),
  CASE_DATA_KEY_V1: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  DRILL_EXPIRES_AT: z.iso.datetime(),
  DRILL_PHASE: z.enum(["baseline", "key-lost", "key-restored"]),
});
export type RuntimeDrillConfiguration = z.infer<typeof configuration>;
export type RuntimeDrillParams = AnalysisWorkflowParams & { mode?: "complete" | "wait" };
export interface RuntimeDrillEnv extends RuntimeDrillConfiguration {
  DRILL_BUCKET: R2Bucket;
  ANALYSIS_WORKFLOW: Workflow<RuntimeDrillParams>;
}

const ids = {
  completed: "72a8e3a2-f6ab-4662-95be-88809e7cc301-1",
  active: "72a8e3a2-f6ab-4662-95be-88809e7cc302-1",
  late: "72a8e3a2-f6ab-4662-95be-88809e7cc303-1",
} as const;
const plaintext = "BARO isolated synthetic recovery fixture";
const context: EncryptionContext = {
  table: "v2_private_parts",
  column: "encrypted_payload",
  rowId: "drill-row",
  userId: "drill-survivor",
  revision: 1,
  targetId: "drill-file",
  purpose: "file_manifest",
  part: 0,
};
const keys = {
  survivor: "private/drill-survivor",
  target: "private/drill-target",
  seed: "control/seed-started",
  deletion: "control/delete-started",
  late: "control/late-started",
};

function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
async function equalToken(left: string, right: string) {
  const encode = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(left)));
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", encode.encode(right)));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}
async function absent(env: RuntimeDrillEnv, id: string) {
  try {
    await (await env.ANALYSIS_WORKFLOW.get(id)).status();
    return false;
  } catch (error) {
    if (error instanceof Error && error.message === "instance.not_found") return true;
    throw new Error("WORKFLOW_OBSERVATION_FAILED");
  }
}
async function claim(env: RuntimeDrillEnv, key: string) {
  // R2 conditional writes serialize duplicate control requests, including unknown HTTP outcomes.
  const claimed = await env.DRILL_BUCKET.put(key, "started", {
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!claimed) throw new Error("DRILL_ACTION_ALREADY_STARTED");
}
async function verifyCipher(env: RuntimeDrillEnv) {
  const saved = await env.DRILL_BUCKET.get(keys.survivor);
  if (!saved) throw new Error("RECOVERY_FIXTURE_MISSING");
  const cipher = await createCaseDataCipher(env);
  const envelope = await saved.text();
  const recovered = (await cipher.decrypt(envelope, context)) === plaintext;
  const altered = [
    { ...context, userId: "different-owner" },
    { ...context, revision: 2 },
    { ...context, part: 1 },
  ];
  let rejected = 0;
  for (const binding of altered) {
    try {
      await cipher.decrypt(envelope, binding);
    } catch (error) {
      if (!(error instanceof CaseDataCryptoError) || error.code !== "CRYPTO_DECRYPT_FAILED")
        throw error;
      rejected++;
    }
  }
  return { recovered, rejectedBindings: rejected, keyVersion: "1" };
}

/** No application/OAuth/AI bindings or arbitrary IDs/SQL. Never deployed by product workflows. */
export async function handleRuntimeDrill(request: Request, env: RuntimeDrillEnv) {
  const parsed = configuration.safeParse(env);
  const now = Date.now();
  if (
    !parsed.success ||
    Date.parse(parsed.data.DRILL_EXPIRES_AT) <= now ||
    Date.parse(parsed.data.DRILL_EXPIRES_AT) > now + 60 * 60_000 ||
    request.headers.get("authorization")?.length !== 71 ||
    !(await equalToken(request.headers.get("authorization") ?? "", `Bearer ${env.DRILL_TOKEN}`))
  )
    return reply({ error: "UNAVAILABLE" }, 403);
  const url = new URL(request.url);
  // No query-controlled resource IDs or request payloads are part of this control protocol.
  if (url.search) return reply({ error: "INVALID_REQUEST" }, 400);
  if (request.method !== "POST" || (await request.arrayBuffer()).byteLength !== 0)
    return reply({ error: "INVALID_REQUEST" }, 400);
  try {
    const provenance = {
      candidateSha: env.RELEASE_SHA,
      runId: env.DRILL_RUN_ID,
      phase: env.DRILL_PHASE,
    };
    if (url.pathname === "/ready") return reply(provenance);
    if (url.pathname === "/seed") {
      await claim(env, keys.seed);
      const cipher = await createCaseDataCipher(env);
      await env.DRILL_BUCKET.put(keys.survivor, await cipher.encrypt(plaintext, context));
      await env.DRILL_BUCKET.put(keys.target, await cipher.encrypt(plaintext, context));
      await env.ANALYSIS_WORKFLOW.create({
        id: ids.completed,
        params: { analysisId: ids.completed.slice(0, -2), inputRevision: 1, mode: "complete" },
      });
      await env.ANALYSIS_WORKFLOW.create({
        id: ids.active,
        params: { analysisId: ids.active.slice(0, -2), inputRevision: 1, mode: "wait" },
      });
      return reply({ ...provenance, status: "seeded" });
    }
    if (url.pathname === "/inspect") {
      const status = async (id: string) =>
        (await (await env.ANALYSIS_WORKFLOW.get(id)).status()).status;
      return reply({
        ...provenance,
        completed: await status(ids.completed),
        active: await status(ids.active),
        targetPresent: (await env.DRILL_BUCKET.head(keys.target)) !== null,
        ...(await verifyCipher(env)),
      });
    }
    if (url.pathname === "/delete") {
      // Only delete after observing both a completed and an unfinished platform instance.
      const completed = await (await env.ANALYSIS_WORKFLOW.get(ids.completed)).status();
      const active = await (await env.ANALYSIS_WORKFLOW.get(ids.active)).status();
      if (completed.status !== "complete" || !["waiting", "running"].includes(active.status))
        return reply({ error: "WORKFLOWS_NOT_READY" }, 409);
      await claim(env, keys.deletion);
      await removeWorkflow(env, ids.completed);
      await removeWorkflow(env, ids.active);
      await env.DRILL_BUCKET.delete(keys.target);
      return reply({
        ...provenance,
        completedAbsent: await absent(env, ids.completed),
        activeAbsent: await absent(env, ids.active),
        targetAbsent: (await env.DRILL_BUCKET.head(keys.target)) === null,
        ...(await verifyCipher(env)),
      });
    }
    if (url.pathname === "/late") {
      if (!(await env.DRILL_BUCKET.head(keys.deletion)))
        return reply({ error: "DELETION_REQUIRED" }, 409);
      await claim(env, keys.late);
      // The real platform create finishes after the deletion marker; reuse product cleanup.
      await env.ANALYSIS_WORKFLOW.create({
        id: ids.late,
        params: { analysisId: ids.late.slice(0, -2), inputRevision: 1, mode: "wait" },
      });
      await removeWorkflow(env, ids.late);
      return reply({ ...provenance, lateAbsent: await absent(env, ids.late) });
    }
    if (url.pathname === "/recover") return reply({ ...provenance, ...(await verifyCipher(env)) });
    if (url.pathname === "/cleanup") {
      for (const id of Object.values(ids)) await removeWorkflow(env, id);
      for (const key of Object.values(keys)) await env.DRILL_BUCKET.delete(key);
      return reply({
        ...provenance,
        remainingObjects: (await env.DRILL_BUCKET.list()).objects.length,
      });
    }
    return reply({ error: "NOT_FOUND" }, 404);
  } catch (error) {
    // Never serialize platform errors, keys, ciphertext, headers or bindings.
    if (error instanceof CaseDataCryptoError && error.code === "CRYPTO_DECRYPT_FAILED")
      return reply({ error: "CRYPTO_DECRYPT_FAILED" }, 502);
    return reply({ error: "DRILL_STEP_FAILED" }, 502);
  }
}
