import { expect, test } from "bun:test";
import { modelBounds, modelCapabilitySchema } from "../scripts/provision-ai-budget";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { createV2Core } from "../src/server/db/v2-core";
import { createV2FilesRepository } from "../src/server/db/v2-files";
import {
  createV2PaidRuntimeRepository,
  paidHoldRequestSchema,
  processingArtifactScopeSchema,
  runtimeDigest,
} from "../src/server/db/v2-paid-runtime";
import { configuredMediaPolicy } from "../src/server/modules/budget/media-capability";
import { createProcessingBudgetService } from "../src/server/modules/budget/processing-ledger";
import {
  boundedProcessingResources,
  createFileProcessingRuntime,
} from "../src/server/modules/budget/processing-runtime";
import { ProcessingError } from "../src/server/modules/file-processing/protocol";
import { createFileRetry } from "../src/server/modules/file-processing/retry";
import { digest } from "../src/server/modules/files/binary";
import { fileStorageRequestCore } from "../src/server/modules/files/limits";
import { createFileStorageBudget } from "../src/server/modules/files/runtime";
import { createFilesService } from "../src/server/modules/files/service";
import { MODEL_ID } from "../src/server/modules/llm-gateway/prompts";
import { createMediaGateway, WHISPER_MODEL } from "../src/server/modules/llm-gateway/transcription";
import { prepareVisionWire } from "../src/server/modules/llm-gateway/vision-wire";
import { createFileProcessingAdmission } from "../src/server/runtime/file-admission";
import { fixture } from "./helpers/file-processing-fixture";
import observation from "./helpers/gemini-observation";
import { seedTestSession } from "./helpers/session";

/** Canonical runtime/ledger with explicit offline native, R2 and model adapters.
 * No live account vision capability or provider success is asserted. */
async function setupImage(
  options: {
    audio?: boolean;
    video?: boolean;
    videoFrames?: number;
    config?: string;
    result?: unknown;
    reject?: boolean;
    afterModel?: () => void;
  } = {},
) {
  const frameCount = options.videoFrames ?? 1;
  const f = await fixture();
  const core = createV2Core(f.db.binding, f.core.cipher, {
    applicationCostLimitsEnabled: false,
    monthlyBudgetCapEnabled: false,
  });
  f.db.sqlite
    .query(
      "INSERT INTO v2_physical_storage_capacity(environment,capacity_bytes) VALUES('preview',1000000)",
    )
    .run();
  const original = options.audio ? wav() : new Uint8Array([255, 216, 255, 217]);
  const models: string[] = [];
  const wires: Record<string, unknown>[] = [];
  const calls = { probe: 0, process: 0, stop: 0, model: 0 };
  const probe = options.video
    ? {
        category: "video",
        format: "mp4",
        byteLength: original.length,
        durationSeconds: frameCount,
        hasAudio: false,
      }
    : options.audio
      ? { category: "audio", format: "wav", byteLength: original.length, durationSeconds: 1 }
      : { category: "image", format: "jpeg", byteLength: original.length, width: 1, height: 1 };
  const env = {
    APP_ENV: "preview",
    APPLICATION_COST_LIMITS_ENABLED: "false",
    MONTHLY_BUDGET_CAP_ENABLED: "false",
    DB: f.db.binding,
    CASE_DATA_KEY_V1: btoa("k".repeat(32)).replace(/=+$/, ""),
    CASE_PRIVATE_R2: f.bucket.port,
    FILE_PROCESSING: {},
    AI_GATEWAY_ID: "synthetic",
    AI_MODEL_TOKEN_BOUNDS_JSON:
      options.config ??
      JSON.stringify(modelBounds(modelCapabilitySchema.parse(observation), "a".repeat(64))),
    AI: {
      run: async (
        model: string,
        wire: Record<string, unknown>,
        settings: { gateway: { collectLog: boolean; skipCache: boolean } },
      ) => {
        calls.model++;
        models.push(model);
        wires.push(wire);
        expect(settings.gateway.collectLog).toBe(false);
        expect(settings.gateway.skipCache).toBe(true);
        options.afterModel?.();
        if (options.reject) throw new Error("synthetic provider outcome unknown");
        return (
          options.result ??
          (options.audio
            ? {
                text: "synthetic speech",
                segments: [
                  {
                    start: 0,
                    end: 1,
                    text: "synthetic speech",
                    avg_logprob: -0.2,
                    no_speech_prob: 0.1,
                    compression_ratio: 1,
                  },
                ],
              }
            : {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        texts: ["synthetic image observation"],
                        quality: "processed",
                      }),
                    },
                    finish_reason: "stop",
                  },
                ],
              })
        );
      },
    },
    FILE_PROCESSOR: {
      idFromName: (id: string) => id,
      get: () => ({
        stopProcessing: async () => {
          calls.stop++;
        },
        fetch: async (request: Request) => {
          expect(new Uint8Array(await request.arrayBuffer())).toEqual(original);
          if (new URL(request.url).pathname === "/probe") {
            calls.probe++;
            return Response.json({ version: 1, probe });
          }
          calls.process++;
          const contentHash = await digest(original);
          const unit = Number(request.headers.get("x-baro-unit"));
          const manifest = {
            version: 1,
            unit,
            totalUnits: 1,
            frameOffset: 0,
            decodedFrameCount: options.video ? frameCount : 0,
            probe,
            coverage: options.video
              ? {
                  category: "video",
                  durationSeconds: frameCount,
                  status: "partial",
                  hasAudio: false,
                  audio: null,
                  frames: Array.from({ length: frameCount }, (_, index) => ({
                    id: `synthetic-frame-${index}`,
                    timestampSeconds: index,
                    frameIndex: index,
                    sampling: "one_second",
                    status: "missing",
                  })),
                  sceneDetection: "complete",
                  sceneFrameCount: 0,
                }
              : options.audio
                ? {
                    category: "audio",
                    audio: {
                      durationSeconds: 1,
                      status: "partial",
                      intervals: [{ startSeconds: 0, endSeconds: 1, status: "missing" }],
                    },
                  }
                : {
                    category: "image",
                    status: "partial",
                    observation: "missing",
                  },
            artifacts: Array.from({ length: options.video ? frameCount : 1 }, (_, index) => ({
              index,
              kind: options.video ? "frame" : options.audio ? "audio" : "image",
              position: options.video
                ? {
                    kind: "video",
                    timestampSeconds: index,
                    frameIndex: index,
                    sampling: "one_second",
                  }
                : options.audio
                  ? { kind: "audio", startSeconds: 0, endSeconds: 1 }
                  : { kind: "image", region: null },
              byteLength: original.length,
              contentHash,
            })),
            outputBytes: original.length * (options.video ? frameCount : 1),
          };
          return new Response(
            `${[
              { type: "manifest", value: manifest },
              ...manifest.artifacts.map(({ index }) => ({
                type: "artifact",
                index,
                data: btoa(String.fromCharCode(...original)),
              })),
              { type: "complete" },
            ]
              .map((record) => JSON.stringify(record))
              .join("\n")}\n`,
          );
        },
      }),
    },
  } as unknown as Env;
  const service = (part = false) => {
    const requestCore = part ? fileStorageRequestCore(core, false) : core;
    return createFilesService(requestCore, {
      environment: "preview",
      bucket: f.bucket.port,
      paidStorage: createFileStorageBudget(requestCore, "preview", f.actor.ownerId),
      ...createFileProcessingAdmission(requestCore, env),
    });
  };
  const session = await service().reserve(
    f.actor.ownerId,
    f.workspaceId,
    f.rev(),
    crypto.randomUUID(),
    {
      name: options.video ? "synthetic.mp4" : options.audio ? "synthetic.wav" : "synthetic.jpg",
      byteLength: original.length,
      mediaType: options.video ? "video/mp4" : options.audio ? "audio/wav" : "image/jpeg",
      autoProcessConsentVersion: CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    },
  );
  const part = await service(true).putPart(
    f.actor.ownerId,
    f.workspaceId,
    session.fileId,
    session.uploadSession,
    0,
    new Response(original).body,
  );
  const complete = await service().complete(f.actor.ownerId, f.workspaceId, session.fileId, {
    expectedRevision: f.rev(),
    uploadSession: session.uploadSession,
    manifest: { byteLength: original.length, contentHash: await digest(original), parts: [part] },
  });
  expect(complete.processingQueued).toBe(true);
  const job = f.db.sqlite
    .query("SELECT current_job_id AS id,revision FROM v2_files WHERE id=?")
    .get(session.fileId) as { id: string; revision: number };
  const params = {
    ownerId: f.actor.ownerId,
    workspaceId: f.workspaceId,
    fileId: session.fileId,
    fileRevision: job.revision,
    jobId: job.id,
  };
  const execution = await createFileProcessingRuntime(env, params, `${job.id}-1`, () => {});
  return { ...f, core, env, calls, session, params, execution, service, original, models, wires };
}

function wav() {
  const bytes = new Uint8Array(32044),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"));
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, 32000, true);
  return bytes;
}
const signal = () => new AbortController().signal;
async function extracted(f: Awaited<ReturnType<typeof setupImage>>) {
  await f.execution.initialize();
  await f.execution.extractUnit(0, signal());
}
async function publish(f: Awaited<ReturnType<typeof setupImage>>, artifacts = 1) {
  await f.execution.prepareUnit(0, signal());
  const p = await f.execution.preparePublication(1, signal());
  for (let i = 0; i < p.partCount; i++) await f.execution.stageCoveragePart(i, signal());
  for (let artifact = 0; artifact < artifacts; artifact++) {
    const pages = await f.execution.resultPages(0, artifact);
    for (let i = 0; i < pages.pageCount; i++)
      await f.execution.stageResultPage(0, artifact, i, signal());
  }
  await f.execution.publish(signal());
  return createV2FilesRepository(f.core).read(
    { ownerId: f.actor.ownerId, now: new Date().toISOString() },
    f.session.fileId,
  );
}
for (const audio of [false, true])
  test(`canonical ${audio ? "Whisper" : "image"} runtime invokes pinned model and publishes actual synthetic observation`, async () => {
    const f = await setupImage({ audio });
    await extracted(f);
    await f.execution.interpretArtifact(0, 0, signal());
    expect(f.calls.model).toBe(1);
    expect(f.models).toEqual([audio ? WHISPER_MODEL : MODEL_ID]);
    const output = await publish(f);
    expect(output?.observations.map((x) => x.text)).toEqual([
      audio ? "synthetic speech" : "synthetic image observation",
    ]);
    expect(output?.coverage?.category).toBe(audio ? "audio" : "image");
    expect(JSON.stringify(output?.coverage)).toContain('"complete"');
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_proofs").get()).toEqual({ n: 0 });
    expect(f.db.sqlite.query("SELECT count(*) n FROM v2_runtime_usage").get()).toEqual({ n: 0 });
    expect(
      f.db.sqlite
        .query("SELECT state,transport FROM v2_execution_admissions WHERE service=?")
        .get(audio ? "asr" : "model"),
    ).toEqual({ state: "final", transport: "response" });
    if (!audio)
      expect(f.wires[0]).toMatchObject({
        generationConfig: {
          thinkingConfig: { thinkingLevel: "LOW" },
          mediaResolution: "MEDIA_RESOLUTION_LOW",
          maxOutputTokens: 4000,
        },
      });
    const restored = await createV2FilesRepository(f.core).read(
      { ownerId: f.actor.ownerId, now: new Date().toISOString() },
      f.session.fileId,
    );
    expect(restored?.observations).toEqual(output?.observations);
  });
test("missing deployment technical bounds stays missing coverage without a model call", async () => {
  const f = await setupImage({ config: "" });
  await extracted(f);
  await f.execution.interpretArtifact(0, 0, signal());
  const output = await publish(f);
  expect(f.calls.model).toBe(0);
  expect(output?.observations).toEqual([]);
  expect(output?.coverage).toMatchObject({
    category: "image",
    status: "partial",
    observation: "missing",
  });
});
test("provider unknown remains partial and restart makes no second model call", async () => {
  const f = await setupImage({ reject: true });
  await extracted(f);
  await f.execution.interpretArtifact(0, 0, signal());
  const restarted = await createFileProcessingRuntime(
    f.env,
    f.params,
    `${f.params.jobId}-1`,
    () => {},
  );
  await restarted.interpretArtifact(0, 0, signal());
  expect(f.calls.model).toBe(1);
  expect(
    f.db.sqlite
      .query("SELECT state,transport FROM v2_execution_admissions WHERE service='model'")
      .get(),
  ).toEqual({ state: "unknown", transport: "unknown" });
  const output = await publish(f);
  expect(output?.coverage).toMatchObject({ status: "partial", observation: "missing" });
});
test("invalid provider schema fails without publishing invented observations", async () => {
  const f = await setupImage({ result: { choices: [] } });
  await extracted(f);
  await expect(f.execution.interpretArtifact(0, 0, signal())).rejects.toMatchObject({
    code: "MODEL_SCHEMA_INVALID",
  });
  expect(f.calls.model).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_file_observations").get()).toEqual({ n: 0 });
});
for (const revoked of ["consent", "lease", "owner"] as const)
  test(`image ${revoked} fence before model dispatch preserves zero calls`, async () => {
    const f = await setupImage();
    await extracted(f);
    if (revoked === "consent")
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
    if (revoked === "lease")
      f.db.sqlite
        .query("UPDATE v2_jobs SET lease_until='2020-01-01T00:00:00.000Z' WHERE id=?")
        .run(f.params.jobId);
    if (revoked === "owner") {
      const peer = await seedTestSession(f.db, { consent: true });
      f.db.sqlite
        .query("UPDATE v2_workspaces SET owner_id=? WHERE id=?")
        .run(peer.userId, f.workspaceId);
    }
    await expect(f.execution.interpretArtifact(0, 0, signal())).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
    expect(f.calls.model).toBe(0);
  });

test("consent revoked while the model responds suppresses observation publication", async () => {
  let f: Awaited<ReturnType<typeof setupImage>>;
  f = await setupImage({
    afterModel: () =>
      f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId),
  });
  await extracted(f);
  await expect(f.execution.interpretArtifact(0, 0, signal())).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(f.calls.model).toBe(1);
  expect(f.db.sqlite.query("SELECT count(*) n FROM v2_file_observations").get()).toEqual({ n: 0 });
});

test("canonical video frame preserves sampled position and derivative with the same pinned vision path", async () => {
  const f = await setupImage({ video: true });
  await extracted(f);
  await f.execution.interpretArtifact(0, 0, signal());
  const output = await publish(f);
  expect(f.models).toEqual([MODEL_ID]);
  expect(output?.observations[0]).toMatchObject({
    text: "synthetic image observation",
    position: { kind: "video", timestampSeconds: 0, frameIndex: 0, sampling: "one_second" },
    certainty: "uncertain",
  });
  expect(output?.coverage).toMatchObject({
    category: "video",
    status: "complete",
    hasAudio: false,
    frames: [{ timestampSeconds: 0, status: "processed" }],
  });
  expect(output?.derivatives).toHaveLength(1);
  expect(output?.derivatives[0]).toMatchObject({
    kind: "sampled_frame",
    contentHash: await digest(f.original),
  });
});

test("distinct video positions with identical JPEG bytes each retain a logical model invocation", async () => {
  const f = await setupImage({ video: true, videoFrames: 2 });
  await extracted(f);
  await f.execution.interpretArtifact(0, 0, signal());
  expect(f.calls.model).toBe(1);
  await f.execution.interpretArtifact(0, 1, signal());
  expect(f.calls.model).toBe(2);
  expect(f.wires[0]).toEqual(f.wires[1]);
  const journal = f.db.sqlite
    .query(
      "SELECT count(*) n,count(DISTINCT invocation_id) invocations FROM v2_execution_admissions WHERE service='model' AND state='final' AND transport='response'",
    )
    .get();
  expect(journal).toEqual({ n: 2, invocations: 2 });
  const restarted = await createFileProcessingRuntime(
    f.env,
    f.params,
    `${f.params.jobId}-1`,
    () => {},
  );
  await restarted.interpretArtifact(0, 0, signal());
  await restarted.interpretArtifact(0, 1, signal());
  expect(f.calls.model).toBe(2);
  const output = await publish(f, 2);
  expect(output?.coverage).toMatchObject({
    status: "complete",
    frames: [
      { timestampSeconds: 0, status: "processed" },
      { timestampSeconds: 1, status: "processed" },
    ],
  });
  expect(output?.observations.map((x) => x.position)).toMatchObject([
    { timestampSeconds: 0, frameIndex: 0 },
    { timestampSeconds: 1, frameIndex: 1 },
  ]);
});

async function mediaLedger(f: Awaited<ReturnType<typeof setupImage>>) {
  const row = f.db.sqlite
    .query(
      "SELECT payload_json FROM v2_execution_admissions WHERE job_id=? AND service='container' ORDER BY created_at LIMIT 1",
    )
    .get(f.params.jobId) as { payload_json: string };
  const initial = paidHoldRequestSchema.parse(JSON.parse(row.payload_json));
  const policy = configuredMediaPolicy(f.env);
  const budget = createProcessingBudgetService({
    core: f.core,
    environment: "preview",
    ownerId: f.actor.ownerId,
    bounds: (input, hash, now) =>
      input.service === "model"
        ? policy.bounds(input, hash, now)
        : boundedProcessingResources(input, hash, now),
    binding: async (now) => ({
      operationId: initial.plan.operationId,
      operationRevision: initial.plan.operationRevision,
      requestHash: initial.plan.requestHash,
      jobId: f.params.jobId,
      targetKind: "file",
      targetId: f.params.fileId,
      targetRevision: f.params.fileRevision,
      pricingProofId: null,
      fundingProofId: null,
      allocationProofId: null,
      invocationId: `${f.params.jobId}-1`,
      maximumAttempts: 1,
      deadlineAt: new Date(Date.parse(now) + 300000).toISOString(),
    }),
  });
  const wire = prepareVisionWire(f.original);
  const bytes = new TextEncoder().encode(JSON.stringify(wire));
  const input = {
    service: "model" as const,
    action: "vision" as const,
    model: MODEL_ID,
    identity: await digest(bytes),
    byteLength: bytes.length,
    durationSeconds: null,
    wire,
  };
  const lease = await f.execution.currentLease();
  const costs = budget.costs(lease);
  const access = {
    signal: signal(),
    authorize: async () => {
      await f.execution.currentLease();
      return true;
    },
  };
  const gateway = createMediaGateway(f.env, {
    costs,
    waitUntil: () => {},
    visionCapability: policy.visionCapability,
  });
  return { budget, costs, lease, access, input, gateway };
}

for (const state of ["prepared", "dispatched", "unknown", "not_sent", "response"] as const)
  test(`historical unscoped model ${state} cannot fund a new scoped call or rewrite its evidence`, async () => {
    const f = await setupImage({ video: true, videoFrames: 2 });
    await extracted(f);
    const old = await mediaLedger(f);
    if (state === "prepared") {
      const admission = await old.budget.prepareInitial(old.input);
      if (!admission) throw new Error("Synthetic admission missing");
      expect(
        await createV2PaidRuntimeRepository(f.core, "preview").reserveAttempt(
          admission.actor,
          old.lease,
          admission.paid,
        ),
      ).toBe(true);
    } else {
      const permit = await old.costs.before(old.input, old.access);
      if (!permit) throw new Error("Synthetic permit missing");
      if (state !== "dispatched") await old.costs.after(permit, { transport: state });
    }
    const before = f.db.sqlite
      .query("SELECT * FROM v2_execution_admissions WHERE service='model'")
      .all();
    for (const index of [0, 1])
      await expect(f.execution.interpretArtifact(0, index, signal())).rejects.toMatchObject({
        code: "BUDGET_UNAVAILABLE",
      });
    expect(f.calls.model).toBe(0);
    expect(
      f.db.sqlite.query("SELECT * FROM v2_execution_admissions WHERE service='model'").all(),
    ).toEqual(before);
  });

test("model response before checkpoint remains attached to the same position on restart", async () => {
  const f = await setupImage();
  await extracted(f);
  f.bucket.setPutHook(async () => {
    throw new Error("synthetic result-write interruption");
  });
  await expect(f.execution.interpretArtifact(0, 0, signal())).rejects.toBeDefined();
  expect(f.calls.model).toBe(1);
  const before = f.db.sqlite
    .query("SELECT * FROM v2_execution_admissions WHERE service='model'")
    .all();
  expect(before).toMatchObject([{ state: "final", transport: "response" }]);
  f.bucket.setPutHook(async () => {});
  const restarted = await createFileProcessingRuntime(
    f.env,
    f.params,
    `${f.params.jobId}-1`,
    () => {},
  );
  await expect(restarted.interpretArtifact(0, 0, signal())).rejects.toMatchObject({
    code: "BUDGET_UNAVAILABLE",
  });
  expect(f.calls.model).toBe(1);
  expect(
    f.db.sqlite.query("SELECT * FROM v2_execution_admissions WHERE service='model'").all(),
  ).toEqual(before);
});

test("identical audio bytes in distinct server units retain exact wire while replay is blocked", async () => {
  const f = await setupImage({ audio: true });
  await extracted(f);
  const { gateway, access } = await mediaLedger(f);
  await gateway.transcribe(f.original, 0, 1, access, { unit: 0, index: 0 });
  await gateway.transcribe(f.original, 30, 31, access, { unit: 1, index: 0 });
  expect(f.calls.model).toBe(2);
  expect(f.wires[0]).toEqual(f.wires[1]);
  await expect(
    gateway.transcribe(f.original, 0, 1, access, { unit: 0, index: 0 }),
  ).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  await expect(
    gateway.transcribe(f.original, 30, 31, access, { unit: 1, index: 0 }),
  ).rejects.toMatchObject({ code: "BUDGET_UNAVAILABLE" });
  expect(f.calls.model).toBe(2);
  expect(
    f.db.sqlite
      .query(
        "SELECT count(*) n,count(DISTINCT invocation_id) invocations FROM v2_execution_admissions WHERE service='asr' AND state='final'",
      )
      .get(),
  ).toEqual({ n: 2, invocations: 2 });
});

test("scoped unknown keeps both its own replay and an unproven next position blocked", async () => {
  const f = await setupImage({ reject: true });
  await extracted(f);
  const { gateway, access } = await mediaLedger(f);
  await expect(gateway.observe(f.original, access, { unit: 0, index: 0 })).rejects.toMatchObject({
    code: "MODEL_UNAVAILABLE",
  });
  for (const index of [0, 1])
    await expect(gateway.observe(f.original, access, { unit: 0, index })).rejects.toMatchObject({
      code: "BUDGET_UNAVAILABLE",
    });
  expect(f.calls.model).toBe(1);
  expect(
    f.db.sqlite
      .query("SELECT state,transport FROM v2_execution_admissions WHERE service='model'")
      .all(),
  ).toEqual([{ state: "unknown", transport: "unknown" }]);
});

test("scope is strict server metadata and absent legacy JSON keeps its exact digest", async () => {
  const f = await setupImage();
  await extracted(f);
  const old = await mediaLedger(f);
  const admission = await old.budget.prepareInitial(old.input);
  if (!admission) throw new Error("Synthetic admission missing");
  expect("artifactScope" in admission.request).toBe(false);
  expect(await runtimeDigest(paidHoldRequestSchema.parse(admission.request))).toBe(
    await runtimeDigest(admission.request),
  );
  for (const scope of [
    { unit: -1, index: 0 },
    { unit: 0, index: 20000 },
    { unit: 0.5, index: 0 },
    { unit: 0, index: 0, extra: true },
  ])
    expect(processingArtifactScopeSchema.safeParse(scope).success).toBe(false);
  expect(
    await old.budget.prepareInitial({ ...old.input, artifactScope: { unit: -1, index: 0 } }),
  ).toBeNull();
});

test("concurrent first scoped positions compete for the same legacy admission", async () => {
  const f = await setupImage();
  await extracted(f);
  const one = await mediaLedger(f),
    two = await mediaLedger(f);
  const permits = await Promise.all([
    one.costs.before({ ...one.input, artifactScope: { unit: 0, index: 0 } }, one.access),
    two.costs.before({ ...two.input, artifactScope: { unit: 0, index: 1 } }, two.access),
  ]);
  expect(permits.filter(Boolean)).toHaveLength(1);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_execution_admissions WHERE service='model'").get(),
  ).toEqual({ n: 1 });
});

test("old unscoped caller claiming after new lookup wins the original CAS", async () => {
  const f = await setupImage();
  await extracted(f);
  const old = await mediaLedger(f);
  const prepare = f.db.binding.prepare.bind(f.db.binding);
  let injected = false;
  f.db.binding.prepare = (sql: string) => {
    const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
      const bind = statement.bind.bind(statement),
        first = statement.first.bind(statement);
      statement.bind = (...values: unknown[]) => wrap(bind(...values));
      if (sql.startsWith("SELECT p.payload_json,p.digest,h.state,")) {
        statement.first = (async (column?: string) => {
          const row = await (column === undefined ? first() : first(column));
          if (!injected) {
            injected = true;
            expect(row).toBeNull();
            expect(await old.costs.before(old.input, old.access)).not.toBeNull();
          }
          return row;
        }) as D1PreparedStatement["first"];
      }
      return statement;
    };
    return wrap(prepare(sql));
  };
  await expect(f.execution.interpretArtifact(0, 0, signal())).rejects.toMatchObject({
    code: "BUDGET_UNAVAILABLE",
  });
  expect(injected).toBe(true);
  expect(f.calls.model).toBe(0);
  expect(
    f.db.sqlite
      .query(
        "SELECT state,json_extract(payload_json,'$.artifactScope') scope FROM v2_execution_admissions WHERE service='model'",
      )
      .all(),
  ).toEqual([{ state: "dispatched", scope: null }]);
});

test("completed first scope permits one concurrent next scope and its immutable position cannot change", async () => {
  const f = await setupImage();
  await extracted(f);
  const first = await mediaLedger(f);
  await first.gateway.observe(f.original, first.access, { unit: 0, index: 0 });
  const one = await mediaLedger(f),
    two = await mediaLedger(f);
  const permits = await Promise.all([
    one.costs.before({ ...one.input, artifactScope: { unit: 0, index: 1 } }, one.access),
    two.costs.before({ ...two.input, artifactScope: { unit: 0, index: 1 } }, two.access),
  ]);
  expect(permits.filter(Boolean)).toHaveLength(1);
  expect(
    f.db.sqlite.query("SELECT count(*) n FROM v2_execution_admissions WHERE service='model'").get(),
  ).toEqual({ n: 2 });
  expect(() =>
    f.db.sqlite.exec(
      "UPDATE v2_execution_admissions SET payload_json=json_set(payload_json,'$.artifactScope.index',99) WHERE service='model'",
    ),
  ).toThrow();
  const third = await mediaLedger(f);
  expect(
    await third.costs.before(
      { ...third.input, artifactScope: { unit: 0, index: 1 } },
      third.access,
    ),
  ).toBeNull();
  expect(f.calls.model).toBe(1);
});

test("explicit retry starts a new runtime while preserving historical unscoped model evidence", async () => {
  const f = await setupImage({ video: true, videoFrames: 2 });
  await extracted(f);
  const old = await mediaLedger(f);
  const permit = await old.costs.before(old.input, old.access);
  if (!permit) throw new Error("Synthetic permit missing");
  await old.costs.after(permit, { transport: "response" });
  const before = f.db.sqlite
    .query("SELECT * FROM v2_execution_admissions WHERE service='model'")
    .all();
  await expect(f.execution.interpretArtifact(0, 1, signal())).rejects.toMatchObject({
    code: "BUDGET_UNAVAILABLE",
  });
  await f.execution.fail(new ProcessingError("BUDGET_UNAVAILABLE"));
  const retry = createFileRetry(f.core, f.env, {});
  const queued = await retry(f.actor.ownerId, f.workspaceId, f.params.fileId, {
    expectedRevision: f.rev(),
    fileRevision: f.params.fileRevision,
  });
  expect(queued?.status).toBe("queued");
  f.execution = await createFileProcessingRuntime(f.env, f.params, `${f.params.jobId}-2`, () => {});
  await extracted(f);
  await f.execution.interpretArtifact(0, 0, signal());
  await f.execution.interpretArtifact(0, 1, signal());
  expect(f.calls.model).toBe(2);
  const output = await publish(f, 2);
  expect(output?.coverage).toMatchObject({ status: "complete" });
  expect(
    f.db.sqlite
      .query("SELECT * FROM v2_execution_admissions WHERE service='model' AND attempt_id=?")
      .all(permit.attemptId),
  ).toEqual(before);
});
