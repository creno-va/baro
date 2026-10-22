import type { CaseView, QuestionView, SessionScope } from "@baro/client-core";
import { workspaceProgressText } from "@baro/client-core";
import {
  boundedText,
  caseDetailResponseSchema,
  caseListResponseSchema,
  displayText,
} from "@baro/contracts/v1";
import {
  V2_INTAKE_POLICY,
  type V2FailureCode,
  v2FailureCodeSchema,
  v2HashSchema,
  v2JobSchema,
  v2QuestionBatchSchema,
  v2SummaryEditRequestSchema,
  v2SummarySchema,
  v2WorkspaceSchema,
} from "@baro/contracts/v2";
import { z } from "zod";
import { ApiError } from "./errors";
import type { OperationRequest, OperationRequestOptions } from "./http";

export const createInputSchema = z.object({
  narrative: boundedText(20, 5000),
  subjectContext: z.enum(["individual", "company"]),
});
export const answersInputSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    answers: z
      .array(
        z.discriminatedUnion("state", [
          z.object({
            questionId: z.string().min(1),
            state: z.literal("answered"),
            value: boundedText(1, 1000),
          }),
          z.object({ questionId: z.string().min(1), state: z.literal("unknown") }),
          z.object({ questionId: z.string().min(1), state: z.literal("skipped") }),
        ]),
      )
      .min(1)
      .max(5),
  })
  .refine((input) => new Set(input.answers.map((a) => a.questionId)).size === input.answers.length);
export const summaryInputSchema = z.object({
  expectedRevision: z.number().int().min(1),
  summary: displayText(5000),
  factEdits: v2SummaryEditRequestSchema.shape.factEdits,
  unknowns: v2SummaryEditRequestSchema.shape.unknowns,
});
export const revisionInputSchema = z.object({ expectedRevision: z.number().int().min(1) });
export type AnswersInput = z.infer<typeof answersInputSchema>;
export type QuestionRound = { ordinal: number; questionIds: string[] };
export type QuestionsResult = {
  questions: QuestionView[];
  complete: boolean;
  revision: number;
  processing?: boolean;
  failed?: boolean;
  retryable?: boolean;
  failure?: V2FailureCode | null;
  canPrepareSummary?: boolean;
  roundLimit?: number;
  rounds?: QuestionRound[];
  processingStage?: "questions" | "summary";
  processingMessage?: string;
};
const metadataSchema = z.object({
  schemaVersion: z.literal("2"),
  revision: z.number().int().min(1),
  status: z.enum(["collecting", "generating_questions", "reviewing_summary", "confirmed"]),
  narrative: z.string(),
  batches: z.array(v2QuestionBatchSchema),
  confirmedSummaryRevision: z.number().nullable(),
  currentJobId: z.string().nullable(),
  summary: z.object({ id: z.string(), revision: z.number().int().min(1) }).nullable(),
});
type Metadata = z.infer<typeof metadataSchema>;
type Workspace = z.infer<typeof v2WorkspaceSchema>;
const path = (id: string, suffix: string) => `/api/v2/cases/${encodeURIComponent(id)}/${suffix}`;
export interface CaseOperationStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}
type CasePersistence =
  | { persistence: "required"; storage: CaseOperationStorage }
  | { persistence?: "optional"; storage?: CaseOperationStorage };
// One app session scope owns its logical storage. Serialize pending key writes across domain recreation.
const pendingKeysByScope = new WeakMap<SessionScope, Map<string, Promise<string>>>();
export function createCasesClient(
  dependencies: {
    request: OperationRequest;
    mode: "real" | "mock";
    scope: SessionScope;
    signal?: AbortSignal;
    newKey: () => string;
    fingerprint: (value: string) => Promise<string>;
    challenge: (signal: AbortSignal) => Promise<string>;
  } & CasePersistence,
) {
  const apiMode = dependencies.mode;
  const generation = dependencies.scope.snapshot();
  const instanceSignal = dependencies.signal
    ? AbortSignal.any([dependencies.signal, dependencies.scope.signal()])
    : dependencies.scope.signal();
  const ensureCurrent = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    instanceSignal.throwIfAborted();
  };
  const request: OperationRequest = async <T>(
    operation: string,
    input?: unknown,
    options: OperationRequestOptions = {},
  ) => {
    ensureCurrent();
    const signal = options.signal
      ? AbortSignal.any([options.signal, instanceSignal])
      : instanceSignal;
    try {
      const value = await dependencies.request<T>(operation, input, { ...options, signal });
      ensureCurrent();
      return value;
    } catch (error) {
      ensureCurrent();
      throw error;
    }
  };
  const securityToken = () => dependencies.challenge(instanceSignal);
  const persistenceFailure = () =>
    new ApiError(
      "UNAVAILABLE",
      "요청 복구 정보를 기기에 보관하지 못했어요. 입력을 유지한 채 다시 시도해 주세요.",
      true,
    );
  if (dependencies.persistence === "required" && !dependencies.storage) throw persistenceFailure();
  const keyMemory = new Map<string, string>();
  const keyIdentities = new Map<string, string>();
  let pendingKeys = pendingKeysByScope.get(dependencies.scope);
  if (!pendingKeys) {
    pendingKeys = new Map();
    pendingKeysByScope.set(dependencies.scope, pendingKeys);
  }
  async function mutationKey(operation: string, input: unknown) {
    const hash = await dependencies.fingerprint(JSON.stringify(input));
    if (!v2HashSchema.safeParse(hash).success)
      throw new ApiError(
        "UNAVAILABLE",
        "요청 확인 정보를 준비하지 못했어요. 다시 시도해 주세요.",
        true,
      );
    const identity = `baro-cases-request:${operation}:${hash}`;
    let pending = pendingKeys?.get(identity);
    if (!pending) {
      const task = (async () => {
        ensureCurrent();
        let key = keyMemory.get(identity);
        let stored: string | undefined;
        try {
          if (!key || dependencies.persistence === "required")
            stored = (await dependencies.storage?.getItem(identity)) ?? undefined;
          key ??= stored;
        } catch {
          if (dependencies.persistence === "required") throw persistenceFailure();
        }
        ensureCurrent();
        const fresh = !key;
        key ??= dependencies.newKey();
        if (fresh || (dependencies.persistence === "required" && stored !== key)) {
          try {
            await dependencies.storage?.setItem(identity, key);
          } catch {
            if (dependencies.persistence === "required") throw persistenceFailure();
          }
        }
        ensureCurrent();
        keyMemory.set(identity, key);
        keyIdentities.set(key, identity);
        return key;
      })();
      pendingKeys?.set(identity, task);
      void task
        .finally(() => {
          if (pendingKeys?.get(identity) === task) pendingKeys.delete(identity);
        })
        .catch(() => {});
      pending = task;
    }
    const key = await pending;
    ensureCurrent();
    keyMemory.set(identity, key);
    keyIdentities.set(key, identity);
    return key;
  }
  async function forgetMutation(key: string) {
    const identity = keyIdentities.get(key);
    if (!identity) return;
    keyMemory.delete(identity);
    keyIdentities.delete(key);
    try {
      await dependencies.storage?.removeItem(identity);
    } catch {
      /* Optional browser storage. */
    }
  }
  // Only revisions and opaque owner IDs persist; request text remains in the editor.
  const wireRevisions = new Map<
    string,
    { owner: string; revision: number; summaryRevision?: number | undefined }
  >();
  async function intakeRequest(
    operation: string,
    id: string,
    input: { expectedRevision: number },
    needsSummary = true,
  ) {
    const session = z
      .object({
        user: z.object({ id: z.string(), accountType: z.string() }).nullable(),
        needsConsent: z.boolean(),
      })
      .parse(await request("cases.owner", undefined, { path: "/api/me/session" }));
    if (!session.user) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
    if (session.needsConsent) throw new ApiError("CONSENT_REQUIRED", "필수 동의를 확인해 주세요.");
    if (session.user.accountType !== "customer")
      throw new ApiError("NOT_FOUND", "사건을 찾을 수 없어요.");
    const owner = session.user.id;
    const key = await mutationKey(`${operation}:${owner}:${id}`, input);
    let saved = wireRevisions.get(key);
    try {
      if (!saved) {
        const stored = await dependencies.storage?.getItem(`baro-cases-wire:${key}`);
        if (stored)
          saved = z
            .object({
              owner: z.string(),
              revision: z.number().int().positive(),
              summaryRevision: z.number().int().positive().optional(),
            })
            .parse(JSON.parse(stored));
      }
    } catch {
      if (dependencies.persistence === "required") throw persistenceFailure();
    }
    // Replays still reach owner checks on the real API; never preflight a committed revision again.
    if (saved?.owner === owner && (!needsSummary || saved.summaryRevision)) return { key, saved };
    const [w, m] = await Promise.all([workspace(id), metadata(id)]);
    if (w.workspaceRevision !== input.expectedRevision || (needsSummary && !m.summary))
      throw new ApiError("CONFLICT", "내용이 변경됐어요. 최신 내용을 확인해 주세요.");
    saved = { owner, revision: m.revision, summaryRevision: m.summary?.revision };
    try {
      await dependencies.storage?.setItem(`baro-cases-wire:${key}`, JSON.stringify(saved));
    } catch {
      if (dependencies.persistence === "required") throw persistenceFailure();
    }
    wireRevisions.set(key, saved);
    return { key, saved };
  }
  async function finishIntake(key: string) {
    wireRevisions.delete(key);
    try {
      await dependencies.storage?.removeItem(`baro-cases-wire:${key}`);
    } catch {
      /* Optional. */
    }
    await forgetMutation(key);
  }
  function validate<T>(schema: z.ZodType<T>, raw: unknown): T {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "입력한 내용을 확인해 주세요.");
    return parsed.data;
  }
  async function metadata(id: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const value = await readMetadata(id);
      if (value) return value;
    }
    throw snapshotUnavailable();
  }
  async function readMetadata(id: string) {
    return metadataSchema
      .nullable()
      .parse(await request("cases.intake", { id }, { path: path(id, "intake") }));
  }
  function snapshotUnavailable() {
    return new ApiError(
      "UNAVAILABLE",
      "준비된 내용을 다시 확인하고 있어요. 잠시 후 다시 시도해 주세요.",
      true,
    );
  }
  // Schema knowledge contains no case content or permissions. A confirmed v2
  // denial must not become an unrelated legacy request or its network failure.
  const knownV2 = new Set<string>();
  async function workspace(id: string) {
    const value = v2WorkspaceSchema.parse(
      await request("cases.workspace", { id }, { path: path(id, "workspace") }),
    );
    knownV2.add(id);
    return value;
  }
  function view(w: Workspace, m?: Metadata, summary = ""): CaseView {
    return {
      id: w.id,
      title: m?.narrative ? [...m.narrative].slice(0, 45).join("") : w.title,
      subjectContext: w.subjectContext,
      stage: w.status === "intake" && m?.summary ? "summary" : w.status,
      revision: w.workspaceRevision,
      updatedAt: w.updatedAt,
      summary,
      schemaVersion: "2",
    };
  }
  function questions(m: Metadata, revision: number): QuestionsResult {
    return {
      questions: m.batches.flatMap((batch) =>
        batch.questions.map((q) => {
          const answer = batch.answers.find((a) => a.questionId === q.id);
          return {
            id: q.id,
            text: q.prompt,
            kind: q.answerType,
            options: q.options,
            ...(answer
              ? {
                  answerState: answer.status,
                  ...(answer.status === "answered" ? { answer: answer.value } : {}),
                }
              : {}),
          };
        }),
      ),
      complete: m.summary !== null,
      revision,
      processing: m.currentJobId !== null,
      roundLimit: V2_INTAKE_POLICY.followupRounds,
      rounds: m.batches.map((batch) => ({
        ordinal: batch.ordinal,
        questionIds: batch.questions.map((q) => q.id),
      })),
      processingStage:
        m.batches.length >= V2_INTAKE_POLICY.followupRounds ? "summary" : "questions",
    };
  }
  async function latestFailedIntakeJob(id: string, revision: number) {
    const job = await latestIntakeJob(id);
    return isCurrentFailure(job, revision) ? job : null;
  }
  async function latestIntakeJob(id: string) {
    const job = v2JobSchema
      .nullable()
      .parse(await request("cases.latestJob", { id }, { path: path(id, "workspace-jobs/latest") }));
    return job &&
      (job.kind === "intake_questions" || job.kind === "intake_summary") &&
      job.target.kind === "workspace"
      ? job
      : null;
  }
  function isCurrentFailure(job: Awaited<ReturnType<typeof latestIntakeJob>>, revision: number) {
    // Failing a job advances the workspace once. Subsequent answer edits create
    // new input and must not be blocked by an exhausted job for the older input.
    return (
      job?.status === "failed" &&
      job.target.kind === "workspace" &&
      revision <= job.target.workspaceRevision + 1
    );
  }
  async function getQuestions(
    id: string,
    acknowledged?: { metadata: Metadata | null; workspaceRevision: number },
  ): Promise<QuestionsResult> {
    if (apiMode === "mock") return request("cases.getQuestions", { id });
    // A completion clears the intake pointer and publishes its result atomically,
    // but these HTTP reads are separate snapshots. Never stop polling on an older
    // intake just because a later job read observes its completion.
    for (let attempt = 0; attempt < 2; attempt++) {
      const [w, m] = await Promise.all([
        workspace(id),
        // A PUT already returns an owner-checked, revision-fenced intake snapshot.
        // Reuse it only once, against a fresh workspace and the normal job checks.
        attempt === 0 && acknowledged?.metadata ? acknowledged.metadata : readMetadata(id),
      ]);
      if (
        !m ||
        (attempt === 0 &&
          acknowledged?.metadata &&
          w.workspaceRevision !== acknowledged.workspaceRevision) ||
        (w.status === "intake" && w.currentJobId !== m.currentJobId) ||
        w.intakeRevision !== m.revision
      )
        continue;
      const result = questions(m, w.workspaceRevision);
      const latest = m.currentJobId ? null : await latestIntakeJob(id);
      if (latest?.target.kind === "workspace") {
        const changedAfterSnapshot = w.workspaceRevision <= latest.target.workspaceRevision;
        const missingPublishedResult =
          latest.status === "completed" &&
          (latest.kind === "intake_questions"
            ? m.batches.length === 0 ||
              (w.workspaceRevision === latest.target.workspaceRevision + 1 &&
                m.batches.at(-1)?.generatedForIntakeRevision !== m.revision)
            : w.workspaceRevision === latest.target.workspaceRevision + 1 && !m.summary);
        if (changedAfterSnapshot || missingPublishedResult) continue;
      }
      const recovered = isCurrentFailure(latest, w.workspaceRevision) ? latest : null;
      const jobId = m.currentJobId ?? recovered?.id;
      if (!jobId) return result;
      const job =
        recovered ??
        z
          .object({
            status: z.string(),
            retryable: z.boolean(),
            failure: v2FailureCodeSchema.nullable(),
            kind: z.string().optional(),
            phase: v2JobSchema.shape.phase.optional(),
          })
          .parse(
            await request(
              "cases.job",
              { id },
              { path: path(id, `workspace-jobs/${encodeURIComponent(jobId)}`) },
            ),
          );
      const processing = ["queued", "running", "validating"].includes(job.status);
      if (m.currentJobId && !processing) continue;
      result.processing = processing;
      if (processing)
        result.processingMessage = workspaceProgressText({
          status: job.status as "queued" | "running" | "validating",
          phase: job.phase ?? "admission",
          kind: job.kind === "intake_summary" ? "intake_summary" : "intake_questions",
        });
      result.failed = job.status === "failed";
      result.retryable = result.failed && job.retryable;
      result.failure = result.failed ? job.failure : null;
      result.canPrepareSummary =
        result.failed &&
        job.kind === "intake_questions" &&
        m.batches.length >= V2_INTAKE_POLICY.followupRounds &&
        result.questions.every((question) => question.answerState);
      return result;
    }
    throw snapshotUnavailable();
  }

  const pendingCreates = new Map<string, Promise<CaseView>>();
  const casesApi = {
    async list(): Promise<CaseView[]> {
      if (apiMode === "mock") return request("cases.list");
      const items: CaseView[] = [];
      // Start both generations together; older records must not delay the v2 list.
      const firstV2 = request("cases.listV2", undefined, { path: "/api/v2/cases?limit=50" }).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      let cursor: string | null = null;
      do {
        const page = caseListResponseSchema.parse(
          await request("cases.listLegacy", undefined, {
            path: `/api/cases?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          }),
        );
        items.push(
          ...page.items.map((item) => ({
            id: item.id,
            title: item.title,
            subjectContext: "individual" as const,
            stage: "active" as const,
            revision: 1,
            updatedAt: item.updatedAt,
            summary: "기존 사건 기록과 분석 결과를 확인할 수 있어요.",
            schemaVersion: "1" as const,
          })),
        );
        cursor = page.nextCursor;
      } while (cursor);
      try {
        cursor = null;
        do {
          const page = z
            .object({
              items: z.array(v2WorkspaceSchema),
              nextCursor: z.string().nullable(),
              previews: z
                .array(z.object({ id: z.string(), title: z.string(), hasSummary: z.boolean() }))
                .optional(),
            })
            .parse(
              cursor
                ? await request("cases.listV2", undefined, {
                    path: `/api/v2/cases?limit=50&before=${encodeURIComponent(cursor)}`,
                  })
                : await firstV2.then((result) => {
                    if (result.error) throw result.error;
                    return result.value;
                  }),
            );
          if (page.previews) {
            for (const item of page.items) {
              const preview = page.previews.find((entry) => entry.id === item.id);
              if (preview)
                items.push({
                  ...view(item),
                  title: preview.title,
                  stage: item.status === "intake" && preview.hasSummary ? "summary" : item.status,
                });
            }
          } else {
            // Older reviewed servers remain readable until the projection deploys.
            for (let start = 0; start < page.items.length; start += 5)
              items.push(
                ...(await Promise.all(
                  page.items
                    .slice(start, start + 5)
                    .map(async (item) => view(item, await metadata(item.id))),
                )),
              );
          }
          cursor = page.nextCursor;
        } while (cursor);
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.code === "NOT_FOUND")) throw cause;
      }
      return [...new Map(items.map((item) => [item.id, item])).values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    },
    async create(raw: z.infer<typeof createInputSchema>): Promise<CaseView> {
      const input = validate(createInputSchema, raw);
      if (apiMode === "mock") {
        const key = await mutationKey("cases.create", input);
        const item = await request<CaseView>("cases.create", input, { key });
        await forgetMutation(key);
        return item;
      }
      const session = z
        .object({
          user: z.object({ id: z.string(), accountType: z.string() }).nullable(),
          needsConsent: z.boolean(),
        })
        .parse(await request("cases.owner", undefined, { path: "/api/me/session" }));
      if (!session.user) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
      if (session.needsConsent)
        throw new ApiError("CONSENT_REQUIRED", "필수 동의를 확인해 주세요.");
      if (session.user.accountType !== "customer")
        throw new ApiError("NOT_FOUND", "사건을 찾을 수 없어요.");
      // A changed cookie can precede the app's session notification. Resolve the owner
      // before joining an in-flight creation so an old account cannot block a new one.
      const owner = session.user.id;
      const identity = JSON.stringify([owner, input]);
      const existing = pendingCreates.get(identity);
      if (existing) return existing;
      const pending = (async () => {
        const key = await mutationKey(`cases.create:${owner}`, input);
        const turnstileToken = await securityToken();
        const w = v2WorkspaceSchema.parse(
          await request("cases.create", input, {
            path: "/api/v2/cases",
            method: "POST",
            body: { ...input, jurisdiction: "KR", turnstileToken },
            key,
          }),
        );
        const item = view(w, await metadata(w.id));
        await forgetMutation(key);
        return item;
      })();
      pendingCreates.set(identity, pending);
      void pending
        .finally(() => {
          if (pendingCreates.get(identity) === pending) pendingCreates.delete(identity);
        })
        .catch(() => {});
      return pending;
    },
    async get(id: string): Promise<CaseView> {
      if (apiMode === "mock") return request("cases.get", { id });
      let w: Workspace;
      try {
        w = await workspace(id);
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.code === "NOT_FOUND")) throw cause;
        if (knownV2.has(id)) throw cause;
        const old = caseDetailResponseSchema.parse(
          await request(
            "cases.getLegacy",
            { id },
            { path: `/api/cases/${encodeURIComponent(id)}` },
          ),
        );
        return {
          id: old.caseId,
          title: old.title,
          stage: "active",
          subjectContext: "individual",
          revision: old.inputRevision,
          summary: "기존 사건 기록",
          updatedAt: old.completedAt ?? old.startedAt ?? new Date().toISOString(),
          schemaVersion: "1",
        };
      }
      const m = await metadata(id);
      const s = m.summary
        ? v2SummarySchema.parse(
            await request("cases.summary", { id }, { path: path(id, "summary") }),
          )
        : null;
      return { ...view(w, m, s?.overview ?? ""), ...(s ? { summaryDetails: s } : {}) };
    },
    getQuestions,
    async saveAnswers(id: string, raw: AnswersInput): Promise<QuestionsResult> {
      const input = validate(answersInputSchema, raw);
      if (apiMode === "mock")
        return request(
          "cases.saveAnswers",
          { id, ...input },
          {
            key: await mutationKey(`cases.saveAnswers:${id}`, input),
          },
        );
      const { key, saved } = await intakeRequest("cases.saveAnswers", id, input, false);
      const acknowledged = metadataSchema.nullable().parse(
        await request(
          "cases.saveAnswers",
          { id, ...input },
          {
            path: path(id, "intake/answers"),
            method: "PUT",
            body: {
              expectedRevision: saved.revision,
              answers: input.answers.map((a) => ({
                questionId: a.questionId,
                status: a.state,
                ...(a.state === "answered" ? { value: a.value } : {}),
              })),
            },
            key,
          },
        ),
      );
      // The expected revision identifies this answer submission, including completed duplicates.
      return getQuestions(id, {
        metadata: acknowledged,
        // A normal answer mutation advances the workspace exactly once. If a
        // peer mutation or an older replay moved it further, reread the intake.
        workspaceRevision: input.expectedRevision + 1,
      });
    },
    async advance(id: string, raw: { expectedRevision: number }): Promise<QuestionsResult> {
      const input = validate(revisionInputSchema, raw);
      if (apiMode === "mock")
        return request(
          "cases.advance",
          { id, ...input },
          { key: await mutationKey(`cases.advance:${id}`, input) },
        );
      const [w, m] = await Promise.all([workspace(id), metadata(id)]);
      let suffix = "intake/advance";
      const recovered = m.currentJobId
        ? null
        : await latestFailedIntakeJob(id, w.workspaceRevision);
      const jobId = m.currentJobId ?? recovered?.id;
      if (jobId) {
        const job = z
          .object({ status: z.string(), retryable: z.boolean(), kind: z.string().optional() })
          .parse(
            await request(
              "cases.job",
              { id },
              { path: path(id, `workspace-jobs/${encodeURIComponent(jobId)}`) },
            ),
          );
        if (job.status !== "failed") return getQuestions(id);
        const summaryInstead =
          (job.kind ?? recovered?.kind) === "intake_questions" &&
          m.batches.length >= V2_INTAKE_POLICY.followupRounds;
        if (!job.retryable && !summaryInstead)
          throw new ApiError(
            "UNAVAILABLE",
            "이 작업을 다시 준비할 수 없어요. 저장한 답변은 보존돼요.",
          );
        if (!summaryInstead) suffix = `workspace-jobs/${encodeURIComponent(jobId)}/retry`;
      }
      await request(
        "cases.advance",
        { id, ...input },
        {
          path: path(id, suffix),
          method: "POST",
          body: input,
          key: await mutationKey(`cases.advance:${id}:${suffix}`, input),
        },
      );
      return getQuestions(id);
    },
    async saveSummary(id: string, raw: z.infer<typeof summaryInputSchema>): Promise<CaseView> {
      const input = validate(summaryInputSchema, raw);
      if (apiMode === "mock")
        return request(
          "cases.saveSummary",
          { id, ...input },
          { key: await mutationKey(`cases.saveSummary:${id}`, input) },
        );
      const { key, saved } = await intakeRequest("cases.saveSummary", id, input);
      const body = {
        expectedRevision: saved.summaryRevision,
        overview: input.summary,
        ...(input.factEdits ? { factEdits: input.factEdits } : {}),
        ...(input.unknowns ? { unknowns: input.unknowns } : {}),
      };
      for (let attempt = 0; attempt < 30; attempt++) {
        const result = z
          .looseObject({
            edit: z.object({ status: z.string(), retryAfter: z.number() }).optional(),
          })
          .parse(
            await request(
              "cases.saveSummary",
              { id, ...input },
              { path: path(id, "summary"), method: "PUT", body, key },
            ),
          );
        if (!result.edit) {
          const next = await casesApi.get(id);
          await finishIntake(key);
          return next;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(result.edit?.retryAfter ?? 1, 3) * 1000),
        );
      }
      throw new ApiError(
        "UNAVAILABLE",
        "요약 저장을 계속 진행하고 있어요. 같은 내용으로 다시 저장해 주세요.",
        true,
      );
    },
    async confirmSummary(id: string, raw: { expectedRevision: number }): Promise<CaseView> {
      const input = validate(revisionInputSchema, raw);
      if (apiMode === "mock")
        return request(
          "cases.confirmSummary",
          { id, ...input },
          { key: await mutationKey(`cases.confirmSummary:${id}`, input) },
        );
      const { key, saved } = await intakeRequest("cases.confirmSummary", id, input);
      await request(
        "cases.confirmSummary",
        { id, ...input },
        {
          path: path(id, "summary/confirm"),
          method: "POST",
          body: {
            expectedRevision: saved.revision,
            summaryRevision: saved.summaryRevision,
            workspaceRevision: input.expectedRevision,
          },
          key,
        },
      );
      const next = await casesApi.get(id);
      await finishIntake(key);
      return next;
    },
  };

  const mutationSchemas = new Map<string, z.ZodType>([
    ["create", createInputSchema],
    ["saveAnswers", answersInputSchema],
    ["advance", revisionInputSchema],
    ["saveSummary", summaryInputSchema],
    ["confirmSummary", revisionInputSchema],
  ]);
  // Raw editor inputs remain only in this in-flight instance, never in the durable operation store.
  const pendingMutations = new Map<string, Promise<unknown>>();
  return new Proxy(casesApi, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        ensureCurrent();
        const schema = typeof key === "string" ? mutationSchemas.get(key) : undefined;
        if (schema && (key !== "create" || apiMode === "mock")) {
          const position = key === "create" ? 0 : 1;
          const normalized = [...args];
          normalized[position] = validate(schema, args[position]);
          const identity = JSON.stringify([key, normalized]);
          let pending = pendingMutations.get(identity);
          if (!pending) {
            pending = (async () => {
              try {
                const result = await Reflect.apply(value, target, normalized);
                ensureCurrent();
                return result;
              } catch (error) {
                ensureCurrent();
                throw error;
              }
            })();
            pendingMutations.set(identity, pending);
            const current = pending;
            void current
              .finally(() => {
                if (pendingMutations.get(identity) === current) pendingMutations.delete(identity);
              })
              .catch(() => {});
          }
          return pending;
        }
        try {
          const result = await Reflect.apply(value, target, args);
          ensureCurrent();
          return result;
        } catch (error) {
          ensureCurrent();
          throw error;
        }
      };
    },
  });
}
