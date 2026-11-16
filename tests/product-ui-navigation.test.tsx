import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import type { CaseView } from "../src/client/api/types";
import { NavigationView } from "../src/product-ui/navigation/NavigationView";
import {
  availableNavigation,
  caseLink,
  navigationActive,
} from "../src/product-ui/navigation/types";
import type { NavigationController } from "../src/product-ui/navigation/useNavigationController";

function caseFixture(overrides: Partial<CaseView> = {}): CaseView {
  return {
    id: "synthetic-case",
    title: "합성 사건",
    subjectContext: "individual",
    stage: "active",
    revision: 1,
    updatedAt: "2026-11-16T00:00:00.000Z",
    summary: "합성 테스트 요약",
    schemaVersion: "2",
    ...overrides,
  };
}

function controller(overrides: Partial<NavigationController> = {}): NavigationController {
  const noop = () => {};
  const asyncNoop = async () => {};
  return {
    pathname: "/new",
    appearance: "workbench",
    showLogin: false,
    session: {
      user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
      needsConsent: false,
    },
    resolvedRole: "user",
    items: availableNavigation("user", ["/new"]),
    recent: [caseFixture()],
    recentState: "ready",
    ready: true,
    collapsed: false,
    open: false,
    utility: null,
    query: "",
    matches: [],
    error: "",
    signingOut: false,
    deletion: null,
    deleting: false,
    editing: null,
    caseTitle: "",
    renameError: "",
    renaming: false,
    theme: "system",
    brandHref: "/new",
    mock: false,
    canShowRecent: true,
    refs: {
      navigationRoot: createRef<HTMLElement>(),
      brandRef: createRef<HTMLAnchorElement>(),
      collapseButton: createRef<HTMLButtonElement>(),
      mobileMenuButton: createRef<HTMLButtonElement>(),
      menuReturn: createRef<HTMLElement>(),
      utilityReturn: createRef<HTMLElement>(),
    },
    actions: {
      toggleSidebar: noop,
      openDrawer: noop,
      setDrawerOpen: noop,
      openUtility: noop,
      closeUtility: noop,
      setQuery: noop,
      beginRename: noop,
      setCaseTitle: noop,
      renameRecent: asyncNoop,
      cancelRename: noop,
      beginDelete: noop,
      deleteRecent: asyncNoop,
      cancelDelete: noop,
      signOut: asyncNoop,
      setTheme: noop,
      focusCapture: noop,
      blurCapture: noop,
      retryRecent: () => true,
    },
    caseLink,
    ...overrides,
  };
}

describe("product navigation routing", () => {
  test("role links respect the available routes and both account types start privately", () => {
    expect(availableNavigation("visitor", ["/"]).map((item) => item.href)).toEqual(["/"]);
    expect(availableNavigation("moderator", ["/new"])).toEqual([]);
    for (const role of ["user", "lawyer"] as const) {
      const links = availableNavigation(role, ["/new", "/lawyers", "/lawyer"]);
      expect(links.map((item) => item.href)).toEqual(["/new"]);
      const item = links[0];
      if (!item) throw new Error("The private start route is missing.");
      expect(navigationActive(item, "/cases/new")).toBe(true);
      expect(navigationActive(item, "/cases/synthetic-case")).toBe(false);
    }
  });

  test("case destinations preserve legacy workspaces and the current intake stage", () => {
    for (const stage of ["intake", "summary", "active", "archived"] as const) {
      const item = caseFixture({ id: "case /?#", stage });
      const base = "/cases/case%20%2F%3F%23";
      expect(caseLink(item)).toBe(
        ["active", "archived"].includes(stage) ? base : `${base}/${stage}`,
      );
      expect(caseLink({ ...item, schemaVersion: "1" })).toBe(base);
    }
  });
});

describe("product navigation server boundary", () => {
  test("renders real workspace links, account controls and contextual case actions", () => {
    const markup = renderToString(
      <NavigationView
        controller={controller({
          pathname: "/cases/synthetic-case",
          recent: [
            caseFixture(),
            caseFixture({ id: "legacy", title: "이전 사건", schemaVersion: "1" }),
          ],
        })}
      />,
    );
    expect(markup).toContain('href="/new"');
    expect(markup).toContain('href="/cases/synthetic-case"');
    expect(markup).toContain('href="/cases/legacy"');
    expect(markup).toContain('href="/settings"');
    expect(markup).toContain('href="/help"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="합성 사건 제목 수정"');
    expect(markup).not.toContain('aria-label="이전 사건 제목 수정"');
    expect(markup).toContain('aria-label="이전 사건 사건 삭제"');
    expect(markup).toContain('aria-label="최근 사건 목록"');
    expect(markup).toContain('aria-label="합성 사용자 · 계정 관리"');
    expect(markup).toContain('aria-label="로그아웃"');
    expect(markup).not.toContain('href="/lawyers"');
  });

  test("loading, failure and consent states avoid stale history or fabricated success", () => {
    const loading = renderToString(
      <NavigationView controller={controller({ recentState: "loading" })} />,
    );
    expect(loading).toContain("최근 사건을 불러오는 중");
    expect(loading).not.toContain('href="/cases/synthetic-case"');
    const failed = renderToString(
      <NavigationView controller={controller({ recentState: "error" })} />,
    );
    expect(failed).toContain("사건을 불러오지 못했어요.");
    expect(failed).toContain("다시 불러오기");
    const pending = renderToString(
      <NavigationView
        controller={controller({
          session: {
            user: { id: "synthetic-owner", name: "합성 사용자", accountType: "customer" },
            needsConsent: true,
          },
          canShowRecent: false,
        })}
      />,
    );
    expect(pending).toContain('href="/consent"');
    expect(pending).not.toContain('href="/cases/synthetic-case"');
    expect(pending).not.toContain('aria-label="설정"');
  });

  test("prehydration overlays emit no inline styles and untrusted titles remain text", () => {
    let actions = 0;
    const state = controller({
      recent: [caseFixture({ title: '<img src=x onerror="synthetic()">' })],
      open: true,
      utility: "search",
      deletion: { item: caseFixture(), ownerId: "synthetic-owner" },
    });
    state.actions.openDrawer = () => {
      actions++;
    };
    state.actions.deleteRecent = async () => {
      actions++;
    };
    const markup = renderToString(<NavigationView controller={state} />);
    expect(actions).toBe(0);
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain('<img src="x"');
    const tagsWithoutValues = [...markup.matchAll(/<[a-z][^<>]*>/gi)]
      .map(([tag]) => tag.replace(/"[^"]*"|'[^']*'/g, '""'))
      .join("");
    expect(tagsWithoutValues).not.toMatch(
      /<(?:script|iframe)\b|\s(?:style|onerror|onload|onclick)\s*=/i,
    );
    expect(markup).not.toContain('role="dialog"');
  });

  test("a failed logout remains visible and announced in a collapsed sidebar", () => {
    const message = "로그아웃하지 못했어요. 다시 시도해 주세요.";
    const markup = renderToString(
      <NavigationView controller={controller({ collapsed: true, error: message })} />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain(message);
    expect(markup).toContain('aria-label="로그아웃"');
    const alert = markup.match(/<p\b[^>]*\brole="alert"[^>]*>/)?.[0] ?? "";
    expect(alert).not.toMatch(/\b(?:hidden|sr-only)\b/);
  });
});
