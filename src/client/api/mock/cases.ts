import { z } from "zod";
import { V2_INTAKE_POLICY, V2_LIMITS } from "../../../contracts/v2";
import {
  answersInputSchema,
  createInputSchema,
  type QuestionRound,
  revisionInputSchema,
  summaryInputSchema,
} from "../cases";
import { ApiError } from "../errors";
import type { CaseView, QuestionView } from "../types";
import { readStore, registerMockHandlers, requireSession, writeStore } from "./runtime";

type Intake = { narrative: string; questions: QuestionView[]; rounds?: QuestionRound[] };
type Receipt = { ownerId: string; fingerprint: string; result: unknown };
const idInput = z.object({ id: z.string().min(1).max(200) });
export const casesFixtures: Record<string, CaseView> = {};
function owner() {
  const session = requireSession({ consent: false });
  if (!session.user) throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
  if (readStore<string[]>("deletedAccountIds", []).includes(session.user.id))
    throw new ApiError("UNAUTHENTICATED", "로그인이 필요해요.");
  return session.user.id;
}
function owned(id: string): CaseView {
  const user = owner(),
    owners = readStore<Record<string, string>>("caseOwners", {}),
    item = readStore<Record<string, CaseView>>("cases", casesFixtures)[id];
  if (!item || owners[id] !== user || readStore<string[]>("deletedCaseIds", []).includes(id))
    throw new ApiError("NOT_FOUND", "사건을 찾을 수 없어요.");
  return item;
}
function intake(id: string): Intake {
  const value = readStore<Record<string, Intake>>("intake", {})[id];
  if (!value) throw new ApiError("NOT_FOUND", "저장한 질문을 찾을 수 없어요.");
  return value;
}
function result(item: CaseView, value: Intake) {
  const rounds = value.rounds ?? [{ ordinal: 1, questionIds: value.questions.map((q) => q.id) }];
  const roundLimit = value.rounds ? V2_INTAKE_POLICY.followupRounds : rounds.length;
  return {
    questions: value.questions,
    revision: item.revision,
    complete: item.stage === "summary" || item.stage === "active",
    roundLimit,
    rounds,
    processingStage: rounds.length >= roundLimit ? ("summary" as const) : ("questions" as const),
  };
}
function store(item: CaseView, value?: Intake) {
  if (value) {
    const records = readStore<Record<string, Intake>>("intake", {});
    records[item.id] = value;
    writeStore("intake", records);
  }
  const records = readStore<Record<string, CaseView>>("cases", {});
  records[item.id] = item;
  writeStore("cases", records);
}
function guard(item: CaseView, expected: number) {
  if (item.revision !== expected)
    throw new ApiError("CONFLICT", "다른 화면에서 내용이 바뀌었어요. 최신 내용을 확인해 주세요.");
}
function changed(item: CaseView, update: Partial<CaseView>): CaseView {
  return { ...item, ...update, revision: item.revision + 1, updatedAt: new Date().toISOString() };
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const value = schema.safeParse(raw);
  if (!value.success) throw new ApiError("VALIDATION_ERROR", "입력한 내용을 확인해 주세요.");
  return value.data;
}
function replay<T>(operation: string, raw: unknown, key: string, run: () => T): T {
  const user = owner(),
    identity = `${user}:${operation}:${key}`,
    fingerprint = JSON.stringify(raw),
    receipts = readStore<Record<string, Receipt>>("caseRequests", {});
  const previous = receipts[identity];
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new ApiError("CONFLICT", "같은 요청 키에 다른 내용이 포함됐어요.");
    return previous.result as T;
  }
  const response = run();
  receipts[identity] = { ownerId: user, fingerprint, result: response };
  writeStore("caseRequests", Object.fromEntries(Object.entries(receipts).slice(-100)));
  return response;
}
function makeQuestions(narrative: string, subject: "individual" | "company"): QuestionView[] {
  const money = /돈|송금|대금|빌려|보증금|급여|월급/.test(narrative);
  const work = /월급|급여|퇴직|해고|회사|근로/.test(narrative);
  return [
    {
      id: crypto.randomUUID(),
      kind: "text",
      text: work ? "언제부터 어떤 일을 했나요?" : "이 일은 언제 시작됐나요?",
    },
    {
      id: crypto.randomUUID(),
      kind: "text",
      text: money
        ? "얼마의 금액이 관련되어 있나요?"
        : subject === "company"
          ? "기업과 상대방은 어떤 관계인가요?"
          : "상대방과 어떤 관계인가요?",
    },
    { id: crypto.randomUUID(), kind: "text", text: "이번 일을 어떻게 정리하고 싶나요?" },
  ];
}
function makeDeeperQuestions(value: Intake): QuestionView[] {
  const context = [value.narrative, ...value.questions.map((q) => q.answer ?? "")].join(" ");
  const money = /돈|송금|대금|빌려|보증금|급여|월급/.test(context);
  return [
    {
      id: crypto.randomUUID(),
      kind: "text",
      text: money ? "상대방과 어떤 약속을 했나요?" : "상대방은 이 일에 대해 뭐라고 했나요?",
    },
    {
      id: crypto.randomUUID(),
      kind: "choice",
      text: "확인할 수 있는 자료가 있나요?",
      options: ["계약서나 문서가 있어요", "문자·메신저·녹음이 있어요", "현재 자료가 없어요"],
    },
    {
      id: crypto.randomUUID(),
      kind: "text",
      text: "내 입장에 불리하거나, 서로 다르게 기억하는 내용이 있나요?",
    },
  ];
}
export const casesMockHandlers = {
  "cases.list": () => {
    const user = owner(),
      owners = readStore<Record<string, string>>("caseOwners", {});
    return Object.values(readStore<Record<string, CaseView>>("cases", casesFixtures))
      .filter(
        (item) =>
          owners[item.id] === user && !readStore<string[]>("deletedCaseIds", []).includes(item.id),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  "cases.get": (raw: unknown) => owned(parse(idInput, raw).id),
  "cases.create": (raw: unknown, context: { key: string }) =>
    replay("create", raw, context.key, () => {
      const input = parse(createInputSchema, raw),
        user = owner(),
        records = readStore<Record<string, CaseView>>("cases", {}),
        owners = readStore<Record<string, string>>("caseOwners", {});
      if (
        Object.values(records).filter(
          (item) =>
            owners[item.id] === user &&
            !readStore<string[]>("deletedCaseIds", []).includes(item.id),
        ).length >= V2_LIMITS.dailyCases
      )
        throw new ApiError(
          "QUOTA_EXCEEDED",
          "예시에서는 사건을 3개까지 만들 수 있어요. 저장한 사건을 정리해 주세요.",
        );
      const item: CaseView = {
        id: crypto.randomUUID(),
        title: [...input.narrative].slice(0, 45).join(""),
        subjectContext: input.subjectContext,
        stage: "intake",
        revision: 1,
        updatedAt: new Date().toISOString(),
        summary: "",
        schemaVersion: "2",
      };
      owners[item.id] = user;
      writeStore("caseOwners", owners);
      const questions = makeQuestions(input.narrative, input.subjectContext);
      store(item, {
        narrative: input.narrative,
        questions,
        rounds: [{ ordinal: 1, questionIds: questions.map((q) => q.id) }],
      });
      return item;
    }),
  "cases.getQuestions": (raw: unknown) => {
    const { id } = parse(idInput, raw),
      item = owned(id);
    return result(item, intake(id));
  },
  "cases.saveAnswers": (raw: unknown, context: { key: string }) =>
    replay("answers", raw, context.key, () => {
      const { id } = parse(idInput, raw),
        input = parse(answersInputSchema, raw),
        item = owned(id),
        value = intake(id);
      guard(item, input.expectedRevision);
      if (item.stage === "active" || item.stage === "archived")
        throw new ApiError(
          "CONFLICT",
          "이미 확인한 요약이에요. 사건 화면에서 새 내용을 정리해 주세요.",
        );
      for (const answer of input.answers) {
        const q = value.questions.find((q) => q.id === answer.questionId);
        if (
          !q ||
          (answer.state === "answered" && q.kind === "choice" && !q.options?.includes(answer.value))
        )
          throw new ApiError("VALIDATION_ERROR", "질문에 맞는 답변을 선택해 주세요.");
      }
      value.questions = value.questions.map((q) => {
        const answer = input.answers.find((a) => a.questionId === q.id);
        if (!answer) return q;
        const { answer: _old, answerState: _state, ...base } = q;
        return {
          ...base,
          answerState: answer.state,
          ...(answer.state === "answered" ? { answer: answer.value } : {}),
        };
      });
      const next = changed(item, { stage: "intake", summary: "" });
      store(next, value);
      return result(next, value);
    }),
  "cases.advance": (raw: unknown, context: { key: string }) =>
    replay("advance", raw, context.key, () => {
      const { id } = parse(idInput, raw),
        input = parse(revisionInputSchema, raw),
        item = owned(id),
        value = intake(id);
      guard(item, input.expectedRevision);
      if (item.stage === "archived")
        throw new ApiError("CONFLICT", "보관한 사건은 사건 화면에서 확인해 주세요.");
      if (item.stage === "summary" || item.stage === "active") return result(item, value);
      if (!value.questions.every((q) => q.answerState))
        throw new ApiError(
          "VALIDATION_ERROR",
          "모든 질문에 답변·모름·건너뛰기 중 하나를 저장해 주세요.",
        );
      if (value.rounds && value.rounds.length < V2_INTAKE_POLICY.followupRounds) {
        const questions = makeDeeperQuestions(value);
        value.questions.push(...questions);
        value.rounds.push({
          ordinal: value.rounds.length + 1,
          questionIds: questions.map((q) => q.id),
        });
        const next = changed(item, { stage: "intake", summary: "" });
        store(next, value);
        return result(next, value);
      }
      const summary = [
        "입력한 상황",
        value.narrative,
        "",
        ...value.questions.flatMap((q) => [
          q.text,
          q.answerState === "answered"
            ? (q.answer ?? "")
            : q.answerState === "unknown"
              ? "모름 — 추가 확인이 필요해요."
              : "건너뛰기 — 아직 확인하지 않았어요.",
          "",
        ]),
      ].join("\n");
      const next = changed(item, {
        stage: "summary",
        summary: [...summary].slice(0, 5000).join(""),
      });
      store(next);
      return result(next, value);
    }),
  "cases.saveSummary": (raw: unknown, context: { key: string }) =>
    replay("summary", raw, context.key, () => {
      const { id } = parse(idInput, raw),
        input = parse(summaryInputSchema, raw),
        item = owned(id);
      guard(item, input.expectedRevision);
      if (item.stage !== "summary")
        throw new ApiError("CONFLICT", "현재 요약을 먼저 준비해 주세요.");
      const next = changed(item, { summary: input.summary });
      store(next);
      return next;
    }),
  "cases.confirmSummary": (raw: unknown, context: { key: string }) =>
    replay("confirm", raw, context.key, () => {
      const { id } = parse(idInput, raw),
        input = parse(revisionInputSchema, raw),
        item = owned(id);
      guard(item, input.expectedRevision);
      if (item.stage !== "summary" || !item.summary.trim())
        throw new ApiError("VALIDATION_ERROR", "저장한 요약을 확인해 주세요.");
      const next = changed(item, { stage: "active" });
      store(next);
      return next;
    }),
};
registerMockHandlers(casesMockHandlers);
