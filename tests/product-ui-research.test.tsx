import { describe, expect, test } from "bun:test";
import { dirname, extname, resolve } from "node:path";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { ApiError } from "../src/client/api/errors";
import { LOOKUP_CONSENT_VERSION, type V2LookupRequest } from "../src/contracts/v2";
import {
  PRECEDENT_COMPARISON_CRITERIA,
  v2PrecedentComparisonSchema,
} from "../src/contracts/v2/precedent-comparison";
import { v2PrecedentSearchResponseSchema } from "../src/contracts/v2/precedent-research";
import { Button } from "../src/product-ui/Button";
import { InputField } from "../src/product-ui/Field";
import { ComparisonPanelView } from "../src/product-ui/research/ComparisonPanelView";
import {
  ComparisonReasons,
  ComparisonResultView,
} from "../src/product-ui/research/ComparisonResultView";
import { LookupContents, LookupView } from "../src/product-ui/research/LookupView";
import { PrecedentDocumentView } from "../src/product-ui/research/PrecedentDocumentView";
import { fields, recipients, type Tool } from "../src/product-ui/research/presentation";
import { ResearchView } from "../src/product-ui/research/ResearchView";
import type {
  ComparisonPanelController,
  ComparisonPanelProps,
} from "../src/product-ui/research/useComparisonPanelController";
import type { LookupController } from "../src/product-ui/research/useLookupController";
import type { ResearchController } from "../src/product-ui/research/useResearchController";
import { SelectField } from "../src/product-ui/Select";
import { job } from "./fixtures/contracts/v2";
import synthetic from "./fixtures/legal/research/synthetic-search.json";

const searchResult = v2PrecedentSearchResponseSchema.parse(synthetic);
const item = (() => {
  const value = searchResult.items[0];
  if (!value) throw new Error("MISSING_SYNTHETIC_RESEARCH_ITEM");
  return value;
})();
const context = {
  schemaVersion: "2" as const,
  workspaceRevision: 7,
  summaryRevision: 2,
  caseTitle: "합성 사건",
  recommendedTopics: ["loan" as const],
};
const access = {
  ready: true,
  canMutate: true,
  version: 0,
  verify: async () => true,
  ticket: () => 1,
  alive: () => true,
  current: () => true,
  deny: () => {},
  ownerId: () => "synthetic-owner",
};
function research(overrides: Partial<ResearchController> = {}): ResearchController {
  return {
    caseId: "synthetic-case",
    embedded: true,
    context,
    topics: ["loan"],
    result: searchResult,
    document: null,
    selected: null,
    busy: false,
    reading: false,
    error: null,
    readError: null,
    access,
    documentHeading: { current: null },
    detailView: { current: null },
    resultOpener: { current: null },
    visibleTopics: ["loan", "lease", "wages"],
    allTopics: ["loan", "lease", "wages", "fraud"],
    chosen: undefined,
    sourceCurrent: true,
    setReload: () => {},
    setError: () => {},
    setTopics: () => {},
    backToResults: () => {},
    search: async () => {},
    read: async () => {},
    ...overrides,
  };
}
function panel(overrides: Partial<ComparisonPanelController> = {}): ComparisonPanelController {
  return {
    caseId: "synthetic-case",
    context,
    selected: item,
    sourceId: item.citation.sourceId,
    sourceNeedsRefresh: false,
    access,
    onRefreshSources: () => {},
    heading: <h3>합성 판례 제목</h3>,
    originalLink: <a href={item.citation.url}>합성 원문 링크</a>,
    children: <p>합성 원문 보존</p>,
    fullText: undefined,
    state: null,
    error: null,
    pending: false,
    sourceExpired: false,
    comparison: null,
    refreshRequired: false,
    comparisonStale: false,
    needsResearch: false,
    incomplete: false,
    unreadable: false,
    setError: () => {},
    start: async () => {},
    ...overrides,
  };
}
function comparison() {
  return v2PrecedentComparisonSchema.parse({
    schemaVersion: "2",
    criteriaVersion: "1",
    basedOnWorkspaceRevision: 7,
    publishedWorkspaceRevision: 9,
    summaryRevision: 2,
    checkedAt: "2026-11-16T00:00:00.000Z",
    source: { citation: item.citation, excerpt: item.excerpt },
    metrics: Object.keys(PRECEDENT_COMPARISON_CRITERIA).map((criterion, index) => ({
      criterion,
      verdict: index === 0 ? "yes" : index === 1 ? "no" : "unknown",
      explanation: index === 1 ? "합성 차이와 불리한 내용" : "합성 양쪽 근거의 비교 설명",
      caseEvidence:
        index < 2 ? [{ factId: "synthetic-fact", text: "합성 상반된 진술도 보존" }] : [],
      precedentEvidence: index < 2 ? [{ text: "합성", startUtf16: 0, endUtf16: 2 }] : [],
    })),
    matchedCount: 1,
    knownCount: 2,
    percentage: 13,
    factsPartial: true,
  });
}
const catalog: NonNullable<LookupController["catalog"]> = [
  {
    tool: "hometax_status",
    title: "합성 사업자 상태",
    description: "합성 국세청 연결",
    sourceUrl: "https://www.data.go.kr/data/15081808/openapi.do",
    status: "input_required",
  },
  {
    tool: "thecheat",
    title: "합성 거래 조회",
    description: "합성 더치트 연결",
    sourceUrl: "https://apicenter.thecheat.co.kr/",
    status: "input_required",
  },
  {
    tool: "datahub_property",
    title: "합성 주소 조회",
    description: "합성 데이터허브 연결",
    sourceUrl: "https://dataapi.co.kr/",
    status: "input_required",
  },
  {
    tool: "datahub_building",
    title: "합성 건물 조회",
    description: "합성 건물 연결",
    sourceUrl: "https://dataapi.co.kr/",
    status: "input_required",
  },
];
function lookup(overrides: Partial<LookupController> = {}): LookupController {
  return {
    prefix: "synthetic-lookup",
    catalog,
    tool: "hometax_status",
    values: {},
    kind: "phone",
    consent: false,
    error: "",
    sending: false,
    attempt: { current: null },
    available: catalog,
    definition: catalog[0],
    locked: false,
    busy: false,
    onClose: () => {},
    returnFocusRef: undefined,
    submit: () => {},
    setValues: () => {},
    setConsent: () => {},
    setError: () => {},
    changeTool: () => {},
    changeKind: () => {},
    ...overrides,
  };
}
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(tree).flatMap((node) =>
    isValidElement<Record<string, unknown>>(node)
      ? [node, ...nodes(node.props.children as ReactNode)]
      : [],
  );
}
function text(tree: ReactNode): string {
  return Children.toArray(tree)
    .map((node) =>
      isValidElement<{ children: ReactNode }>(node) ? text(node.props.children) : String(node),
    )
    .join("");
}
function button(tree: ReactNode, label: string) {
  const found = nodes(tree).find(
    (node) => node.type === Button && text(node.props.children as ReactNode).trim() === label,
  );
  if (!found) throw new Error(`MISSING_RESEARCH_ACTION:${label}`);
  return found;
}
const emptyPanel = () => null;
const renderResearch = (overrides: Partial<ResearchController> = {}) =>
  renderToStaticMarkup(
    <ResearchView controller={research(overrides)} ComparisonPanel={emptyPanel} />,
  );
const renderPanel = (overrides: Partial<ComparisonPanelController> = {}) =>
  renderToStaticMarkup(<ComparisonPanelView controller={panel(overrides)} />);

describe("research read and explicit search boundaries", () => {
  test("unauthorized or unresolved context never displays private results", () => {
    for (const override of [{ access: { ...access, ready: false } }, { context: null }]) {
      const html = renderResearch(override);
      expect(html).toContain("확인한 사건 요약을 불러오고 있어요.");
      expect(html).not.toContain(item.citation.title);
      expect(html).not.toContain("판례 찾기</button>");
    }
  });
  test("topic selection retains its two-topic cap and native checkbox state without starting search", () => {
    let selected: ResearchController["topics"] = ["loan", "lease"];
    let searches = 0;
    const tree = ResearchView({
      controller: research({
        topics: selected,
        search: async () => {
          searches++;
        },
        setTopics: (next) => {
          selected = typeof next === "function" ? next(selected) : next;
        },
      }),
      ComparisonPanel: emptyPanel,
    });
    const inputs = nodes(tree).filter((node) => node.type === "input");
    expect(inputs.map((node) => [node.props.checked, node.props.disabled])).toEqual([
      [true, false],
      [true, false],
      [false, true],
      [false, true],
    ]);
    expect(inputs.every((node) => String(node.props.className).includes("appearance-auto"))).toBe(
      true,
    );
    const firstTopic = inputs[0];
    if (!firstTopic) throw new Error("MISSING_FIRST_TOPIC");
    (firstTopic.props.onChange as () => void)();
    expect(selected).toEqual(["lease"]);
    expect(searches).toBe(0);
    const html = renderResearch();
    expect(html).toContain("외부에는 선택한 법률 주제만 전달돼요.");
    expect(html).toContain('type="submit"');
  });
  test("stale results and in-flight reads keep their exact disabled fences and no unsolicited snippets", () => {
    const tree = ResearchView({
      controller: research({ sourceCurrent: false, busy: true }),
      ComparisonPanel: emptyPanel,
    });
    const card = nodes(tree).find((node) => node.props["data-product-precedent-card"] === "");
    expect(card?.props.disabled).toBe(true);
    expect(button(tree, "공식 원문 확인 중…").props.disabled).toBe(true);
    const html = renderResearch();
    expect(html).toContain(item.citation.court);
    expect(html).toContain(item.citation.caseNumber);
    expect(html).not.toContain(item.excerpt.text);
    const more = { ...searchResult, nextCursor: "synthetic-page.synthetic-signature" };
    expect(
      button(
        ResearchView({
          controller: research({ result: more, sourceCurrent: false }),
          ComparisonPanel: emptyPanel,
        }),
        "더보기",
      ).props.disabled,
    ).toBe(true);
  });
  test("detail slot receives only matching current read proof and preserves heading focus and exact full text", () => {
    for (const sourceCurrent of [false, true]) {
      let received: ComparisonPanelProps | null = null;
      const document = {
        schemaVersion: "2" as const,
        workspaceRevision: context.workspaceRevision,
        citation: item.citation,
        excerpt: item.excerpt,
        fullText: "【이 유】\n합성 전체 원문 👩🏽‍💻",
      };
      const capture = (props: ComparisonPanelProps) => {
        received = props;
        return (
          <>
            {props.heading}
            {props.children}
          </>
        );
      };
      const value = research({ sourceCurrent, selected: item.id, chosen: item, document });
      const html = renderToStaticMarkup(
        <ResearchView controller={value} ComparisonPanel={capture} />,
      );
      const props = received as ComparisonPanelProps | null;
      expect(props?.selected).toBe(sourceCurrent ? item : null);
      expect(props?.sourceNeedsRefresh).toBe(!sourceCurrent);
      expect(props?.fullText).toBe(document.fullText);
      expect(nodes(props?.heading).find((node) => node.type === "h3")?.props.ref).toBe(
        value.documentHeading,
      );
      expect(html).toContain("합성 전체 원문 👩🏽‍💻");
      expect(html).toContain('tabindex="-1"');
    }
  });
  test("expired proofs direct explicit research while read failures preserve the selected source", () => {
    const c = research({
      selected: item.id,
      chosen: item,
      readError: new ApiError("NOT_FOUND", "합성 만료"),
    });
    let heading: ReactNode;
    renderToStaticMarkup(
      <ResearchView
        controller={c}
        ComparisonPanel={(props) => {
          heading = props.heading;
          return <>{props.heading}</>;
        }}
      />,
    );
    expect(text(heading)).toContain("다시 검색");
    expect(text(heading)).toContain("판례를 다시 확인하지 못했어요.");
    const denied = renderResearch({ error: new ApiError("CONSENT_REQUIRED", "합성 동의 확인") });
    expect(denied).toContain("필수 동의 확인");
    expect(denied).toContain("/consent?returnTo=");
  });
});

describe("comparison basis, recovery and exact evidence", () => {
  test("comparison start stays an explicit disabled action for expiry, mutation consent and pending admission", () => {
    let starts = 0;
    for (const override of [
      { selected: null },
      { pending: true },
      { sourceExpired: true },
      { sourceNeedsRefresh: true },
      { access: { ...access, canMutate: false } },
    ]) {
      const tree = ComparisonPanelView({
        controller: panel({
          ...override,
          start: async () => {
            starts++;
          },
        }),
      });
      const control = nodes(tree).find(
        (node) => node.props["aria-label"] === "내 사건과 유사도 비교",
      );
      expect(control?.props.disabled).toBe(true);
    }
    expect(starts).toBe(0);
    expect(renderPanel({ access: { ...access, ready: false } })).toBe("");
  });
  test("expired, stale and unreadable states retain distinct notices and current sources", () => {
    const expired = renderPanel({
      sourceExpired: true,
      refreshRequired: true,
      needsResearch: true,
    });
    expect(expired).toContain("판례 확인 시간이 지났거나 원문이 바뀌었어요.");
    expect(expired).toContain('role="alert"');
    expect(expired).toContain("합성 원문 보존");
    const stale = renderPanel({ comparisonStale: true, needsResearch: true });
    expect(stale).toContain("비교 이후 사건이나 확인한 원문 상태가 바뀌었어요.");
    const unreadable = renderPanel({
      unreadable: true,
      error: new ApiError("UNAVAILABLE", "합성 읽기 실패"),
    });
    expect(unreadable).toContain("비교 상태를 확인하지 못했어요");
    expect(unreadable).toContain("다시 비교");
    expect(unreadable).toContain("처리 중인 작업과 저장한 내용은 유지돼요.");
  });
  test("published comparisons retain partial-fact and check-time notices without relabeling research as complete", () => {
    const value = comparison();
    const html = renderPanel({
      comparison: value,
      state: {
        schemaVersion: "2",
        job: { ...job, status: "completed", phase: "finished" },
        comparison: value,
        stale: false,
      },
    });
    expect(html).toContain("저장된 사실 중 일부가 이번 비교에 포함되지 않았어요.");
    expect(html).toContain("에 비교");
    expect(html).not.toContain("합성 원문 보존");
    expect(html).toContain("승소 가능성이나 판결 예측을 뜻하지 않아요.");
  });
  test("eight fixed metrics keep server-owned percentages and unknowns in the denominator", () => {
    const selected: number[][] = [];
    const tree = ComparisonResultView({
      comparison: comparison(),
      selected: [],
      setSelected: (value) => selected.push(value),
    });
    const metrics = nodes(tree).filter(
      (node) => node.props["data-product-comparison-indicator"] === "",
    );
    expect(metrics).toHaveLength(8);
    expect(metrics.map((node) => node.props["data-verdict"])).toEqual([
      "yes",
      "no",
      ...Array(6).fill("unknown"),
    ]);
    const difference = metrics[1];
    if (!difference) throw new Error("MISSING_DIFFERENCE_METRIC");
    (difference.props.onClick as () => void)();
    expect(selected).toEqual([[1]]);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('value="13" max="100"');
    expect(html).toContain("확인 불가 6");
    expect(html).toContain("차이 있음 · +0점");
  });
  test("reason panels preserve both sides, contrary statements, unknown evidence and exact source quotes", () => {
    const html = renderToStaticMarkup(
      <ComparisonReasons comparison={comparison()} selected={[0, 1, 2, 999]} />,
    );
    for (const value of [
      "내 사건",
      "판례",
      "합성 상반된 진술도 보존",
      "합성 차이와 불리한 내용",
      "비교할 근거가 부족해요.",
      "확인한 원문에서 근거를 찾지 못했어요.",
    ])
      expect(html).toContain(value);
    expect(html.match(/data-product-comparison-reason=""/g)).toHaveLength(3);
    expect(html).toContain("확인 불가 · +0점");
    expect(html).not.toContain("undefined");
  });
  test("the published excerpt and full judgment remain distinct, and unverified ranges never gain highlights", () => {
    const value = comparison();
    const full = "【이 유】\n합성 전체 판결문입니다.";
    const fullHtml = renderToStaticMarkup(
      <ComparisonResultView
        comparison={value}
        fullText={full}
        selected={[]}
        setSelected={() => {}}
      />,
    );
    expect(fullHtml).toContain("합성 전체 판결문입니다.");
    expect(fullHtml).not.toContain("원문 일부를 표시했어요.");
    const altered = structuredClone(value);
    const quote = altered.metrics[0]?.precedentEvidence[0];
    if (!quote) throw new Error("MISSING_SYNTHETIC_QUOTE");
    quote.text = "원문과 다른 인용";
    const html = renderToStaticMarkup(
      <PrecedentDocumentView text={item.excerpt.text} comparison={altered} />,
    );
    expect(html).not.toContain("data-product-comparison-highlight");
    expect(html).toContain(item.excerpt.text);
    const safe = renderToStaticMarkup(
      <PrecedentDocumentView text={'<img src=x onerror="synthetic()">'} />,
    );
    expect(safe).toContain("&lt;img");
    expect(safe).not.toContain("<img");
  });
});

describe("explicit external lookup consent and recovery", () => {
  test("catalog loading and no-connection states cannot expose a form or submit", () => {
    for (const c of [lookup({ catalog: null }), lookup({ catalog: [], available: [] })]) {
      const html = renderToStaticMarkup(<LookupContents controller={c} />);
      expect(html).toContain('role="status"');
      expect(html).not.toContain("<form");
      expect(html).not.toContain("동의하고 조회 요청");
    }
  });
  test("each recipient exposes exactly the approved input names, capacity and transmission notice", () => {
    for (const tool of Object.keys(fields) as Tool[]) {
      const c = lookup({ tool });
      const tree = LookupContents({ controller: c });
      const controls = nodes(tree).filter((node) => node.type === InputField);
      expect(
        controls.map((node) => [
          node.props.id,
          node.props.maxLength,
          node.props.required,
          node.props.inputMode,
        ]),
      ).toEqual(
        fields[tool].map(([name, _label, max]) => [
          `synthetic-lookup-${name}`,
          max,
          name !== "bankCode",
          name === "address" ? "text" : "numeric",
        ]),
      );
      const html = renderToStaticMarkup(tree);
      expect(html).toContain(`수신 서비스: ${recipients[tool]}`);
      expect(html).toContain("거래 안전이나 권리관계를 확정하지 않아요.");
      expect(html).toContain("위 조회 대상의 외부 전송에 동의합니다.");
      expect(html).toContain('autoComplete="off"');
      expect(button(tree, "동의하고 조회 요청").props.disabled).toBe(true);
    }
  });
  test("lookup selections pass direct strings and the native form keeps its explicit submit handler", () => {
    const changed: string[] = [];
    const c = lookup({
      tool: "thecheat",
      changeTool: (value) => changed.push(value),
      changeKind: (value) => changed.push(value),
    });
    const tree = LookupContents({ controller: c });
    const selectors = nodes(tree).filter((node) => node.type === SelectField);
    const [service, kind] = selectors;
    if (!service || !kind) throw new Error("MISSING_LOOKUP_SELECTORS");
    (service.props.onValueChange as (value: string) => void)("datahub_building");
    (kind.props.onValueChange as (value: string) => void)("account");
    expect(changed).toEqual(["datahub_building", "account"]);
    const form = nodes(tree).find((node) => node.type === "form");
    expect(form?.props.onSubmit).toBe(c.submit);
    expect(form?.props.noValidate).toBe(true);
    expect(nodes(tree).find((node) => node.type === "input")?.props.type).toBe("checkbox");
    const dialog = LookupView({ controller: c });
    expect(dialog.props.title).toBe("공공·외부 정보 조회");
    expect(dialog.props.returnFocusRef).toBe(c.returnFocusRef);
  });
  test("an uncertain accepted-shape request locks editing, retains same-request recovery and permits close", () => {
    const request: V2LookupRequest = {
      tool: "hometax_status",
      target: { businessNumber: "1234567890" },
      consent: { version: LOOKUP_CONSENT_VERSION, recipient: "nts", transmit: true },
    };
    const c = lookup({
      locked: true,
      consent: true,
      attempt: { current: request },
      error: "합성 불확실한 전송",
    });
    const tree = LookupContents({ controller: c });
    for (const control of nodes(tree).filter(
      (node) => node.type === InputField || node.type === SelectField || node.type === "input",
    ))
      expect(control.props.disabled).toBe(true);
    expect(button(tree, "같은 요청 다시 확인").props.disabled).toBe(false);
    expect(button(tree, "닫기").props.disabled).toBe(false);
    expect(renderToStaticMarkup(tree)).toContain('role="alert"');
    for (const overrides of [{ busy: true }, { sending: true }]) {
      const pending = LookupContents({
        controller: lookup({
          locked: true,
          consent: true,
          attempt: c.attempt,
          error: c.error,
          ...overrides,
        }),
      });
      expect(button(pending, "요청 확인 중").props.disabled).toBe(true);
      expect(button(pending, "닫기").props.disabled).toBe(true);
    }
  });
});

test("pure research views cannot import authenticated request modules or comparison admission controllers", async () => {
  const root = resolve(import.meta.dir, "..");
  const seen = new Set<string>();
  async function visit(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    const relative = path.slice(root.length + 1);
    expect(relative).not.toMatch(/^src\/client\/api\/(?!errors\.ts$)/);
    expect(relative).not.toMatch(/^src\/client\/api\.ts$|^src\/server\//);
    expect(relative).not.toMatch(
      /^src\/product-ui\/research\/use(?:Research|ComparisonPanel|Lookup)Controller\.ts$/,
    );
    const source = ts.createSourceFile(
      path,
      await Bun.file(path).text(),
      ts.ScriptTarget.Latest,
      true,
      extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement)) {
        const c = statement.importClause;
        if (
          c?.isTypeOnly ||
          (c &&
            !c.name &&
            c.namedBindings &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.every((part) => part.isTypeOnly))
        )
          continue;
      } else if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const stem = resolve(dirname(path), specifier);
      const candidates = extname(stem)
        ? [stem]
        : [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`];
      const resolved = (
        await Promise.all(
          candidates.map(async (candidate) =>
            (await Bun.file(candidate).exists()) ? candidate : null,
          ),
        )
      ).find(Boolean);
      if (!resolved) throw new Error(`UNRESOLVED_RESEARCH_VIEW_IMPORT:${relative}:${specifier}`);
      await visit(resolved);
    }
  }
  for (const name of [
    "ResearchView",
    "ComparisonPanelView",
    "ComparisonResultView",
    "PrecedentDocumentView",
    "LookupView",
  ])
    await visit(resolve(root, `src/product-ui/research/${name}.tsx`));
  expect(seen.size).toBeGreaterThan(10);
});
