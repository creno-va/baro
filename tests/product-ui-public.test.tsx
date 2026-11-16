import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { dirname, extname, resolve } from "node:path";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { Button } from "../src/product-ui/Button";
import { AuthView } from "../src/product-ui/public/AuthView";
import { ConsentView } from "../src/product-ui/public/ConsentView";
import { HelpFaqView } from "../src/product-ui/public/HelpFaqView";
import { ProviderIcon } from "../src/product-ui/public/ProviderIcon";
import { PublicThemeControl } from "../src/product-ui/public/PublicThemeControl";
import type { AuthController } from "../src/product-ui/public/useAuthController";
import type { ConsentController } from "../src/product-ui/public/useConsentController";

function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Record<string, unknown>>(child)
      ? [child, ...nodes(child.props.children as ReactNode)]
      : [],
  );
}
function auth(overrides: Partial<AuthController> = {}): AuthController {
  return {
    ready: true,
    pendingProvider: null,
    error: null,
    lastButton: { current: null },
    signIn: async () => {},
    mock: false,
    ...overrides,
  };
}
function consent(overrides: Partial<ConsentController> = {}): ConsentController {
  return {
    state: "required",
    accepted: false,
    submitting: false,
    error: null,
    submitButton: { current: null },
    setAccepted: () => {},
    submit: async () => {},
    mock: false,
    ...overrides,
  };
}
function consentTree(controller = consent()) {
  return ConsentView({ controller });
}
function submit(tree: ReactNode) {
  return nodes(tree).find((node) => node.type === Button && node.props.type === "submit");
}

describe("public authentication controls", () => {
  test("SSR exposes three real provider buttons with preserved names and hydration gating", () => {
    const tree = AuthView({ controller: auth({ ready: false }) });
    const buttons = nodes(tree).filter((node) => node.type === Button);
    expect(
      buttons.map((node) => [
        node.props["data-product-auth-provider"],
        node.props.type,
        node.props["aria-label"],
        node.props.disabled,
      ]),
    ).toEqual([
      ["kakao", "button", "Kakao로 계속하기", true],
      ["naver", "button", "Naver로 계속하기", true],
      ["google", "button", "Google로 계속하기", true],
    ]);
    expect(buttons.every((node) => typeof node.props.onClick === "function")).toBe(true);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("소셜 계정으로 계속하기");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("합성 계정");
    expect(html).not.toContain('role="alert"');
  });
  test("pending provider locks every choice and keeps an honest redirect status", () => {
    for (const provider of ["kakao", "naver", "google"] as const) {
      const tree = AuthView({ controller: auth({ pendingProvider: provider }) });
      const buttons = nodes(tree).filter((node) => node.type === Button);
      expect(buttons.every((node) => node.props.disabled)).toBe(true);
      expect(buttons.filter((node) => node.props["aria-label"] === "연결 중…")).toHaveLength(1);
      const html = renderToStaticMarkup(tree);
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain("로그인 페이지로 연결하고 있어요.");
    }
  });
  test("provider icons remain standalone, noninteractive, escaped SVG output", () => {
    for (const provider of ["kakao", "naver", "google"] as const) {
      const html = renderToStaticMarkup(<ProviderIcon provider={provider} />);
      expect(html).toMatch(/^<svg[^>]*aria-hidden="true"/);
      expect(html).toContain("<path");
      expect(html).not.toMatch(/<script|<a\b|<button|\sonclick=/i);
    }
  });
  test("authentication errors remain visible and escaped; mock identity is explicit only in mock mode", () => {
    const html = renderToStaticMarkup(
      <AuthView controller={auth({ error: '<img src=x onerror="synthetic()">', mock: true })} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("API 예시 모드 · 합성 계정으로 시연합니다.");
    expect(
      nodes(AuthView({ controller: auth({ error: "합성 오류" }) }))
        .filter((node) => node.type === Button)
        .every((node) => node.props.disabled === false),
    ).toBe(true);
  });
});

describe("required policy consent controls", () => {
  test("loading, loading failure and redirect never expose an actionable consent form", () => {
    for (const controller of [
      consent({ state: "loading" }),
      consent({ state: "loading", error: "합성 상태 오류" }),
      consent({ state: "redirecting" }),
    ]) {
      const tree = consentTree(controller);
      expect(nodes(tree).some((node) => node.type === "form")).toBe(false);
      expect(submit(tree)).toBeUndefined();
      expect(nodes(tree).some((node) => node.type === "input")).toBe(false);
    }
    const loading = renderToStaticMarkup(consentTree(consent({ state: "loading" })));
    expect(loading).toContain("이용 상태를 확인하고 있어요.");
    expect(loading).toContain('role="status"');
    const failure = renderToStaticMarkup(
      consentTree(consent({ state: "loading", error: "합성 상태 오류" })),
    );
    expect(failure).toContain("이용 상태를 확인할 수 없어요");
    expect(failure).toContain("다시 불러오기");
    expect(failure).toContain('role="alert"');
  });
  test("the real checkbox, explicit native submit, button ref and duplicate submission disable are preserved", () => {
    const c = consent();
    const tree = consentTree(c);
    const form = nodes(tree).find((node) => node.type === "form");
    const checkbox = nodes(tree).find((node) => node.type === "input");
    expect(form?.props.noValidate).toBe(true);
    expect(form?.props.onSubmit).toBe(c.submit);
    expect(checkbox?.props.type).toBe("checkbox");
    expect(checkbox?.props.checked).toBe(false);
    expect(checkbox?.props.disabled).toBe(false);
    expect(typeof checkbox?.props.onChange).toBe("function");
    expect(submit(tree)?.props.ref).toBe(c.submitButton);
    expect(submit(tree)?.props.disabled).toBe(true);
    expect(submit(consentTree(consent({ accepted: true })))?.props.disabled).toBe(false);
    const busy = consentTree(consent({ accepted: true, submitting: true }));
    expect(submit(busy)?.props.disabled).toBe(true);
    expect(nodes(busy).find((node) => node.type === "input")?.props.disabled).toBe(true);
    expect(renderToStaticMarkup(busy)).toContain("저장 중…");
    expect(renderToStaticMarkup(busy)).toContain('aria-busy="true"');
  });
  test("all required original policies remain safe new-tab links and acceptance stays explicit", () => {
    const tree = consentTree();
    const links = nodes(tree).filter((node) => node.type === "a");
    expect(links.map((node) => [node.props.href, node.props.target, node.props.rel])).toEqual([
      ["/policies/terms", "_blank", "noopener noreferrer"],
      ["/policies/privacy", "_blank", "noopener noreferrer"],
      ["/policies/ai", "_blank", "noopener noreferrer"],
    ]);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('aria-labelledby="consent-title"');
    expect(html).toContain("[필수] 서비스 정책 동의");
    expect(html).toContain("이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.");
    expect(html).not.toContain('checked=""');
  });
  test("save errors do not hide required policy controls or fabricate accepted state", () => {
    const html = renderToStaticMarkup(
      consentTree(
        consent({ accepted: true, error: "동의를 저장하지 못했어요. 다시 시도해 주세요." }),
      ),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("동의를 저장하지 못했어요.");
    expect(html).toContain('href="/policies/privacy"');
    expect(html).toContain("동의하고 계속하기");
    expect(html).not.toContain("동의 완료");
    expect(html).not.toContain("합성 동의 기록");
    expect(renderToStaticMarkup(consentTree(consent({ mock: true })))).toContain(
      "API 예시 모드 · 합성 동의 기록입니다.",
    );
  });
});

test("FAQ keeps original report limits, saved-version warnings and explicit mock scope", () => {
  const html = renderToStaticMarkup(<HelpFaqView />);
  for (const value of [
    "리포트와 다운로드",
    "원본 파일 자체는 바뀌지 않아요.",
    "자동 가림을 켜면 근거 사진은 PDF에서 통째로 제외돼요.",
    "먼저 현재 편집 내용을 저장하세요.",
    "새 초안을 다시 확인해야 해요.",
  ])
    expect(html).toContain(value);
  expect(html).toContain('id="reports"');
  expect(html).not.toContain("실제 OAuth·AI·R2 처리 결과가 아니에요.");
  expect(renderToStaticMarkup(<HelpFaqView mock />)).toContain(
    "실제 OAuth·AI·R2 처리 결과가 아니에요.",
  );
});

test("the public theme uses an accessible button and emits no executable inline attributes during SSR", () => {
  const html = renderToStaticMarkup(<PublicThemeControl />);
  expect(html).toContain('aria-label="화면 테마 변경"');
  expect(html).toContain("<button");
  const tags = (html.match(/<[^>]+>/g) ?? []).map((tag) => tag.replace(/"[^"]*"|'[^']*'/g, '""'));
  expect(tags.some((tag) => /\s(?:on[a-z]+|style)\s*=/i.test(tag))).toBe(false);
});

test("reviewed policy prose and versions stay byte-identical to the approved phase baseline", async () => {
  const source = await Bun.file(resolve(import.meta.dir, "../src/content/policy-drafts.ts")).text();
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    "1771ed38f0c3d891bffb33734868f82af416c770b370acf9aaaba24f3b673ef0",
  );
});

test("pure public views and the provider icon cannot load authentication clients or stores", async () => {
  const project = resolve(import.meta.dir, "..");
  const seen = new Set<string>();
  async function visit(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    const relative = path.slice(project.length + 1);
    expect(relative).not.toMatch(/^src\/(?:client\/(?:api(?:\.|\/)|return-path)|server\/)/);
    expect(relative).not.toMatch(/use(?:Auth|Consent)Controller\.ts$/);
    const file = ts.createSourceFile(
      path,
      await Bun.file(path).text(),
      ts.ScriptTarget.Latest,
      true,
      extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (
          clause?.isTypeOnly ||
          (clause &&
            !clause.name &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.every((item) => item.isTypeOnly))
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
      if (!resolved) throw new Error(`UNRESOLVED_PUBLIC_VIEW_IMPORT:${relative}:${specifier}`);
      await visit(resolved);
    }
  }
  for (const name of ["AuthView", "ConsentView", "HelpFaqView", "ProviderIcon"])
    await visit(resolve(project, `src/product-ui/public/${name}.tsx`));
  expect(seen.size).toBeGreaterThan(5);
});
