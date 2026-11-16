import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  AccountDeletionContents,
  AccountSettingsView,
} from "../src/product-ui/account/AccountSettingsView";
import {
  LegacyAssetDeleteContents,
  LegacyAssetPreviewContents,
  LegacyProfileAssetsView,
} from "../src/product-ui/account/LegacyProfileAssetsView";
import type { AccountSettingsController } from "../src/product-ui/account/useAccountSettingsController";
import type { LegacyProfileAssetsController } from "../src/product-ui/account/useLegacyProfileAssetsController";

const access = {
  ownerTag: "a".repeat(64),
  recentOAuth: true,
  authenticatedAt: "2026-11-16T00:00:00.000Z",
  providers: ["google", "kakao"] as ("google" | "kakao")[],
  canDelete: true,
};
function settings(overrides: Partial<AccountSettingsController> = {}): AccountSettingsController {
  return {
    usage: {
      newCases: { used: 1, limit: 5 },
      aiResponses: { used: 200, limit: 200 },
      mediaMinutes: { used: 5, limit: 60 },
      storageBytes: { used: 1_500_000_000, limit: 5_000_000_000 },
      includesReservations: true,
      waitReasons: ["processing_capacity"],
    },
    access,
    ready: true,
    busy: "",
    error: "",
    notice: "",
    target: null,
    confirmation: "",
    confirmationField: { current: null },
    deleted: false,
    checking: false,
    load: async () => {},
    reauthenticate: async () => {},
    remove: async () => {},
    open: () => {},
    setTarget: () => {},
    setConfirmation: () => {},
    ...overrides,
  };
}
const scope = { identity: "synthetic:lawyer:false", epoch: 1 };
const asset = {
  id: "synthetic-retained-asset",
  revision: 4,
  status: "ready",
  kind: "image" as const,
  purpose: "profile_photo",
};
function assets(
  overrides: Partial<LegacyProfileAssetsController> = {},
): LegacyProfileAssetsController {
  return {
    eligible: true,
    session: {
      user: { id: "synthetic", name: "합성 사용자", accountType: "lawyer" },
      needsConsent: false,
    },
    checking: false,
    items: [asset],
    loaded: scope,
    busy: "",
    error: "",
    notice: "",
    target: null,
    preview: null,
    opener: { current: null },
    current: () => true,
    load: async () => {},
    download: async () => {},
    open: async () => {},
    remove: async () => {},
    setTarget: () => {},
    setPreview: () => {},
    usable: true,
    assetTitle: (value, index) =>
      `${value.purpose === "profile_photo" ? "프로필 사진" : "등록 자료"} ${index + 1}`,
    ...overrides,
  };
}
const providerIcon = () => null;
function button(markup: string, label: string) {
  const found = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find((match) =>
    match[2]?.replace(/<[^>]+>/g, "").includes(label),
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found[1] ?? "";
}
function safe(markup: string) {
  for (const tag of markup.match(/<[a-z][^>]*>/gi) ?? [])
    expect(tag).not.toMatch(/\s(?:style|on\w+)\s*=/i);
  expect(markup).not.toContain("headlessui-focus-sentinel");
}

describe("account UI server contracts", () => {
  test("pure view renders real usage/policy links without importing the API or hydrating portals", () => {
    const markup = renderToString(
      <AccountSettingsView
        controller={settings()}
        legacyAssets={<span>현재 자료 소유자의 화면</span>}
        providerIcon={providerIcon}
      />,
    );
    for (const label of [
      "설정과 사용량",
      "오늘 새 사건",
      "오늘 AI 응답",
      "오늘 음성·영상",
      "계정 저장 공간",
    ])
      expect(markup).toContain(label);
    expect(markup.match(/<progress /g)).toHaveLength(4);
    expect(markup).toContain('aria-label="계정 저장 공간" value="1.5" max="5"');
    expect(markup).toContain("한도에 도달했어요.");
    expect(markup).toContain("진행 중인 처리 예약을 포함한 사용량이에요.");
    for (const href of [
      "/help",
      "/help#limits",
      "/policies/terms",
      "/policies/privacy",
      "/policies/ai",
    ])
      expect(markup).toContain(`href="${href}"`);
    expect(markup).toContain("현재 자료 소유자의 화면");
    expect(button(markup, "계정과 모든 사건 삭제")).not.toMatch(/\sdisabled(?:=|\s|$)/);
    safe(markup);
  });
  test("account checks hide old usage and retain busy, access and error gates", () => {
    const markup = renderToString(
      <AccountSettingsView
        controller={settings({ checking: true, error: '<img src=x onerror="synthetic()">' })}
        providerIcon={providerIcon}
      />,
    );
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("<progress");
    expect(button(markup, "다시 확인")).toMatch(/\sdisabled(?:=|\s|$)/);
    expect(button(markup, "계정과 모든 사건 삭제")).toMatch(/\sdisabled(?:=|\s|$)/);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("&lt;img");
    safe(markup);
    const denied = renderToString(
      <AccountSettingsView controller={settings({ access: null })} providerIcon={providerIcon} />,
    );
    expect(button(denied, "계정과 모든 사건 삭제")).toMatch(/\sdisabled(?:=|\s|$)/);
  });
  test("reauthentication only offers linked providers and cannot expose a deletion submit", () => {
    const markup = renderToString(
      <AccountDeletionContents
        controller={settings({ ready: false })}
        providerIcon={providerIcon}
      />,
    );
    expect(button(markup, "Google로 재인증")).not.toMatch(/\sdisabled(?:=|\s|$)/);
    expect(button(markup, "카카오로 재인증")).not.toMatch(/\sdisabled(?:=|\s|$)/);
    expect(markup).not.toContain("네이버로 재인증");
    expect(markup).not.toContain('id="delete-confirmation"');
    expect(markup).not.toContain("삭제 요청 확인");
    const checking = renderToString(
      <AccountDeletionContents
        controller={settings({ ready: false, checking: true })}
        providerIcon={providerIcon}
      />,
    );
    expect(button(checking, "Google로 재인증")).toMatch(/\sdisabled(?:=|\s|$)/);
    safe(markup + checking);
  });
  test("exact DELETE and the original busy/checking flags gate the native confirmation input and submit", () => {
    for (const value of ["", "delete", " DELETE", "DELETE "]) {
      const markup = renderToString(
        <AccountDeletionContents
          controller={settings({ confirmation: value })}
          providerIcon={providerIcon}
        />,
      );
      expect(button(markup, "삭제 요청 확인")).toMatch(/\sdisabled(?:=|\s|$)/);
    }
    const confirmed = renderToString(
      <AccountDeletionContents
        controller={settings({ confirmation: "DELETE" })}
        providerIcon={providerIcon}
      />,
    );
    expect(button(confirmed, "삭제 요청 확인")).not.toMatch(/\sdisabled(?:=|\s|$)/);
    expect(confirmed).toContain('for="delete-confirmation"');
    expect(confirmed).toContain('autoComplete="off"');
    for (const state of [{ busy: "삭제 요청 중…" }, { checking: true }]) {
      const pending = renderToString(
        <AccountDeletionContents
          controller={settings({ confirmation: "DELETE", ...state })}
          providerIcon={providerIcon}
        />,
      );
      expect(button(pending, state.busy ? "삭제 요청 중…" : "삭제 요청 확인")).toContain(
        "disabled",
      );
      expect(button(pending, "취소")).toMatch(/\sdisabled(?:=|\s|$)/);
    }
    safe(confirmed);
  });
  test("accepted deletion replaces usage and private child slots, while active dialogs keep SSR CSP safe", () => {
    const accepted = renderToString(
      <AccountSettingsView
        controller={settings({ deleted: true })}
        legacyAssets={<span>아직 남은 비공개 자료</span>}
        providerIcon={providerIcon}
      />,
    );
    expect(accepted).toContain("계정 삭제를 접수했어요");
    expect(accepted).not.toContain("아직 남은 비공개 자료");
    expect(accepted).toContain('href="/login"');
    expect(accepted).toContain('href="/help#deletion"');
    const dialog = renderToString(
      <AccountSettingsView
        controller={settings({ target: "account", confirmation: "DELETE" })}
        providerIcon={providerIcon}
      />,
    );
    expect(dialog).not.toContain('role="dialog"');
    safe(accepted + dialog);
  });
  test("legacy recovery remains invisible for ineligible accounts and lazy for eligible owners", () => {
    expect(
      renderToString(<LegacyProfileAssetsView controller={assets({ eligible: false })} />),
    ).toBe("");
    const lazy = renderToString(
      <LegacyProfileAssetsView controller={assets({ items: null, loaded: null })} />,
    );
    expect(lazy).toContain("자료 목록은 버튼을 누르면 불러와요.");
    expect(button(lazy, "자료 목록 확인")).not.toMatch(/\sdisabled(?:=|\s|$)/);
    expect(lazy).not.toContain("자료 올리기");
    expect(lazy).not.toContain("공개하기");
    safe(lazy);
  });
  test("pending consent preserves current-owner read/remove rights and uses the real consent return path", () => {
    const c = assets();
    c.session = {
      user: { id: "synthetic", name: "합성 사용자", accountType: "lawyer" },
      needsConsent: true,
    };
    const markup = renderToString(<LegacyProfileAssetsView controller={c} />);
    expect(markup).toContain("기존 자료는 확인하거나 삭제할 수 있어요.");
    expect(markup).toContain('href="/consent?returnTo=%2Fsettings"');
    for (const label of ["프로필 사진 1 보기", "프로필 사진 1 내려받기", "프로필 사진 1 삭제"])
      expect(button(markup, label)).not.toMatch(/\sdisabled(?:=|\s|$)/);
    safe(markup);
  });
  test("retained-asset status, scope and checking state keep their existing distinct gates", () => {
    const failed = renderToString(
      <LegacyProfileAssetsView controller={assets({ items: [{ ...asset, status: "failed" }] })} />,
    );
    expect(button(failed, "프로필 사진 1 보기")).toMatch(/\sdisabled(?:=|\s|$)/);
    expect(button(failed, "프로필 사진 1 내려받기")).toMatch(/\sdisabled(?:=|\s|$)/);
    expect(button(failed, "프로필 사진 1 삭제")).not.toMatch(/\sdisabled(?:=|\s|$)/);
    const stale = renderToString(
      <LegacyProfileAssetsView controller={assets({ current: () => false })} />,
    );
    expect(stale).not.toContain("프로필 사진 1 보기");
    const checking = renderToString(
      <LegacyProfileAssetsView controller={assets({ checking: true, usable: false })} />,
    );
    expect(checking).toContain('hidden="" inert=""');
    expect(button(checking, "자료 목록 확인")).toMatch(/\sdisabled(?:=|\s|$)/);
    const busy = renderToString(
      <LegacyProfileAssetsView controller={assets({ busy: "자료를 열고 있어요." })} />,
    );
    expect(button(busy, "프로필 사진 1 삭제")).toMatch(/\sdisabled(?:=|\s|$)/);
    safe(failed + stale + checking + busy);
  });
  test("preview and deletion confirmation use native actions and retain checking/busy error feedback", () => {
    const preview = renderToString(
      <LegacyAssetPreviewContents
        controller={assets({
          preview: {
            url: "blob:synthetic",
            type: "image/png",
            title: "합성 프로필 사진",
            asset,
            scope,
          },
          checking: true,
          error: "접근 상태를 다시 확인해 주세요.",
        })}
      />,
    );
    expect(button(preview, "파일 내려받기")).toMatch(/\sdisabled(?:=|\s|$)/);
    expect(preview).not.toContain('src="blob:synthetic"');
    expect(preview).toContain('role="alert"');
    const removal = renderToString(
      <LegacyAssetDeleteContents
        controller={assets({ target: { asset, title: "프로필 사진 1", scope }, checking: true })}
      />,
    );
    expect(button(removal, "자료 삭제 요청")).toMatch(/\sdisabled(?:=|\s|$)/);
    expect(button(removal, "취소")).toMatch(/\sdisabled(?:=|\s|$)/);
    safe(preview + removal);
  });
});
