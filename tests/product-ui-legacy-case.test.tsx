import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import ts from "typescript";
import { accessHref } from "../src/client/return-path";
import type { CaseDetail } from "../src/contracts";
import * as contracts from "../src/contracts";
import { Button } from "../src/product-ui/Button";
import { TextareaField } from "../src/product-ui/Field";
import { CaseDetailView } from "../src/product-ui/legacy-case/CaseDetailView";
import { FeedbackView } from "../src/product-ui/legacy-case/FeedbackView";
import * as presentation from "../src/product-ui/legacy-case/presentation";
import { QuestionsView } from "../src/product-ui/legacy-case/QuestionsView";
import { LegacyResultView } from "../src/product-ui/legacy-case/ResultView";
import type { CaseDetailController } from "../src/product-ui/legacy-case/useCaseDetailController";
import type { FeedbackController } from "../src/product-ui/legacy-case/useFeedbackController";
import type {
  LegacyQuestionsController,
  LegacyQuestionsProps,
} from "../src/product-ui/legacy-case/useLegacyQuestionsController";
import type { LegacyResultController } from "../src/product-ui/legacy-case/useLegacyResultController";
import { SelectField } from "../src/product-ui/Select";
import {
  analysisId,
  caseId,
  guidance,
  outOfScope,
  questions,
  urgentRedirect,
} from "./fixtures/contracts";

function detail(overrides: Partial<CaseDetail> = {}): CaseDetail {
  return {
    caseId,
    analysisId,
    title: "합성 사건",
    status: "completed",
    inputRevision: 3,
    questions: [],
    result: guidance,
    error: null,
    ...overrides,
  };
}
function problem(retryable = true) {
  return {
    code: "LEGAL_SOURCE_UNAVAILABLE" as const,
    message: "합성 자료 확인 실패",
    requestId: "synthetic-request",
    retryable,
    details: {},
  };
}
function controller(overrides: Partial<CaseDetailController> = {}): CaseDetailController {
  return {
    caseId,
    detail: null,
    stage: "",
    error: "",
    busy: false,
    confirmDelete: false,
    deleted: false,
    consent: false,
    heading: { current: null },
    refreshSignal: { current: null },
    mutate: async () => {},
    setConfirmDelete: () => {},
    ...overrides,
  };
}
function view(c: CaseDetailController) {
  return (
    <CaseDetailView
      controller={c}
      questions={<p>SYNTHETIC_QUESTIONS_SLOT</p>}
      result={<p>SYNTHETIC_RESULT_SLOT</p>}
      feedback={<p>SYNTHETIC_FEEDBACK_SLOT</p>}
    />
  );
}
type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  const result: Element[] = [];
  Children.forEach(node, (value) => {
    if (!isValidElement<Record<string, unknown>>(value)) return;
    result.push(value);
    result.push(...elements(value.props.children as ReactNode));
  });
  return result;
}
function button(tree: ReactNode, text: string) {
  const found = elements(tree).find((node) => node.type === Button && node.props.children === text);
  if (!found) throw new Error(`MISSING_SYNTHETIC_BUTTON:${text}`);
  return found.props as Parameters<typeof Button>[0];
}

// Evaluate the current unmodified hook bodies with explicit local ports. No
// global module/fetch mocks, browser, network, real timers or provider IO are used.
function hookHarness<Props, Value>(
  file: string,
  name: string,
  props: Props,
  fetchPort: (input: string, init?: RequestInit) => Promise<Response> = async () => {
    throw new Error("UNEXPECTED_SYNTHETIC_REQUEST");
  },
) {
  const slots: unknown[] = [];
  type Effect = { deps: readonly unknown[]; cleanup?: (() => void) | undefined };
  let cursor = 0;
  let effects: (() => void)[] = [];
  const listeners = new Map<string, () => void>();
  const timers = new Map<number, () => void>();
  const redirects: string[] = [];
  const analytics: unknown[][] = [];
  let timerId = 0;
  let keyId = 0;
  const same = (left: readonly unknown[], right: readonly unknown[]) =>
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (next: unknown) => {
          slots[index] =
            typeof next === "function"
              ? (next as (current: unknown) => unknown)(slots[index])
              : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback: unknown, deps: readonly unknown[]) {
      const index = cursor++;
      const prior = slots[index] as { callback: unknown; deps: readonly unknown[] } | undefined;
      if (!prior || !same(prior.deps, deps)) slots[index] = { callback, deps };
      return (slots[index] as { callback: unknown }).callback;
    },
    useEffect(create: () => (() => void) | undefined, deps: readonly unknown[]) {
      const index = cursor++;
      const prior = slots[index] as Effect | undefined;
      if (prior && same(prior.deps, deps)) return;
      effects.push(() => {
        prior?.cleanup?.();
        slots[index] = { deps, cleanup: create() };
      });
    },
  };
  const eventPort = (prefix: string) => ({
    addEventListener: (event: string, callback: () => void) =>
      listeners.set(`${prefix}:${event}`, callback),
    removeEventListener: (event: string) => listeners.delete(`${prefix}:${event}`),
  });
  const document = { hidden: false, ...eventPort("document") };
  const exports: Record<string, unknown> = {};
  const ports: Record<string, unknown> = {
    react,
    "../../client/return-path": { accessHref },
    "../../contracts": contracts,
    "../../components/intake/CaseList": {
      statusLabels: {
        completed: "결과 완료",
        failed: "분석 실패",
        needs_clarification: "추가 질문",
        screening: "입력 확인",
        queued: "분석 대기",
        analyzing: "공식 자료 확인·결과 점검",
        out_of_scope: "지원 범위 안내",
        urgent_redirect: "긴급 안전 안내",
      },
    },
    "./presentation": presentation,
    "../../server/modules/analytics/browser": {
      trackCase: (...args: unknown[]) => analytics.push(args),
      observeResult: () => () => {},
    },
  };
  const source = readFileSync(
    new URL(`../src/product-ui/legacy-case/${file}.ts`, import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2024 },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    require: (specifier: string) => {
      if (!Object.hasOwn(ports, specifier)) throw new Error(`UNEXPECTED_PORT:${specifier}`);
      return ports[specifier];
    },
    fetch: fetchPort,
    window: {
      ...eventPort("window"),
      location: { assign: (href: string) => redirects.push(href) },
    },
    document,
    crypto: { randomUUID: () => `synthetic-idempotency-key-${++keyId}` },
    setTimeout: (callback: () => void) => {
      const id = ++timerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
    AbortController,
    Error,
  });
  const invoke = exports[name] as (input: Props) => Value;
  function render() {
    cursor = 0;
    const value = invoke(props);
    const pending = effects;
    effects = [];
    for (const effect of pending) effect();
    return value;
  }
  return {
    render,
    document,
    redirects,
    analytics,
    timers,
    event: (surface: "window" | "document", name: string) =>
      listeners.get(`${surface}:${name}`)?.(),
    unmount: () => {
      for (const slot of slots) (slot as Effect | undefined)?.cleanup?.();
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const json = (body: unknown, status = 200) => Response.json(body, { status });

function questionsController(
  overrides: Partial<LegacyQuestionsController> = {},
): LegacyQuestionsController {
  return {
    questions,
    revision: 3,
    busy: false,
    answers: {},
    error: "",
    value: () => "",
    choose: () => {},
    submit: async () => {},
    ...overrides,
  };
}
const resultController = (
  overrides: Partial<LegacyResultController> = {},
): LegacyResultController => ({
  checked: {},
  summary: { current: null },
  evidenceChange: () => () => {},
  citationClick: () => () => {},
  ...overrides,
});

describe("legacy case presentation gates and native actions", () => {
  test("loading, errors, deletion and result kinds never expose an inapplicable private slot", () => {
    for (const c of [
      controller(),
      controller({ error: "합성 읽기 실패" }),
      controller({ deleted: true }),
    ]) {
      const html = renderToString(view(c));
      for (const slot of ["QUESTIONS", "RESULT", "FEEDBACK"])
        expect(html).not.toContain(`SYNTHETIC_${slot}_SLOT`);
    }
    const clarified = renderToString(
      view(
        controller({ detail: detail({ status: "needs_clarification", questions, result: null }) }),
      ),
    );
    expect(clarified).toContain("SYNTHETIC_QUESTIONS_SLOT");
    expect(clarified).not.toContain("SYNTHETIC_RESULT_SLOT");
    const complete = renderToString(view(controller({ detail: detail() })));
    expect(complete).toContain("SYNTHETIC_RESULT_SLOT");
    expect(complete).toContain("SYNTHETIC_FEEDBACK_SLOT");
    for (const result of [outOfScope, urgentRedirect]) {
      const html = renderToString(
        view(controller({ detail: detail({ result, status: result.kind }) })),
      );
      expect(html).toContain("SYNTHETIC_RESULT_SLOT");
      expect(html).not.toContain("SYNTHETIC_FEEDBACK_SLOT");
    }
  });

  test("retry preserves the displayed input revision and delete remains explicit, busy-gated and cancellable", () => {
    const calls: unknown[][] = [];
    const c = controller({
      detail: detail({ status: "failed", result: null, error: problem() }),
      mutate: async (...args) => {
        calls.push(args);
      },
      setConfirmDelete: (value) => {
        calls.push([value]);
      },
    });
    const tree = CaseDetailView({ controller: c, questions: null, result: null, feedback: null });
    expect(calls).toEqual([]);
    button(tree, "분석 다시 시도").onClick?.({} as never);
    expect(calls).toEqual([["retry", { inputRevision: 3 }]]);
    expect(renderToString(view(c))).toContain("공식 자료를 확인하지 못해 결과를 만들지 않았어요.");
    button(tree, "사건 삭제").onClick?.({} as never);
    expect(calls.at(-1)).toEqual([true]);
    const confirming = CaseDetailView({
      controller: { ...c, confirmDelete: true, busy: true },
      questions: null,
      result: null,
      feedback: null,
    });
    expect(button(confirming, "사건 삭제 확인").disabled).toBe(true);
    expect(button(confirming, "취소").disabled).toBe(true);
    expect(button(confirming, "분석 다시 시도").disabled).toBe(true);
    button(confirming, "취소").onClick?.({} as never);
    expect(calls.at(-1)).toEqual([false]);
  });

  test("a nonretryable failure offers refresh and new-case navigation; consent uses the original safe return path", () => {
    const c = controller({
      detail: detail({ status: "failed", result: null, error: problem(false) }),
    });
    const html = renderToString(view(c));
    expect(html).not.toContain("분석 다시 시도");
    expect(html).toContain("분석 상태 다시 확인");
    expect(html).toContain('href="/cases/new"');
    const consent = renderToString(view({ ...c, error: "필수 동의 확인 필요", consent: true }));
    expect(consent).toContain(accessHref("consent", `/cases/${caseId}`).replaceAll("&", "&amp;"));
    expect(consent).not.toContain("최신 상태 다시 확인");
    expect(renderToString(view(controller({ deleted: true })))).toContain('tabindex="-1"');
  });

  test("guidance retains statement provenance, citation anchors and checked items; non-guidance stays a notice", () => {
    const html = renderToString(
      <LegacyResultView
        result={guidance}
        controller={resultController({ checked: { evidence_1: true } })}
      />,
    );
    for (const text of [
      "사용자가 알려준 내용",
      "AI가 정리한 내용",
      "확인 필요",
      "날짜 확인 필요",
      "사용자 진술",
      "진술됨",
      "자료 체크리스트",
      "법적 완료를 뜻하지 않아요.",
      guidance.citations[0]?.lawName ?? "",
    ])
      expect(html).toContain(text);
    expect(html).toContain('id="result-summary"');
    expect(html).toContain('id="source-citation_1"');
    expect(html).toContain('href="#source-citation_1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('checked=""');
    for (const result of [outOfScope, urgentRedirect]) {
      const notice = renderToString(
        <LegacyResultView result={result} controller={resultController()} />,
      );
      expect(notice).toContain(result.message);
      expect(notice).toContain('href="/"');
      expect(notice).not.toContain("자료 체크리스트");
    }
  });

  test("question controls retain choice/unknown/skipped semantics, native value delivery, Unicode count and busy state", () => {
    const chosen: unknown[][] = [];
    const c = questionsController({
      answers: {
        q1: { questionId: "q1", status: "answered", value: "😀😀" },
        q2: { questionId: "q2", status: "answered", value: "있음" },
      },
      value: (id) => (id === "q1" ? "😀😀" : "있음"),
      busy: true,
      choose: (...args) => {
        chosen.push(args);
      },
    });
    const tree = QuestionsView({ controller: c });
    const nodes = elements(tree);
    const select = nodes.find((node) => node.type === SelectField)?.props as Parameters<
      typeof SelectField
    >[0];
    expect(select.label).toBe("1번 답변 방식");
    expect(select.disabled).toBe(true);
    expect(select.options.map((option) => option.value)).toEqual([
      "",
      "answered",
      "unknown",
      "skipped",
    ]);
    select.onValueChange("unknown");
    select.onValueChange("skipped");
    select.onValueChange("invalid");
    expect(chosen).toEqual([
      ["q1", "unknown"],
      ["q1", "skipped"],
    ]);
    const field = nodes.find((node) => node.type === TextareaField)?.props as Parameters<
      typeof TextareaField
    >[0];
    const event = { target: { value: "입력한 원문" } } as never;
    field.onChange?.(event);
    expect(chosen.at(-1)).toEqual(["q1", "answered", "입력한 원문"]);
    expect(field["aria-describedby"]).toBe("answer-length-q1");
    expect(field.disabled).toBe(true);
    const html = renderToString(tree);
    expect(html.replaceAll("<!-- -->", "")).toContain("2 / 1,000자");
    expect(html).toContain('id="question-error"');
    expect(button(tree, "답변 저장 중").disabled).toBe(true);
  });

  test("all externally supplied strings stay escaped, including question text, result text and feedback responses", () => {
    const unsafe = '<script>synthetic</script><img src=x onerror="synthetic">';
    const result = { ...guidance, summary: { ...guidance.summary, userStatements: [unsafe] } };
    const html = renderToString(
      <LegacyResultView result={result} controller={resultController()} />,
    );
    expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(renderToString(view(controller({ error: unsafe })))).not.toContain("<img src=x");
    const feedback = renderToString(
      <FeedbackView controller={{ busy: false, message: unsafe, save: async () => {} }} />,
    );
    expect(feedback).toContain("&lt;script&gt;");
    expect(feedback).not.toContain("<script>");
  });
});

describe("extracted legacy hooks keep request and answer boundaries", () => {
  test("a newer page-show read fences off a previous late response and hidden pages do not poll", async () => {
    const reads: {
      reply: ReturnType<typeof deferred<Response>>;
      signal: AbortSignal | null | undefined;
    }[] = [];
    const h = hookHarness<{ caseId: string }, CaseDetailController>(
      "useCaseDetailController",
      "useCaseDetailController",
      { caseId },
      async (_input, init) => {
        const reply = deferred<Response>();
        reads.push({ reply, signal: init?.signal });
        return reply.promise;
      },
    );
    h.render();
    h.event("window", "pageshow");
    expect(reads).toHaveLength(2);
    expect(reads[0]?.signal?.aborted).toBe(true);
    reads[1]?.reply.resolve(json(detail({ title: "최신 합성 사건" })));
    await settle();
    expect(h.render().detail?.title).toBe("최신 합성 사건");
    reads[0]?.reply.resolve(json({ error: problem() }, 503));
    await settle();
    expect(h.render().error).toBe("");
    expect(h.render().detail?.title).toBe("최신 합성 사건");
    h.document.hidden = true;
    h.event("document", "visibilitychange");
    expect(reads).toHaveLength(2);
    expect(h.timers.size).toBe(0);
    h.unmount();
  });

  test("an uncertain write reuses its exact idempotency key; in-flight duplicates collapse and only ACK refreshes", async () => {
    const first = deferred<Response>();
    const writes: RequestInit[] = [];
    let reads = 0;
    const h = hookHarness<{ caseId: string }, CaseDetailController>(
      "useCaseDetailController",
      "useCaseDetailController",
      { caseId },
      async (_input, init) => {
        if (!init?.method) {
          reads++;
          return json(detail({ status: "failed", result: null, error: problem() }));
        }
        writes.push(init);
        return writes.length === 1 ? first.promise : json({ acknowledged: true });
      },
    );
    h.render();
    await settle();
    const pending = h.render().mutate("retry", { inputRevision: 3 });
    await h.render().mutate("retry", { inputRevision: 3 });
    expect(writes).toHaveLength(1);
    first.reject(new Error("합성 연결 끊김"));
    await pending;
    expect(reads).toBe(1);
    expect(h.render().error).toBe("합성 연결 끊김");
    await h.render().mutate("retry", { inputRevision: 3 });
    expect(writes).toHaveLength(2);
    expect(writes[1]?.headers).toEqual(writes[0]?.headers);
    expect(writes[1]?.body).toBe(writes[0]?.body);
    expect(writes[1]?.body).toBe(JSON.stringify({ inputRevision: 3 }));
    expect(reads).toBe(2);
    h.unmount();
  });

  test("401 redirects without publishing a result; delete ACK prevents an already pending read from republishing", async () => {
    const unauthorized = hookHarness<{ caseId: string }, CaseDetailController>(
      "useCaseDetailController",
      "useCaseDetailController",
      { caseId },
      async () => json({ error: problem() }, 401),
    );
    unauthorized.render();
    await settle();
    expect(unauthorized.render().detail).toBeNull();
    expect(unauthorized.redirects).toEqual([
      accessHref("login", `/cases/${caseId}`, "session_expired"),
    ]);
    unauthorized.unmount();
    let reads = 0;
    const late = deferred<Response>();
    const h = hookHarness<{ caseId: string }, CaseDetailController>(
      "useCaseDetailController",
      "useCaseDetailController",
      { caseId },
      async (_input, init) =>
        init?.method === "DELETE"
          ? json({ acknowledged: true })
          : ++reads === 1
            ? json(detail())
            : late.promise,
    );
    h.render();
    await settle();
    h.event("window", "pageshow");
    await h.render().mutate("delete");
    expect(h.render().deleted).toBe(true);
    late.resolve(json(detail({ title: "삭제 뒤 늦은 응답" })));
    await settle();
    expect(h.render().deleted).toBe(true);
    expect(h.render().detail?.title).not.toBe("삭제 뒤 늦은 응답");
    expect(h.analytics.filter((event) => event[0] === "case_deleted")).toHaveLength(1);
    h.unmount();
  });

  test("questions validate all answers and approved choices, count Unicode code points and preserve revision/status payloads", async () => {
    const writes: unknown[] = [];
    const h = hookHarness<LegacyQuestionsProps, LegacyQuestionsController>(
      "useLegacyQuestionsController",
      "useLegacyQuestionsController",
      {
        questions,
        revision: 3,
        busy: false,
        onSubmit: async (body) => {
          writes.push(body);
        },
      },
    );
    const event = { preventDefault() {} } as never;
    await h.render().submit(event);
    expect(writes).toHaveLength(0);
    expect(h.render().error).toContain("각 질문");
    h.render().choose("q1", "answered", "😀".repeat(1001));
    h.render().choose("q2", "unknown");
    await h.render().submit(event);
    expect(writes).toHaveLength(0);
    expect(h.render().error).toContain("1,000자");
    h.render().choose("q1", "answered", "😀".repeat(1000));
    h.render().choose("q2", "answered", "허용되지 않은 선택");
    await h.render().submit(event);
    expect(writes).toHaveLength(0);
    h.render().choose("q2", "skipped");
    await h.render().submit(event);
    expect(writes).toEqual([
      {
        inputRevision: 3,
        answers: [
          { questionId: "q1", status: "answered", value: "😀".repeat(1000) },
          { questionId: "q2", status: "skipped" },
        ],
      },
    ]);
    h.render().choose("q1", "unknown");
    await h.render().submit(event);
    expect((writes.at(-1) as { answers: unknown[] }).answers).toEqual([
      { questionId: "q1", status: "unknown" },
      { questionId: "q2", status: "skipped" },
    ]);
  });

  test("a revision conflict reloads current input before an explicit retry, while consent rejection exposes its recovery link", async () => {
    const writes: RequestInit[] = [];
    let revision = 3;
    const h = hookHarness<{ caseId: string }, CaseDetailController>(
      "useCaseDetailController",
      "useCaseDetailController",
      { caseId },
      async (_input, init) => {
        if (!init?.method)
          return json(
            detail({ status: "failed", result: null, inputRevision: revision, error: problem() }),
          );
        writes.push(init);
        if (writes.length === 1) {
          revision = 4;
          return json(
            {
              error: {
                ...problem(),
                code: "REVISION_CONFLICT",
                message: "최신 입력을 확인해 주세요.",
              },
            },
            409,
          );
        }
        return json(
          { error: { ...problem(), code: "CONSENT_REQUIRED", message: "합성 동의 필요" } },
          403,
        );
      },
    );
    h.render();
    await settle();
    await h.render().mutate("retry", { inputRevision: 3 });
    expect(h.render().detail?.inputRevision).toBe(4);
    expect(h.render().error).toBe("최신 입력을 확인해 주세요.");
    expect(writes).toHaveLength(1);
    await h.render().mutate("retry", { inputRevision: 4 });
    expect(writes).toHaveLength(2);
    expect(writes[1]?.headers).not.toEqual(writes[0]?.headers);
    expect(h.render().consent).toBe(true);
    expect(renderToString(view(h.render()))).toContain("필수 동의 확인");
    h.unmount();
  });

  test("active analysis schedules read-only polling and unmount aborts requests and prevents late publication", async () => {
    const calls: string[] = [];
    const late = deferred<Response>();
    let lateSignal: AbortSignal | null | undefined;
    const h = hookHarness<{ caseId: string }, CaseDetailController>(
      "useCaseDetailController",
      "useCaseDetailController",
      { caseId },
      async (input, init) => {
        expect(init?.method).toBeUndefined();
        calls.push(input);
        if (calls.length > 2) {
          lateSignal = init?.signal;
          return late.promise;
        }
        return input.endsWith("/analysis")
          ? json({
              caseId,
              analysisId,
              inputRevision: 3,
              status: "retrieving",
              updatedAt: "2026-10-05T00:00:00Z",
              retryable: false,
              retryAttemptsRemaining: 0,
              error: null,
            })
          : json(detail({ status: "analyzing", result: null }));
      },
    );
    h.render();
    await settle();
    expect(h.render().stage).toBe("공식 자료 확인");
    expect(calls).toEqual([`/api/cases/${caseId}`, `/api/cases/${caseId}/analysis`]);
    expect(h.timers.size).toBe(1);
    h.event("window", "pageshow");
    expect(calls).toHaveLength(3);
    h.unmount();
    expect(lateSignal?.aborted).toBe(true);
    expect(h.timers.size).toBe(0);
    late.resolve(json(detail({ title: "unmounted synthetic response" })));
    await settle();
    expect(h.render().detail?.title).toBe("합성 사건");
    expect(h.render().error).toBe("");
    h.event("window", "pageshow");
    expect(calls).toHaveLength(3);
  });

  test("feedback sends only the boolean, collapses pending clicks and records analytics only on acknowledged success", async () => {
    const first = deferred<Response>();
    const writes: RequestInit[] = [];
    const h = hookHarness<{ caseId: string; analysisId: string }, FeedbackController>(
      "useFeedbackController",
      "useFeedbackController",
      { caseId, analysisId },
      async (_input, init) => {
        if (init) writes.push(init);
        return first.promise;
      },
    );
    const save = h.render().save(true);
    await h.render().save(false);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("PUT");
    expect(writes[0]?.body).toBe(JSON.stringify({ helpful: true }));
    expect(h.analytics).toEqual([]);
    const busy = renderToString(<FeedbackView controller={h.render()} />);
    expect(busy).toContain("도움 여부 저장 중");
    first.resolve(json({ acknowledged: true }));
    await save;
    expect(h.render().message).toContain("언제든 다시 선택");
    expect(h.analytics).toEqual([["trust_answered", caseId, analysisId, { helpful: "yes" }]]);
    const failed = hookHarness<{ caseId: string; analysisId: string }, FeedbackController>(
      "useFeedbackController",
      "useFeedbackController",
      { caseId, analysisId },
      async () => json({ error: problem() }, 503),
    );
    await failed.render().save(false);
    expect(failed.render().message).toBe(problem().message);
    expect(failed.analytics).toEqual([]);
  });
});
