import { describe, expect, test } from "bun:test";
import {
  analysisStatusResponseSchema,
  answersForQuestionsSchema,
  answersRequestSchema,
  answersResponseSchema,
  caseDetailResponseSchema,
  caseListQuerySchema,
  caseListResponseSchema,
  caseStatusSchema,
  citationSchema,
  createCaseRequestSchema,
  createCaseResponseSchema,
  cursorSchema,
  dateSchema,
  errorResponseSchema,
  factSchema,
  idempotencyKeySchema,
  officialSourceUrlSchema,
  questionOutputSchema,
  questionsSchema,
  resultForAllowlistSchema,
  resultSchema,
  retryRequestSchema,
  screeningOutputSchema,
  timestampSchema,
  validationOutputSchema,
} from "../src/contracts";
import {
  analysisId,
  caseId,
  facts,
  guidance,
  outOfScope,
  questions,
  syntheticCitation,
  urgentRedirect,
} from "./fixtures/contracts";

const input = {
  narrative: "합성 사용자 A가 지인에게 금전을 빌려주었다고 진술했습니다.",
  turnstileToken: "synthetic-token",
};
const error = {
  code: "MODEL_UNAVAILABLE",
  message: "분석을 완료하지 못했어요.",
  requestId: "request_1",
  retryable: true,
  details: {},
};
const detail = {
  caseId,
  analysisId,
  title: "금전 대여 사건",
  inputRevision: 1,
  status: "completed",
  questions: [],
  result: guidance,
  error: null,
};

describe("strict shared contracts", () => {
  test("three result branches and attributed synthetic facts parse", () => {
    for (const result of [guidance, outOfScope, urgentRedirect])
      expect(resultSchema.safeParse(result).success).toBe(true);
    for (const fact of facts) expect(factSchema.safeParse(fact).success).toBe(true);
    expect(caseDetailResponseSchema.safeParse(detail).success).toBe(true);
    expect(questionOutputSchema.safeParse({ schemaVersion: "1", questions }).success).toBe(true);
  });
  test("trimmed code-point narrative and answer boundaries include non-BMP text", () => {
    for (const length of [20, 5000])
      expect(
        createCaseRequestSchema.parse({ ...input, narrative: `  ${"😀".repeat(length)}  ` })
          .narrative,
      ).toBe("😀".repeat(length));
    for (const length of [0, 19, 5001])
      expect(
        createCaseRequestSchema.safeParse({ ...input, narrative: "😀".repeat(length) }).success,
      ).toBe(false);
    expect(
      answersRequestSchema.safeParse({
        inputRevision: 1,
        answers: [{ questionId: "q1", status: "answered", value: "😀".repeat(1000) }],
      }).success,
    ).toBe(true);
    for (const value of [" ", "😀".repeat(1001)])
      expect(
        answersRequestSchema.safeParse({
          inputRevision: 1,
          answers: [{ questionId: "q1", status: "answered", value }],
        }).success,
      ).toBe(false);
  });
  test("rejects unknown fields, versions, IDs, states and unsafe details", () => {
    expect(createCaseRequestSchema.safeParse({ ...input, userId: "injected" }).success).toBe(false);
    expect(resultSchema.safeParse({ ...guidance, schemaVersion: "2" }).success).toBe(false);
    expect(resultSchema.safeParse({ ...outOfScope, summary: guidance.summary }).success).toBe(
      false,
    );
    expect(
      createCaseResponseSchema.safeParse({
        caseId: "not-uuid",
        analysisId,
        inputRevision: 1,
        status: "screening",
      }).success,
    ).toBe(false);
    expect(
      createCaseResponseSchema.safeParse({
        caseId,
        analysisId,
        inputRevision: 2,
        status: "screening",
      }).success,
    ).toBe(false);
    for (const status of ["draft", "deleted", "admin"])
      expect(caseStatusSchema.safeParse(status).success).toBe(false);
    expect(errorResponseSchema.safeParse({ error }).success).toBe(true);
    for (const patch of [
      { code: "SQL_ERROR" },
      { details: { stack: "private" } },
      { details: { fields: [{ field: "narrative", code: "invalid", value: "private" }] } },
    ])
      expect(errorResponseSchema.safeParse({ error: { ...error, ...patch } }).success).toBe(false);
    expect(retryRequestSchema.safeParse({ inputRevision: 0 }).success).toBe(false);
    expect(
      retryRequestSchema.safeParse({ inputRevision: Number.MAX_SAFE_INTEGER + 1 }).success,
    ).toBe(false);
  });
  test("question and choice allowlists enforce exact single-batch answers", () => {
    const valid = {
      inputRevision: 1,
      answers: [
        { questionId: "q1", status: "unknown" },
        { questionId: "q2", status: "answered", value: "있음" },
      ],
    };
    const schema = answersForQuestionsSchema(questions);
    expect(schema.safeParse(valid).success).toBe(true);
    for (const answers of [
      valid.answers.slice(1),
      [...valid.answers, valid.answers[0]],
      [{ questionId: "other", status: "unknown" }, valid.answers[1]],
      [valid.answers[0], { questionId: "q2", status: "answered", value: "injected option" }],
      [{ questionId: "q1", status: "unknown", value: "" }, valid.answers[1]],
      [{ questionId: "q1", status: "skipped", value: "secret" }, valid.answers[1]],
    ])
      expect(schema.safeParse({ ...valid, answers }).success).toBe(false);
    expect(questionsSchema.safeParse([...questions, questions[0]]).success).toBe(false);
    expect(
      questionsSchema.safeParse(
        Array.from({ length: 6 }, (_, i) => ({ ...questions[0], id: `q${i}` })),
      ).success,
    ).toBe(false);
    for (const options of [
      [],
      ["one"],
      ["one", " one "],
      Array.from({ length: 7 }, (_, i) => `${i}`),
    ])
      expect(questionsSchema.safeParse([{ ...questions[1], options }]).success).toBe(false);
    expect(questionsSchema.safeParse([{ ...questions[0], options: ["forbidden"] }]).success).toBe(
      false,
    );
  });
  test("citations reject forged hosts, credentials, hashes, IDs and future laws", () => {
    for (const url of [
      "http://law.go.kr/x",
      "https://law.go.kr.evil.example/x",
      "https://law.go.kr@evil.example/",
      "https://user:pass@law.go.kr/x",
      "https://law.go.kr:444/x",
      "https://open.law.go.kr/x?OC=secret",
    ])
      expect(officialSourceUrlSchema.safeParse(url).success).toBe(false);
    expect(
      citationSchema.safeParse({ ...syntheticCitation, contentHash: "b".repeat(64) }).success,
    ).toBe(false);
    expect(
      citationSchema.safeParse({ ...syntheticCitation, effectiveDate: "2025-01-01" }).success,
    ).toBe(false);
    expect(resultSchema.safeParse({ ...guidance, asOfDate: "2025-01-01" }).success).toBe(false);
    expect(
      resultSchema.safeParse({ ...guidance, citations: [syntheticCitation, syntheticCitation] })
        .success,
    ).toBe(false);
    expect(resultSchema.safeParse({ ...guidance, citations: [] }).success).toBe(false);
    const allowlisted = resultForAllowlistSchema({ citations: [syntheticCitation] });
    expect(allowlisted.safeParse(guidance).success).toBe(true);
    expect(resultForAllowlistSchema({ citations: [] }).safeParse(guidance).success).toBe(false);
    expect(
      allowlisted.safeParse({
        ...guidance,
        citations: [{ ...syntheticCitation, article: "forged" }],
      }).success,
    ).toBe(false);
    expect(
      resultSchema.safeParse({
        ...guidance,
        issues: [{ ...guidance.issues[0], citationIds: ["citation_1", "citation_1"] }],
      }).success,
    ).toBe(false);
  });
  test("policy links require exact server-approved label and URL", () => {
    expect(officialSourceUrlSchema.safeParse("not a URL").success).toBe(false);
    const link = { label: "합성 안내", url: "https://example.org/synthetic-help" };
    const result = { ...urgentRedirect, helpLinks: [link] };
    expect(resultForAllowlistSchema().safeParse(result).success).toBe(false);
    expect(resultSchema.safeParse(result).success).toBe(true);
    expect(
      caseDetailResponseSchema.safeParse({ ...detail, status: "urgent_redirect", result }).success,
    ).toBe(true);
    const approved = resultForAllowlistSchema({ helpLinks: [link] });
    expect(approved.safeParse(result).success).toBe(true);
    expect(
      approved.safeParse({ ...result, helpLinks: [{ ...link, label: "unapproved" }] }).success,
    ).toBe(false);
    expect(resultSchema.safeParse({ ...urgentRedirect, reasonCode: "invented" }).success).toBe(
      false,
    );
  });
  test("bounded result collections, text, HTML and impossible facts fail closed", () => {
    expect(
      validationOutputSchema.safeParse({
        schemaVersion: "1",
        pass: true,
        findings: [],
        sanitizedResult: guidance,
      }).success,
    ).toBe(true);
    expect(
      validationOutputSchema.safeParse({
        schemaVersion: "1",
        pass: false,
        findings: [],
        sanitizedResult: guidance,
      }).success,
    ).toBe(false);
    expect(
      validationOutputSchema.safeParse({
        schemaVersion: "1",
        pass: false,
        findings: [],
        sanitizedResult: null,
      }).success,
    ).toBe(true);
    for (const patch of [
      { notices: Array(6).fill("notice") },
      { notices: ["<script>alert(1)</script>"] },
      { notices: ["x".repeat(501)] },
      { summary: { ...guidance.summary, unknowns: Array(21).fill("unknown") } },
      { issues: [{ ...guidance.issues[0], uncertainty: "" }] },
      {
        timeline: [
          { date: null, event: "invented fact", source: "ai_organization", confidence: "stated" },
        ],
      },
    ])
      expect(resultSchema.safeParse({ ...guidance, ...patch }).success).toBe(false);
    for (const patch of [
      { source: "ai_organization", confidence: "stated" },
      { confidence: "unknown" },
      { originalValue: null },
      { confidence: "verified" },
    ])
      expect(factSchema.safeParse({ ...facts[0], ...patch }).success).toBe(false);
    expect(
      validationOutputSchema.safeParse({
        schemaVersion: "1",
        pass: true,
        findings: [{ code: "UNVERIFIED_CITATION", severity: "critical" }],
      }).success,
    ).toBe(false);
    expect(
      screeningOutputSchema.safeParse({
        schemaVersion: "1",
        inScope: true,
        urgency: "urgent",
        reasonCode: "IN_SCOPE",
      }).success,
    ).toBe(false);
  });
  test("dates, pagination and idempotency are strict and bounded", () => {
    expect(dateSchema.safeParse("2024-02-29").success).toBe(true);
    for (const date of ["2026-02-29", "2026-13-01", "yesterday"])
      expect(dateSchema.safeParse(date).success).toBe(false);
    expect(timestampSchema.safeParse("2026-10-05T09:00:00+09:00").success).toBe(false);
    expect(caseListQuerySchema.parse({}).limit).toBe(20);
    for (const limit of ["0", "51", "", "1.5", "1e1", " 2"])
      expect(caseListQuerySchema.safeParse({ limit }).success).toBe(false);
    const cursor = btoa(JSON.stringify({ createdAt: "2026-10-05T00:00:00Z", id: caseId }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(cursorSchema.safeParse(cursor).success).toBe(true);
    expect(cursorSchema.safeParse(btoa('{"id":"injected"}')).success).toBe(false);
    expect(caseListResponseSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    for (const key of ["x".repeat(15), "x".repeat(129), "invalid key with spaces"])
      expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
  });
  test("response state cannot expose unfinished results or inconsistent retries", () => {
    for (const patch of [{ status: "analyzing" }, { result: null }, { questions }, { error }])
      expect(caseDetailResponseSchema.safeParse({ ...detail, ...patch }).success).toBe(false);
    expect(
      answersResponseSchema.safeParse({ caseId, analysisId, inputRevision: 1, status: "queued" })
        .success,
    ).toBe(false);
    const status = {
      caseId,
      analysisId,
      inputRevision: 1,
      status: "failed",
      updatedAt: "2026-10-05T00:00:00Z",
      retryable: true,
      retryAttemptsRemaining: 2,
      error,
    };
    expect(analysisStatusResponseSchema.safeParse(status).success).toBe(true);
    for (const patch of [{ status: "completed" }, { retryAttemptsRemaining: 0 }, { error: null }])
      expect(analysisStatusResponseSchema.safeParse({ ...status, ...patch }).success).toBe(false);
  });
});
