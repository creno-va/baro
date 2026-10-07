import { z } from "zod";
import {
  boundedText,
  caseDetailResponseSchema,
  caseListResponseSchema,
  displayText,
} from "../../contracts";
import {
  V2_INTAKE_POLICY,
  type V2FailureCode,
  v2FailureCodeSchema,
  v2JobSchema,
  v2QuestionBatchSchema,
  v2SummarySchema,
  v2WorkspaceSchema,
} from "../../contracts/v2";
import { ApiError, apiMode, request } from "./core";
import type { CaseView, QuestionView } from "./types";

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
});
export const revisionInputSchema = z.object({ expectedRevision: z.number().int().min(1) });
export type AnswersInput = z.infer<typeof answersInputSchema>;
export type QuestionsResult = {
  questions: QuestionView[];
  complete: boolean;
  revision: number;
  processing?: boolean;
  failed?: boolean;
  retryable?: boolean;
  failure?: V2FailureCode | null;
  canPrepareSummary?: boolean;
  followupLimit?: number;
  processingStage?: "questions" | "summary";
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
const keyMemory = new Map<string, string>();
const keyIdentities = new Map<string, string>();
async function mutationKey(operation: string, input: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input)),
  );
  const identity = `baro-cases-request:${operation}:${Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  let key = keyMemory.get(identity);
  try {
    key ??= sessionStorage.getItem(identity) ?? undefined;
  } catch {
    /* Memory preserves retries when browser storage is disabled. */
  }
  if (!key) {
    key = crypto.randomUUID();
    keyMemory.set(identity, key);
    try {
      sessionStorage.setItem(identity, key);
    } catch {
      /* No raw input is stored here. */
    }
  }
  keyIdentities.set(key, identity);
  return key;
}
function forgetMutation(key: string) {
  const identity = keyIdentities.get(key);
  if (!identity) return;
  keyMemory.delete(identity);
  keyIdentities.delete(key);
  try {
    sessionStorage.removeItem(identity);
  } catch {
    /* Optional browser storage. */
  }
}
// Only revisions and opaque owner IDs persist; request text remains in the editor.
const wireRevisions = new Map<
  string,
  { owner: string; revision: number; summaryRevision: number }
>();
async function summaryRequest(operation: string, id: string, input: { expectedRevision: number }) {
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
      const stored = sessionStorage.getItem(`baro-cases-wire:${key}`);
      if (stored)
        saved = z
          .object({
            owner: z.string(),
            revision: z.number().int().positive(),
            summaryRevision: z.number().int().positive(),
          })
          .parse(JSON.parse(stored));
    }
  } catch {
    /* Browser storage is optional. */
  }
  // Replays still reach owner checks on the real API; never preflight a committed revision again.
  if (saved?.owner === owner) return { key, saved };
  const [w, m] = await Promise.all([workspace(id), metadata(id)]);
  if (w.workspaceRevision !== input.expectedRevision || !m.summary)
    throw new ApiError("CONFLICT", "요약이 변경됐어요. 최신 내용을 확인해 주세요.");
  saved = { owner, revision: m.revision, summaryRevision: m.summary.revision };
  wireRevisions.set(key, saved);
  try {
    sessionStorage.setItem(`baro-cases-wire:${key}`, JSON.stringify(saved));
  } catch {
    /* Optional. */
  }
  return { key, saved };
}
function finishSummary(key: string) {
  wireRevisions.delete(key);
  try {
    sessionStorage.removeItem(`baro-cases-wire:${key}`);
  } catch {
    /* Optional. */
  }
  forgetMutation(key);
}
function validate<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "입력한 내용을 확인해 주세요.");
  return parsed.data;
}
async function metadata(id: string) {
  return metadataSchema.parse(await request("cases.intake", { id }, { path: path(id, "intake") }));
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
    followupLimit: V2_INTAKE_POLICY.followupLimit,
    processingStage:
      m.batches.reduce((count, batch) => count + batch.questions.length, 0) >=
      V2_INTAKE_POLICY.followupLimit
        ? "summary"
        : "questions",
  };
}
async function latestFailedIntakeJob(id: string, revision: number) {
  const job = v2JobSchema
    .nullable()
    .parse(await request("cases.latestJob", { id }, { path: path(id, "workspace-jobs/latest") }));
  // Failing a job advances the workspace once. Subsequent answer edits create
  // new input and must not be blocked by an exhausted job for the older input.
  return job?.status === "failed" &&
    (job.kind === "intake_questions" || job.kind === "intake_summary") &&
    job.target.kind === "workspace" &&
    revision <= job.target.workspaceRevision + 1
    ? job
    : null;
}
async function getQuestions(id: string): Promise<QuestionsResult> {
  if (apiMode === "mock") return request("cases.getQuestions", { id });
  const [w, m] = await Promise.all([workspace(id), metadata(id)]);
  const result = questions(m, w.workspaceRevision);
  const recovered = m.currentJobId ? null : await latestFailedIntakeJob(id, w.workspaceRevision);
  const jobId = m.currentJobId ?? recovered?.id;
  if (jobId) {
    const job = z
      .object({
        status: z.string(),
        retryable: z.boolean(),
        failure: v2FailureCodeSchema.nullable(),
        kind: z.string().optional(),
      })
      .parse(
        await request(
          "cases.job",
          { id },
          { path: path(id, `workspace-jobs/${encodeURIComponent(jobId)}`) },
        ),
      );
    result.processing = ["queued", "running", "validating"].includes(job.status);
    result.failed = job.status === "failed";
    result.retryable = result.failed && job.retryable;
    result.failure = result.failed ? job.failure : null;
    result.canPrepareSummary =
      result.failed &&
      (job.kind ?? recovered?.kind) === "intake_questions" &&
      result.questions.length >= V2_INTAKE_POLICY.followupLimit &&
      result.questions.every((question) => question.answerState);
  }
  return result;
}

interface TurnstileWidget {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ): string;
  remove(id: string): void;
}
async function securityToken(): Promise<string> {
  const sitekey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
  if (!sitekey)
    throw new ApiError("UNAVAILABLE", "보안 확인 설정을 준비하고 있어요. 입력은 유지돼요.", true);
  const browser = window as unknown as { turnstile?: TurnstileWidget };
  if (!browser.turnstile)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new ApiError("UNAVAILABLE", "보안 확인을 불러오지 못했어요.", true));
      };
      document.head.appendChild(script);
    });
  if (!browser.turnstile) throw new ApiError("UNAVAILABLE", "보안 확인을 불러오지 못했어요.", true);
  return new Promise<string>((resolve, reject) => {
    const panel = document.createElement("dialog"),
      label = document.createElement("p"),
      widget = document.createElement("div"),
      cancel = document.createElement("button");
    label.textContent = "사건을 저장하기 전에 보안 확인을 완료해 주세요.";
    panel.setAttribute("aria-label", "보안 확인");
    cancel.textContent = "취소";
    cancel.type = "button";
    panel.appendChild(label);
    panel.appendChild(widget);
    panel.appendChild(cancel);
    document.body.appendChild(panel);
    panel.showModal();
    let widgetId: string | undefined;
    let settled = false;
    const finish = (token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (widgetId) browser.turnstile?.remove(widgetId);
      panel.close();
      panel.remove();
      if (token) resolve(token);
      else
        reject(
          new ApiError(
            "VALIDATION_ERROR",
            "보안 확인이 끝나지 않았어요. 입력을 유지했으니 다시 시도해 주세요.",
            true,
          ),
        );
    };
    const timer = setTimeout(() => finish(), 120000);
    panel.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish();
    });
    cancel.onclick = () => finish();
    widgetId = browser.turnstile?.render(widget, {
      sitekey,
      action: "case_create",
      callback: (token) => queueMicrotask(() => finish(token)),
      "error-callback": () => finish(),
      "expired-callback": () => finish(),
    });
  });
}
export const casesApi = {
  async list(): Promise<CaseView[]> {
    if (apiMode === "mock") return request("cases.list");
    const items: CaseView[] = [];
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
            await request("cases.listV2", undefined, {
              path: `/api/v2/cases?limit=50${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
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
    const input = validate(createInputSchema, raw),
      key = await mutationKey("cases.create", input);
    if (apiMode === "mock") {
      const item = await request<CaseView>("cases.create", input, { key });
      forgetMutation(key);
      return item;
    }
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
    forgetMutation(key);
    return item;
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
        await request("cases.getLegacy", { id }, { path: `/api/cases/${encodeURIComponent(id)}` }),
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
      ? v2SummarySchema.parse(await request("cases.summary", { id }, { path: path(id, "summary") }))
      : null;
    return view(w, m, s?.overview ?? "");
  },
  getQuestions,
  async saveAnswers(id: string, raw: AnswersInput): Promise<QuestionsResult> {
    const input = validate(answersInputSchema, raw),
      key = await mutationKey(`cases.saveAnswers:${id}`, input);
    if (apiMode === "mock") return request("cases.saveAnswers", { id, ...input }, { key });
    const [w, m] = await Promise.all([workspace(id), metadata(id)]);
    if (w.workspaceRevision !== input.expectedRevision)
      throw new ApiError("CONFLICT", "답변이 변경됐어요. 최신 내용을 확인해 주세요.");
    await request(
      "cases.saveAnswers",
      { id, ...input },
      {
        path: path(id, "intake/answers"),
        method: "PUT",
        body: {
          expectedRevision: m.revision,
          answers: input.answers.map((a) => ({
            questionId: a.questionId,
            status: a.state,
            ...(a.state === "answered" ? { value: a.value } : {}),
          })),
        },
        key,
      },
    );
    return getQuestions(id);
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
    const recovered = m.currentJobId ? null : await latestFailedIntakeJob(id, w.workspaceRevision);
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
        m.batches.reduce((count, batch) => count + batch.questions.length, 0) >=
          V2_INTAKE_POLICY.followupLimit;
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
    const { key, saved } = await summaryRequest("cases.saveSummary", id, input);
    const body = { expectedRevision: saved.summaryRevision, overview: input.summary };
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = z
        .looseObject({ edit: z.object({ status: z.string(), retryAfter: z.number() }).optional() })
        .parse(
          await request(
            "cases.saveSummary",
            { id, ...input },
            { path: path(id, "summary"), method: "PUT", body, key },
          ),
        );
      if (!result.edit) {
        const next = await casesApi.get(id);
        finishSummary(key);
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
    const { key, saved } = await summaryRequest("cases.confirmSummary", id, input);
    await request(
      "cases.confirmSummary",
      { id, ...input },
      {
        path: path(id, "summary/confirm"),
        method: "POST",
        body: { expectedRevision: saved.revision, summaryRevision: saved.summaryRevision },
        key,
      },
    );
    const next = await casesApi.get(id);
    finishSummary(key);
    return next;
  },
};
