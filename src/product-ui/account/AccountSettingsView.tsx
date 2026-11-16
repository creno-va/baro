import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  Clock3,
  FolderOpen,
  HelpCircle,
  MessageCircle,
  Mic,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "../Button";
import { Dialog } from "../Dialog";
import { Disclosure, DisclosureSummary } from "../Disclosure";
import { InputField } from "../Field";
import { GlobalProductTheme } from "../GlobalTheme";
import { AccountLoading, AccountNotice, AccountSection, AccountSpinner } from "./AccountComponents";
import type { AccountProvider, AccountSettingsController } from "./useAccountSettingsController";

export type AccountSettingsViewProps = {
  controller: AccountSettingsController;
  legacyAssets?: ReactNode;
  providerIcon: (provider: AccountProvider) => ReactNode;
};
const providerNames = { google: "Google", naver: "네이버", kakao: "카카오" };

/** Rendered separately in SSR contracts as the portal itself mounts after hydration. */
export function AccountDeletionContents({
  controller: c,
  providerIcon,
}: Pick<AccountSettingsViewProps, "controller" | "providerIcon">) {
  return (
    <div
      className="space-y-5 text-sm leading-6 text-[var(--pui-text)]"
      data-product-account-confirmation=""
    >
      {c.busy && (
        <p role="status" className="flex items-center gap-2 text-[var(--pui-muted)]">
          <AccountSpinner />
          요청을 처리하고 있어요…
        </p>
      )}
      {!c.ready ? (
        <div className="space-y-4">
          <p>안전한 삭제를 위해 이 계정에 연결된 로그인 수단으로 다시 인증해 주세요.</p>
          <div className="grid gap-2">
            {c.access?.providers.map((provider) => (
              <Button
                key={provider}
                data-product-account-provider={provider}
                variant="secondary"
                className="w-full justify-start"
                disabled={Boolean(c.busy) || c.checking}
                onClick={() => void c.reauthenticate(provider)}
              >
                {providerIcon(provider)}
                <span>{providerNames[provider]}로 재인증</span>
                <ChevronRight size={16} className="ml-auto" aria-hidden="true" />
              </Button>
            ))}
          </div>
          {c.access && !c.access.providers.length && (
            <ButtonLink href="/login" variant="ghost">
              다시 로그인 <ChevronRight size={16} aria-hidden="true" />
            </ButtonLink>
          )}
        </div>
      ) : (
        <>
          <p>
            계정의 사건·자료·리포트·프로필 접근을 차단하고 세션을 종료해요. 삭제를 접수한 뒤 원격
            자료 정리가 진행돼요. 이미 다운로드하거나 외부에 전달한 파일은 삭제할 수 없어요.
          </p>
          <InputField
            id="delete-confirmation"
            ref={c.confirmationField}
            label="삭제 확인 — DELETE 입력"
            autoComplete="off"
            value={c.confirmation}
            disabled={Boolean(c.busy) || c.checking}
            onChange={(e) => c.setConfirmation(e.target.value)}
          />
        </>
      )}
      {c.error && <AccountNotice tone="danger">{c.error}</AccountNotice>}
      <div className="flex flex-wrap justify-end gap-2">
        {c.ready && (
          <Button
            variant="danger"
            disabled={Boolean(c.busy) || c.checking || !c.ready || c.confirmation !== "DELETE"}
            onClick={() => void c.remove()}
          >
            {c.busy ? "삭제 요청 중…" : "삭제 요청 확인"}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={Boolean(c.busy) || c.checking}
          onClick={() => c.setTarget(null)}
        >
          취소
        </Button>
      </div>
    </div>
  );
}

export function AccountSettingsView({
  controller: c,
  legacyAssets,
  providerIcon,
}: AccountSettingsViewProps) {
  return (
    <GlobalProductTheme className="min-w-0 px-4 py-8 sm:px-8 sm:py-10">
      {c.deleted ? (
        <section
          role="status"
          data-product-account-deleted=""
          className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-6 text-[var(--pui-text)]"
        >
          <Check size={25} aria-hidden="true" />
          <h1 className="text-xl font-semibold">계정 삭제를 접수했어요</h1>
          <p className="text-sm leading-7 text-[var(--pui-muted)]">
            로그인 세션을 종료하고 접근을 차단했어요. 원격 파일·백업 정리는 삭제 절차에 따라
            진행돼요.
          </p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/login">
              로그인 화면으로 <ArrowRight size={17} aria-hidden="true" />
            </ButtonLink>
            <ButtonLink href="/help#deletion" variant="ghost">
              삭제 도움말 <ChevronRight size={16} aria-hidden="true" />
            </ButtonLink>
          </div>
        </section>
      ) : (
        <div
          data-product-account=""
          aria-busy={Boolean(c.busy) || c.checking}
          className="mx-auto w-full max-w-5xl space-y-6 text-[var(--pui-text)]"
        >
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">설정과 사용량</h1>
              <p className="mt-2 text-sm text-[var(--pui-muted)]">
                이용 현황과 계정 정보를 관리해요.
              </p>
            </div>
            <Button
              data-product-account-refresh=""
              variant="secondary"
              aria-busy={Boolean(c.busy) || c.checking}
              disabled={Boolean(c.busy) || c.checking}
              onClick={() => void c.load()}
            >
              {c.busy || c.checking ? (
                <AccountSpinner />
              ) : (
                <RefreshCw size={16} aria-hidden="true" />
              )}
              다시 확인
            </Button>
          </header>
          {(c.busy || c.checking) && (
            <p role="status" className="flex items-center gap-2 text-sm text-[var(--pui-muted)]">
              <RefreshCw size={15} aria-hidden="true" />
              {c.busy || "계정 접근 상태 확인 중…"}
            </p>
          )}
          {c.error && !c.target && <AccountNotice tone="danger">{c.error}</AccountNotice>}
          {c.notice && <AccountNotice tone="success">{c.notice}</AccountNotice>}
          <AccountSection
            id="settings-usage-title"
            title="사용량과 한도"
            description="오늘 얼마나 이용했는지 살펴보세요."
            icon={<ChartNoAxesColumnIncreasing size={22} />}
            action={
              <span className="flex min-h-8 items-center gap-1.5 text-xs text-[var(--pui-muted)]">
                <Clock3 size={14} aria-hidden="true" />
                매일 자정 갱신
              </span>
            }
          >
            {!c.usage && (c.busy || c.checking) && (
              <AccountLoading announce={false} title="이용 현황을 불러오고 있어요." />
            )}
            {c.usage && !c.checking && (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {(
                  [
                    ["오늘 새 사건", c.usage.newCases, "건", FolderOpen],
                    ["오늘 AI 응답", c.usage.aiResponses, "회", MessageCircle],
                    ["오늘 음성·영상", c.usage.mediaMinutes, "분", Mic],
                    [
                      "계정 저장 공간",
                      {
                        used: c.usage.storageBytes.used / 1e9,
                        limit: c.usage.storageBytes.limit / 1e9,
                      },
                      "GB",
                      FolderOpen,
                    ],
                  ] as const
                ).map(([label, count, unit, Icon]) => {
                  return (
                    <div
                      key={label}
                      data-product-account-usage-item=""
                      className="min-w-0 space-y-3 rounded-xl border border-[var(--pui-border)] p-4"
                    >
                      <div className="flex items-center gap-2 text-xs text-[var(--pui-muted)]">
                        <Icon size={17} aria-hidden="true" />
                        <strong className="font-medium">{label}</strong>
                      </div>
                      <p className="flex flex-wrap items-baseline gap-1 text-sm text-[var(--pui-muted)]">
                        <b className="text-2xl font-semibold tabular-nums text-[var(--pui-text)]">
                          {Number(count.used.toFixed(2))}
                        </b>
                        <span>{unit}</span>
                        <span className="ml-1 text-xs">
                          / {count.limit} {unit}
                        </span>
                      </p>
                      <progress
                        aria-label={label}
                        value={Math.min(count.used, count.limit)}
                        max={count.limit}
                        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--pui-border)] accent-[var(--pui-primary)] [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-[var(--pui-border)] [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[var(--pui-primary)] [&::-moz-progress-bar]:bg-[var(--pui-primary)]"
                      />
                      {count.used >= count.limit && (
                        <p className="text-xs leading-5 text-[var(--pui-danger)]">
                          한도에 도달했어요. 저장한 내용은 확인·삭제할 수 있어요.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-5 space-y-2 text-xs leading-6 text-[var(--pui-muted)]">
              <p>
                하루 한도는 한국 시간 자정에 다시 이용할 수 있어요. 저장 공간은 자료를 삭제해 확보할
                수 있어요.
              </p>
              {c.usage?.includesReservations && <p>진행 중인 처리 예약을 포함한 사용량이에요.</p>}
              {c.usage?.resetAt && (
                <p>
                  다음 일일 한도 갱신:{" "}
                  {new Date(c.usage.resetAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                </p>
              )}
              {c.usage?.waitReasons?.includes("monthly_budget") && (
                <p role="status" className="text-[var(--pui-danger)]">
                  처리 예산 때문에 새 자동 처리가 대기 중이에요. 저장한 내용을 확인하거나 삭제할 수
                  있어요.
                </p>
              )}
              {c.usage?.waitReasons?.includes("ai_funding") && (
                <p role="status" className="text-[var(--pui-danger)]">
                  AI 실행 설정을 확인 중이에요. 저장한 내용을 확인하거나 삭제할 수 있어요.
                </p>
              )}
              {c.usage?.waitReasons?.includes("processing_capacity") && (
                <p role="status" className="text-[var(--pui-danger)]">
                  처리 용량 때문에 새 자동 처리가 대기 중이에요. 잠시 후 다시 확인해 주세요.
                </p>
              )}
            </div>
            <Disclosure data-product-account-usage-guide="" className="mt-5">
              <DisclosureSummary>파일별 한도와 처리 안내</DisclosureSummary>
              <p>
                사건별 원본은 최대 100개·5GB예요. 문서·이미지 100MB, 음성·영상 1GB, PDF 500쪽,
                미디어 60분 한도를 적용해요. 실제 처리 용량이나 서비스 장애로 자동 처리가 대기할 수
                있어요.
              </p>
              <a href="/help#limits">
                한도와 대기 도움말 <ChevronRight size={16} className="inline" aria-hidden="true" />
              </a>
            </Disclosure>
          </AccountSection>
          <AccountSection
            id="settings-help-title"
            title="도움말과 정책"
            description="궁금한 내용을 확인해 보세요."
            icon={<HelpCircle size={22} />}
          >
            <nav aria-label="도움말과 정책" className="grid gap-1 sm:grid-cols-2">
              {[
                ["사용 도움말", "/help"],
                ["이용약관", "/policies/terms"],
                ["개인정보 처리방침", "/policies/privacy"],
                ["AI 이용 고지", "/policies/ai"],
              ].map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm hover:bg-[var(--pui-border)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)]"
                >
                  <span>{label}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </a>
              ))}
            </nav>
          </AccountSection>
          <div data-legacy-assets="">{legacyAssets}</div>
          <AccountSection
            id="settings-danger-title"
            title="계정 삭제"
            icon={<ShieldCheck size={22} />}
            action={
              <Button
                variant="danger"
                disabled={Boolean(c.busy) || c.checking || !c.access}
                onClick={(event) => {
                  event.currentTarget.focus();
                  c.open("account");
                }}
              >
                계정과 모든 사건 삭제
              </Button>
            }
          >
            {null}
          </AccountSection>
          {c.target && (
            <Dialog
              open
              title={c.ready ? "계정과 모든 사건을 삭제할까요?" : "계정 삭제 전 본인 확인"}
              showCloseButton={false}
              {...(c.ready ? { initialFocus: c.confirmationField } : {})}
              panelProps={{ "aria-busy": Boolean(c.busy) }}
              onClose={() => {
                if (!c.busy) c.setTarget(null);
              }}
            >
              <AccountDeletionContents controller={c} providerIcon={providerIcon} />
            </Dialog>
          )}
        </div>
      )}
    </GlobalProductTheme>
  );
}
