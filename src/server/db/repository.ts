import { and, desc, eq, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";
import {
  type AnalysisStatus,
  analysisStatusSchema,
  type Citation,
  citationSchema,
  createCaseResponseSchema,
  cursorPositionSchema,
  dateSchema,
  failureCodeSchema,
  idempotencyKeySchema,
  opaqueIdSchema,
  type Result,
  resultSchema,
  revisionSchema,
  timestampSchema,
  uuidSchema,
} from "../../contracts";
import type { EnvelopeCipher } from "../crypto";
import {
  ACTIVE_ANALYSIS_STATUSES,
  analyses,
  cases,
  citations,
  dailyUsage,
  idempotencyRecords,
  legalSourceCache,
} from "./schema";

export class DomainRepositoryError extends Error {
  constructor(readonly code: "REPOSITORY_INPUT_INVALID" | "DB_OPERATION_FAILED") {
    super(code);
    this.name = "DomainRepositoryError";
  }
}
const ownerSchema = opaqueIdSchema;
const nowSchema = timestampSchema.transform((value) => new Date(value).toISOString());
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const guardSchema = z.strictObject({
  ownerId: ownerSchema,
  caseId: uuidSchema,
  analysisId: uuidSchema,
  inputRevision: revisionSchema,
  attempt: z.number().int().min(1).max(3),
  expectedStatus: analysisStatusSchema.refine((value) =>
    (ACTIVE_ANALYSIS_STATUSES as readonly string[]).includes(value),
  ),
});
export type AnalysisGuard = z.infer<typeof guardSchema>;
const initialSchema = z.strictObject({
  ownerId: ownerSchema,
  caseId: uuidSchema,
  analysisId: uuidSchema,
  outboxId: uuidSchema,
  idempotencyKey: idempotencyKeySchema,
  requestHash: hashSchema,
  input: z.string(),
  now: nowSchema,
});
export type InitialCaseWrite = z.input<typeof initialSchema>;
const DAY_MS = 86_400_000;
const CREATE_ROUTE = "/api/cases";
const transitions: Partial<Record<AnalysisStatus, readonly AnalysisStatus[]>> = {
  queued: ["screening", "retrieving", "failed"],
  screening: ["waiting_for_answers", "queued", "completed", "failed"],
  waiting_for_answers: ["failed"],
  retrieving: ["generating", "failed"],
  generating: ["validating", "failed"],
  validating: ["completed", "failed"],
};

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainRepositoryError("REPOSITORY_INPUT_INVALID");
  return result.data;
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DomainRepositoryError) throw error;
    // SQL, original cause and crypto diagnostics never leave this repository boundary.
    throw new DomainRepositoryError("DB_OPERATION_FAILED");
  }
}
export function usageDateKst(timestamp: string): string {
  return new Date(Date.parse(parse(nowSchema, timestamp)) + 9 * 3_600_000)
    .toISOString()
    .slice(0, 10);
}
const currentGuard = `EXISTS (SELECT 1 FROM cases c JOIN analyses a ON a.id = c.current_analysis_id
 WHERE c.user_id = ? AND c.id = ? AND a.id = ? AND c.input_revision = ?
 AND a.case_id = c.id AND a.input_revision = c.input_revision AND a.attempt = ? AND a.status = ?)`;
const guardValues = (g: AnalysisGuard) => [
  g.ownerId,
  g.caseId,
  g.analysisId,
  g.inputRevision,
  g.attempt,
  g.expectedStatus,
];

/** Internal storage primitive. Routes must authorize the session/consent/abuse policy first. */
export function createDomainRepository(binding: D1Database, cipher: EnvelopeCipher) {
  const db = drizzle(binding);
  const statement = (sql: string, values: unknown[]) => binding.prepare(sql).bind(...values);
  const field = (
    g: AnalysisGuard,
    column: "encrypted_context" | "encrypted_answers" | "encrypted_result",
  ) => ({ table: "analyses" as const, rowId: g.analysisId, userId: g.ownerId, column });

  return {
    findCase(ownerId: string, caseId: string) {
      return safe(
        async () =>
          (await db
            .select()
            .from(cases)
            .where(
              and(
                eq(cases.userId, parse(ownerSchema, ownerId)),
                eq(cases.id, parse(uuidSchema, caseId)),
              ),
            )
            .get()) ?? null,
      );
    },
    listCases(ownerId: string, limit = 20, cursor?: { createdAt: string; id: string }) {
      return safe(async () => {
        parse(ownerSchema, ownerId);
        parse(z.number().int().min(1).max(50), limit);
        if (cursor) parse(cursorPositionSchema, cursor);
        return db
          .select({
            id: cases.id,
            title: cases.title,
            status: cases.status,
            createdAt: cases.createdAt,
            updatedAt: cases.updatedAt,
          })
          .from(cases)
          .where(
            and(
              eq(cases.userId, ownerId),
              cursor
                ? or(
                    lt(cases.createdAt, cursor.createdAt),
                    and(eq(cases.createdAt, cursor.createdAt), lt(cases.id, cursor.id)),
                  )
                : undefined,
            ),
          )
          .orderBy(desc(cases.createdAt), desc(cases.id))
          .limit(limit)
          .all();
      });
    },
    findCurrentAnalysis(ownerId: string, caseId: string) {
      return safe(async () => {
        const row = await db
          .select({ analysis: analyses })
          .from(analyses)
          .innerJoin(
            cases,
            and(
              eq(cases.currentAnalysisId, analyses.id),
              eq(cases.id, analyses.caseId),
              eq(cases.inputRevision, analyses.inputRevision),
            ),
          )
          .where(
            and(
              eq(cases.userId, parse(ownerSchema, ownerId)),
              eq(cases.id, parse(uuidSchema, caseId)),
            ),
          )
          .get();
        return row?.analysis ?? null;
      });
    },
    listCitations(ownerId: string, caseId: string) {
      return safe(async () =>
        db
          .select({ citation: citations })
          .from(citations)
          .innerJoin(analyses, eq(citations.analysisId, analyses.id))
          .innerJoin(
            cases,
            and(
              eq(cases.id, analyses.caseId),
              eq(cases.currentAnalysisId, analyses.id),
              eq(cases.inputRevision, analyses.inputRevision),
            ),
          )
          .where(
            and(
              eq(cases.userId, parse(ownerSchema, ownerId)),
              eq(cases.id, parse(uuidSchema, caseId)),
            ),
          )
          .orderBy(citations.id)
          .all()
          .then((rows) => rows.map((row) => row.citation)),
      );
    },
    readInput(ownerId: string, caseId: string) {
      return safe(async () => {
        const row = await this.findCase(ownerId, caseId);
        return row
          ? cipher.decrypt(row.encryptedInput, {
              table: "cases",
              column: "encrypted_input",
              rowId: row.id,
              userId: ownerId,
            })
          : null;
      });
    },
    findCreateIdempotency(ownerId: string, key: string, now: string) {
      return safe(async () => {
        const record = await db
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.userId, parse(ownerSchema, ownerId)),
              eq(idempotencyRecords.method, "POST"),
              eq(idempotencyRecords.route, CREATE_ROUTE),
              eq(idempotencyRecords.key, parse(idempotencyKeySchema, key)),
            ),
          )
          .get();
        return record && record.expiresAt > parse(nowSchema, now) ? record : null;
      });
    },
    findIdempotency(
      ownerId: string,
      method: "POST" | "DELETE",
      route: string,
      key: string,
      now: string,
    ) {
      return safe(async () => {
        parse(ownerSchema, ownerId);
        parse(idempotencyKeySchema, key);
        parse(nowSchema, now);
        parse(z.string().regex(/^\/api\/cases\/[a-f0-9-]{36}(\/(answers|retry))?$/), route);
        return await binding
          .prepare(
            "SELECT request_hash AS requestHash,response_status AS responseStatus,response_json AS responseJson FROM idempotency_records WHERE user_id=? AND method=? AND route=? AND key=? AND expires_at>?",
          )
          .bind(ownerId, method, route, key, now)
          .first<{ requestHash: string; responseStatus: number; responseJson: string }>();
      });
    },
    getUsage(ownerId: string, date: string) {
      return safe(
        async () =>
          (
            await db
              .select({ count: dailyUsage.analysisCount })
              .from(dailyUsage)
              .where(
                and(
                  eq(dailyUsage.userId, parse(ownerSchema, ownerId)),
                  eq(dailyUsage.usageDateKst, parse(dateSchema, date)),
                ),
              )
              .get()
          )?.count ?? 0,
      );
    },
    commitInitialCase(input: InitialCaseWrite) {
      return safe(async () => {
        const p = parse(initialSchema, input);
        const usageDate = usageDateKst(p.now);
        const encryptedInput = await cipher.encrypt(p.input, {
          table: "cases",
          column: "encrypted_input",
          rowId: p.caseId,
          userId: p.ownerId,
        });
        const response = parse(createCaseResponseSchema, {
          caseId: p.caseId,
          analysisId: p.analysisId,
          inputRevision: 1,
          status: "screening",
        });
        const expiresAt = new Date(Date.parse(p.now) + DAY_MS).toISOString();
        const instanceId = `${p.analysisId}-1`;
        // Immutable for every dependent statement; only the final statement changes quota.
        const allowed = `EXISTS (SELECT 1 FROM user WHERE id = ?) AND
          COALESCE((SELECT analysis_count FROM daily_usage WHERE user_id = ? AND usage_date_kst = ?), 0) < 10`;
        const allowedValues = [p.ownerId, p.ownerId, usageDate];
        const outcome = await binding.batch([
          statement(
            `DELETE FROM idempotency_records WHERE user_id=? AND method='POST' AND route=? AND key=? AND expires_at<=? AND ${allowed}`,
            [p.ownerId, CREATE_ROUTE, p.idempotencyKey, p.now, ...allowedValues],
          ),
          statement(
            `INSERT INTO cases(id,user_id,status,encrypted_input,input_revision,created_at,updated_at)
            SELECT ?,?,'screening',?,1,?,? WHERE ${allowed}`,
            [p.caseId, p.ownerId, encryptedInput, p.now, p.now, ...allowedValues],
          ),
          statement(
            `INSERT INTO analyses(id,case_id,workflow_instance_id,input_revision,attempt,status,created_at,updated_at)
            SELECT ?,?,?,1,1,'queued',?,? WHERE ${allowed}`,
            [p.analysisId, p.caseId, instanceId, p.now, p.now, ...allowedValues],
          ),
          statement(
            `UPDATE cases SET current_analysis_id=? WHERE id=? AND user_id=? AND input_revision=1 AND ${allowed}`,
            [p.analysisId, p.caseId, p.ownerId, ...allowedValues],
          ),
          statement(
            `INSERT INTO idempotency_records(user_id,method,route,key,request_hash,response_status,response_json,created_at,expires_at)
            SELECT ?,'POST',?,?,?,201,?,?,? WHERE ${allowed}`,
            [
              p.ownerId,
              CREATE_ROUTE,
              p.idempotencyKey,
              p.requestHash,
              JSON.stringify(response),
              p.now,
              expiresAt,
              ...allowedValues,
            ],
          ),
          statement(
            `INSERT INTO dispatch_outbox(id,analysis_id,attempt,instance_id,revision,state,attempts,next_attempt_at,created_at)
            SELECT ?,?,1,?,1,'pending',0,?,? WHERE ${allowed}`,
            [p.outboxId, p.analysisId, instanceId, p.now, p.now, ...allowedValues],
          ),
          statement(
            `INSERT INTO daily_usage(user_id,usage_date_kst,analysis_count,updated_at)
            SELECT ?,?,1,? WHERE ${allowed}
            ON CONFLICT(user_id,usage_date_kst) DO UPDATE SET analysis_count=analysis_count+1,updated_at=excluded.updated_at
            WHERE analysis_count<10`,
            [p.ownerId, usageDate, p.now, ...allowedValues],
          ),
        ]);
        return outcome.at(-1)?.meta.changes === 1
          ? { created: true as const, response }
          : { created: false as const };
      });
    },
    saveCheckpoint(input: AnalysisGuard, plaintext: string, now: string) {
      return safe(async () => {
        const g = parse(guardSchema, input);
        const encrypted = await cipher.encrypt(plaintext, field(g, "encrypted_context"));
        const result = await statement(
          `UPDATE analyses SET encrypted_context=?,updated_at=? WHERE id=? AND ${currentGuard}`,
          [encrypted, parse(nowSchema, now), g.analysisId, ...guardValues(g)],
        ).run();
        return result.meta.changes === 1;
      });
    },
    compareAndSetCheckpoint(
      input: AnalysisGuard,
      previous: string | null,
      plaintext: string,
      now: string,
    ) {
      return safe(async () => {
        const g = parse(guardSchema, input);
        const encrypted = await cipher.encrypt(plaintext, field(g, "encrypted_context"));
        const result = await statement(
          `UPDATE analyses SET encrypted_context=?,updated_at=?,started_at=COALESCE(started_at,?),model_id='openai/gpt-6-sol',prompt_version='1.0.0',schema_version='1',policy_version='1.0.0' WHERE id=? AND encrypted_context IS ? AND ${currentGuard}`,
          [encrypted, parse(nowSchema, now), now, g.analysisId, previous, ...guardValues(g)],
        ).run();
        return result.meta.changes === 1;
      });
    },
    saveCitation(input: AnalysisGuard, value: Citation) {
      return safe(async () => {
        const g = parse(guardSchema, input);
        const c = parse(citationSchema, value);
        const result = await statement(
          `INSERT INTO citations(id,analysis_id,source_type,source_id,law_name,article,effective_date,verified_at,source_url,content_hash)
          SELECT ?,?,'statute',?,?,?,?,?,?,? WHERE ${currentGuard}`,
          [
            c.id,
            g.analysisId,
            c.sourceId,
            c.lawName,
            c.article,
            c.effectiveDate,
            c.verifiedAt,
            c.url,
            c.contentHash,
            ...guardValues(g),
          ],
        ).run();
        return result.meta.changes === 1;
      });
    },
    compareAndSetAnalysis(
      input: AnalysisGuard,
      patch: {
        status: AnalysisStatus;
        result?: Result;
        failureCode?: z.infer<typeof failureCodeSchema>;
        questionsAsked?: number;
        clarificationExpiresAt?: string;
      },
      now: string,
    ) {
      return safe(async () => {
        const g = parse(guardSchema, input);
        const at = parse(nowSchema, now);
        const p = parse(
          z.strictObject({
            status: analysisStatusSchema,
            result: resultSchema.optional(),
            failureCode: failureCodeSchema.optional(),
            questionsAsked: z.number().int().min(1).max(5).optional(),
            clarificationExpiresAt: nowSchema.optional(),
          }),
          patch,
        );
        if (
          !transitions[g.expectedStatus]?.includes(p.status) ||
          (p.status === "completed") !== (p.result !== undefined) ||
          (p.status === "failed") !== (p.failureCode !== undefined) ||
          (p.status === "waiting_for_answers") !==
            (p.questionsAsked !== undefined && p.clarificationExpiresAt !== undefined) ||
          (p.clarificationExpiresAt !== undefined && p.clarificationExpiresAt <= at)
        )
          throw new DomainRepositoryError("REPOSITORY_INPUT_INVALID");
        const caseStatus =
          p.status === "completed"
            ? p.result?.kind === "guidance"
              ? "completed"
              : p.result?.kind
            : p.status === "waiting_for_answers"
              ? "needs_clarification"
              : ["retrieving", "generating", "validating"].includes(p.status)
                ? "analyzing"
                : p.status;
        if (
          p.status !== "waiting_for_answers" &&
          (p.questionsAsked !== undefined || p.clarificationExpiresAt !== undefined)
        )
          throw new DomainRepositoryError("REPOSITORY_INPUT_INVALID");
        if (
          p.status === "waiting_for_answers" &&
          (g.inputRevision !== 1 ||
            Date.parse(p.clarificationExpiresAt ?? "") - Date.parse(at) !== DAY_MS)
        )
          throw new DomainRepositoryError("REPOSITORY_INPUT_INVALID");
        if (
          p.status === "completed" &&
          ((g.expectedStatus === "screening" && p.result?.kind === "guidance") ||
            (g.expectedStatus === "validating" && p.result?.kind !== "guidance"))
        )
          throw new DomainRepositoryError("REPOSITORY_INPUT_INVALID");
        const transitionGuard =
          currentGuard +
          (p.status === "waiting_for_answers"
            ? " AND EXISTS (SELECT 1 FROM cases WHERE id=? AND questions_asked=0 AND input_revision=1)"
            : "");
        const transitionValues = [
          ...guardValues(g),
          ...(p.status === "waiting_for_answers" ? [g.caseId] : []),
        ];
        const encryptedResult = p.result
          ? await cipher.encrypt(JSON.stringify(p.result), field(g, "encrypted_result"))
          : null;
        // Case status and analysis status share the old guard; the single-batch question count
        // is written last under the newly committed analysis status and operation timestamp.
        const result = await binding.batch([
          ...(p.result?.kind === "guidance"
            ? p.result.citations.map((c) =>
                statement(
                  `INSERT INTO citations(id,analysis_id,source_type,source_id,law_name,article,effective_date,verified_at,source_url,content_hash) SELECT ?,?,'statute',?,?,?,?,?,?,? WHERE ${transitionGuard} ON CONFLICT(id) DO NOTHING`,
                  [
                    `${g.analysisId}_${c.id}`,
                    g.analysisId,
                    c.sourceId,
                    c.lawName,
                    c.article,
                    c.effectiveDate,
                    c.verifiedAt,
                    c.url,
                    c.contentHash,
                    ...transitionValues,
                  ],
                ),
              )
            : []),
          statement(`UPDATE cases SET status=?,updated_at=? WHERE id=? AND ${transitionGuard}`, [
            caseStatus,
            at,
            g.caseId,
            ...transitionValues,
          ]),
          statement(
            `UPDATE analyses SET status=?,encrypted_result=?,failure_code=?,clarification_expires_at=?,completed_at=?,updated_at=? WHERE id=? AND ${transitionGuard}`,
            [
              p.status,
              encryptedResult,
              p.failureCode ?? null,
              p.clarificationExpiresAt ?? null,
              ["completed", "failed"].includes(p.status) ? at : null,
              at,
              g.analysisId,
              ...transitionValues,
            ],
          ),
          ...(p.status === "waiting_for_answers"
            ? [
                statement(
                  `UPDATE cases SET questions_asked=? WHERE id=? AND user_id=? AND current_analysis_id=?
             AND input_revision=1 AND questions_asked=0 AND EXISTS(SELECT 1 FROM analyses
             WHERE id=? AND case_id=? AND input_revision=1 AND attempt=? AND status='waiting_for_answers' AND updated_at=?)`,
                  [
                    p.questionsAsked,
                    g.caseId,
                    g.ownerId,
                    g.analysisId,
                    g.analysisId,
                    g.caseId,
                    g.attempt,
                    at,
                  ],
                ),
              ]
            : []),
        ]);
        return result.at(-1)?.meta.changes === 1;
      });
    },
    // Public source cache has no user/case relationship. #14 owns retrieval and source verification.
    findLatestLegalSource(lawId: string, article: string, asOfDate: string, now: string) {
      return safe(async () => {
        parse(z.string().regex(/^\d{1,12}$/), lawId);
        parse(dateSchema, asOfDate);
        parse(nowSchema, now);
        return await binding
          .prepare(
            "SELECT source_id AS sourceId,effective_date AS effectiveDate,article,content_hash AS contentHash,law_name AS lawName,source_url AS sourceUrl,body,fetched_at AS fetchedAt,expires_at AS expiresAt FROM legal_source_cache WHERE source_id LIKE ? AND article=? AND effective_date<=? AND fetched_at<=? AND expires_at>? ORDER BY effective_date DESC,fetched_at DESC LIMIT 1",
          )
          .bind(`statute:${lawId}:%`, article, asOfDate, now, now)
          .first<{
            sourceId: string;
            effectiveDate: string;
            article: string;
            contentHash: string;
            lawName: string;
            sourceUrl: string;
            body: string;
            fetchedAt: string;
            expiresAt: string;
          }>();
      });
    },
    putLegalSource(metadata: Citation, body: string, fetchedAt: string, expiresAt: string) {
      return safe(async () => {
        const c = parse(citationSchema, metadata);
        const fetched = parse(nowSchema, fetchedAt);
        const expiry = parse(nowSchema, expiresAt);
        if (
          expiry <= fetched ||
          Date.parse(expiry) - Date.parse(fetched) > DAY_MS ||
          typeof body !== "string" ||
          !body ||
          new TextEncoder().encode(body).length > 1024 * 1024
        )
          throw new DomainRepositoryError("REPOSITORY_INPUT_INVALID");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
        const hash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== c.contentHash) throw new DomainRepositoryError("REPOSITORY_INPUT_INVALID");
        await db
          .insert(legalSourceCache)
          .values({
            sourceId: c.sourceId,
            effectiveDate: c.effectiveDate,
            article: c.article,
            contentHash: c.contentHash,
            lawName: c.lawName,
            sourceUrl: c.url,
            body,
            fetchedAt: fetched,
            expiresAt: expiry,
          })
          .onConflictDoUpdate({
            target: [
              legalSourceCache.sourceId,
              legalSourceCache.effectiveDate,
              legalSourceCache.article,
              legalSourceCache.contentHash,
            ],
            set: {
              lawName: c.lawName,
              sourceUrl: c.url,
              body,
              fetchedAt: fetched,
              expiresAt: expiry,
            },
          })
          .run();
      });
    },
    findLegalSource(metadata: Citation, now: string) {
      return safe(async () => {
        const c = parse(citationSchema, metadata);
        const at = parse(nowSchema, now);
        const record = await db
          .select()
          .from(legalSourceCache)
          .where(
            and(
              eq(legalSourceCache.sourceId, c.sourceId),
              eq(legalSourceCache.effectiveDate, c.effectiveDate),
              eq(legalSourceCache.article, c.article),
              eq(legalSourceCache.contentHash, c.contentHash),
            ),
          )
          .get();
        return record && record.fetchedAt <= at && record.expiresAt > at ? record : null;
      });
    },
    // Primary storage primitive only. #12/#17 add route idempotency and Workflow cleanup.
    deleteOwnedCase(
      ownerId: string,
      caseId: string,
      jobId: string,
      now: string,
      idempotency?: { key: string; requestHash: string },
    ) {
      return safe(async () => {
        const owner = parse(ownerSchema, ownerId);
        const id = parse(uuidSchema, caseId);
        const job = parse(uuidSchema, jobId);
        const at = parse(nowSchema, now);
        const expiry = new Date(Date.parse(at) + 35 * DAY_MS).toISOString();
        if (idempotency) {
          parse(idempotencyKeySchema, idempotency.key);
          parse(hashSchema, idempotency.requestHash);
        }
        const route = `/api/cases/${id}`;
        const result = await binding.batch([
          ...(idempotency
            ? [
                statement(
                  "DELETE FROM idempotency_records WHERE user_id=? AND method='DELETE' AND route=? AND key=? AND expires_at<=?",
                  [owner, route, idempotency.key, at],
                ),
              ]
            : []),
          statement(
            `INSERT INTO deletion_jobs(id,target_type,target_id,deleted_at,workflow_instance_ids,primary_state,cleanup_state,attempts,expires_at)
            SELECT ?,'case',c.id,?,(SELECT json_group_array(instance_id) FROM (
              SELECT workflow_instance_id AS instance_id FROM analyses WHERE case_id=c.id
              UNION SELECT o.instance_id FROM dispatch_outbox o JOIN analyses a ON a.id=o.analysis_id WHERE a.case_id=c.id
            )),'deleted','pending',0,? FROM cases c WHERE c.id=? AND c.user_id=?`,
            [job, at, expiry, id, owner],
          ),
          ...(idempotency
            ? [
                statement(
                  `INSERT INTO idempotency_records(user_id,method,route,key,request_hash,response_status,response_json,created_at,expires_at) SELECT ?,'DELETE',?,?,?,204,'null',?,? WHERE EXISTS(SELECT 1 FROM cases WHERE id=? AND user_id=?) AND EXISTS(SELECT 1 FROM deletion_jobs WHERE id=? AND target_id=?)`,
                  [
                    owner,
                    route,
                    idempotency.key,
                    idempotency.requestHash,
                    at,
                    new Date(Date.parse(at) + DAY_MS).toISOString(),
                    id,
                    owner,
                    job,
                    id,
                  ],
                ),
              ]
            : []),
          statement(
            `DELETE FROM cases WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM deletion_jobs
            WHERE id=? AND target_type='case' AND target_id=? AND deleted_at=?)`,
            [id, owner, job, id, at],
          ),
        ]);
        return (result.at(-1)?.meta.changes ?? 0) > 0;
      });
    },
    advanceRevision(
      input: AnalysisGuard,
      replacement: {
        analysisId: string;
        outboxId: string;
        input: string;
        answers: string;
        idempotency?: { key: string; requestHash: string };
      },
      now: string,
    ) {
      return safe(async () => {
        const g = parse(guardSchema, input);
        const at = parse(nowSchema, now);
        const p = parse(
          z.strictObject({
            analysisId: uuidSchema,
            outboxId: uuidSchema,
            input: z.string(),
            answers: z.string(),
            idempotency: z
              .strictObject({ key: idempotencyKeySchema, requestHash: hashSchema })
              .optional(),
          }),
          replacement,
        );
        if (
          g.expectedStatus !== "waiting_for_answers" ||
          g.analysisId === p.analysisId ||
          g.inputRevision >= Number.MAX_SAFE_INTEGER
        )
          throw new DomainRepositoryError("REPOSITORY_INPUT_INVALID");
        const nextRevision = g.inputRevision + 1;
        const newInput = await cipher.encrypt(p.input, {
          table: "cases",
          column: "encrypted_input",
          rowId: g.caseId,
          userId: g.ownerId,
        });
        const answers = await cipher.encrypt(p.answers, field(g, "encrypted_answers"));
        // CAS writes an opaque new analysis ID + revision as an admission claim. All subsequent
        // statements require that claim; stale owner/status/revision cannot supersede an analysis.
        const claimed = `EXISTS (SELECT 1 FROM cases c WHERE c.id=? AND c.user_id=? AND c.current_analysis_id=? AND c.input_revision=?)`;
        const claimValues = [g.caseId, g.ownerId, p.analysisId, nextRevision];
        const result = await binding.batch([
          ...(p.idempotency
            ? [
                statement(
                  "DELETE FROM idempotency_records WHERE user_id=? AND method='POST' AND route=? AND key=? AND expires_at<=?",
                  [g.ownerId, `/api/cases/${g.caseId}/answers`, p.idempotency.key, at],
                ),
              ]
            : []),
          statement(
            `UPDATE cases SET current_analysis_id=?,input_revision=?,encrypted_input=?,status='queued',updated_at=?
            WHERE id=? AND status='needs_clarification' AND ${currentGuard}
            AND EXISTS(SELECT 1 FROM analyses WHERE id=? AND clarification_expires_at>?)`,
            [
              p.analysisId,
              nextRevision,
              newInput,
              at,
              g.caseId,
              ...guardValues(g),
              g.analysisId,
              at,
            ],
          ),
          statement(
            `UPDATE analyses SET status='superseded',encrypted_answers=?,updated_at=?
            WHERE id=? AND case_id=? AND input_revision=? AND attempt=? AND status='waiting_for_answers' AND ${claimed}`,
            [answers, at, g.analysisId, g.caseId, g.inputRevision, g.attempt, ...claimValues],
          ),
          statement(
            `INSERT INTO analyses(id,case_id,workflow_instance_id,input_revision,attempt,status,created_at,updated_at)
            SELECT ?,?,?,?,1,'queued',?,? WHERE ${claimed}`,
            [p.analysisId, g.caseId, `${p.analysisId}-1`, nextRevision, at, at, ...claimValues],
          ),
          statement(
            `INSERT INTO dispatch_outbox(id,analysis_id,attempt,instance_id,revision,state,attempts,next_attempt_at,created_at)
            SELECT ?,?,1,?,?,'pending',0,?,? WHERE ${claimed}`,
            [p.outboxId, p.analysisId, `${p.analysisId}-1`, nextRevision, at, at, ...claimValues],
          ),
          ...(p.idempotency
            ? [
                statement(
                  `INSERT INTO idempotency_records(user_id,method,route,key,request_hash,response_status,response_json,created_at,expires_at) SELECT ?,'POST',?,?,?,202,?,?,? WHERE ${claimed}`,
                  [
                    g.ownerId,
                    `/api/cases/${g.caseId}/answers`,
                    p.idempotency.key,
                    p.idempotency.requestHash,
                    JSON.stringify({
                      caseId: g.caseId,
                      analysisId: p.analysisId,
                      inputRevision: nextRevision,
                      status: "queued",
                    }),
                    at,
                    new Date(Date.parse(at) + DAY_MS).toISOString(),
                    ...claimValues,
                  ],
                ),
              ]
            : []),
        ]);
        return result.at(-1)?.meta.changes === 1;
      });
    },
    retryAnalysis(
      ownerId: string,
      caseId: string,
      analysisId: string,
      revision: number,
      attempt: number,
      key: string,
      requestHash: string,
      now: string,
    ) {
      return safe(async () => {
        parse(ownerSchema, ownerId);
        parse(uuidSchema, caseId);
        parse(uuidSchema, analysisId);
        parse(revisionSchema, revision);
        parse(z.number().int().min(1).max(2), attempt);
        parse(idempotencyKeySchema, key);
        parse(hashSchema, requestHash);
        parse(nowSchema, now);
        const instance = `${analysisId}-${attempt + 1}`;
        const old = `id=? AND attempt=? AND status='failed' AND failure_code IN ('DISPATCH_FAILED','MODEL_UNAVAILABLE','LEGAL_SOURCE_UNAVAILABLE','ANALYSIS_TIMEOUT','INTERNAL_ERROR') AND EXISTS(SELECT 1 FROM cases WHERE id=? AND user_id=? AND current_analysis_id=? AND input_revision=?)`;
        const requestClaim = `EXISTS(SELECT 1 FROM idempotency_records WHERE user_id=? AND method='POST' AND route=? AND key=? AND request_hash=?)`;
        const requestValues = [ownerId, `/api/cases/${caseId}/retry`, key, requestHash];
        const claimed = `EXISTS(SELECT 1 FROM analyses a JOIN cases c ON c.current_analysis_id=a.id WHERE a.id=? AND a.attempt=? AND a.status='queued' AND a.workflow_instance_id=? AND c.user_id=? AND c.id=? AND c.input_revision=?) AND ${requestClaim}`;
        const values = [
          analysisId,
          attempt + 1,
          instance,
          ownerId,
          caseId,
          revision,
          ...requestValues,
        ];
        const result = await binding.batch([
          statement(
            "DELETE FROM idempotency_records WHERE user_id=? AND method='POST' AND route=? AND key=? AND expires_at<=?",
            [ownerId, `/api/cases/${caseId}/retry`, key, now],
          ),
          statement(
            `INSERT INTO idempotency_records(user_id,method,route,key,request_hash,response_status,response_json,created_at,expires_at) SELECT ?,'POST',?,?,?,202,?,?,? WHERE EXISTS(SELECT 1 FROM analyses WHERE ${old})`,
            [
              ownerId,
              `/api/cases/${caseId}/retry`,
              key,
              requestHash,
              JSON.stringify({ analysisId, inputRevision: revision, status: "queued" }),
              now,
              new Date(Date.parse(now) + DAY_MS).toISOString(),
              analysisId,
              attempt,
              caseId,
              ownerId,
              analysisId,
              revision,
            ],
          ),
          statement(
            `UPDATE analyses SET attempt=attempt+1,workflow_instance_id=?,status='queued',failure_code=NULL,encrypted_context=NULL,started_at=NULL,completed_at=NULL,updated_at=? WHERE ${old} AND ${requestClaim}`,
            [
              instance,
              now,
              analysisId,
              attempt,
              caseId,
              ownerId,
              analysisId,
              revision,
              ...requestValues,
            ],
          ),
          statement(`UPDATE cases SET status='queued',updated_at=? WHERE id=? AND ${claimed}`, [
            now,
            caseId,
            ...values,
          ]),
          statement(
            `INSERT INTO dispatch_outbox(id,analysis_id,attempt,instance_id,revision,state,attempts,next_attempt_at,created_at) SELECT ?,?,?,?,?,'pending',0,?,? WHERE ${claimed}`,
            [crypto.randomUUID(), analysisId, attempt + 1, instance, revision, now, now, ...values],
          ),
        ]);
        return result.at(-1)?.meta.changes === 1;
      });
    },
  };
}
