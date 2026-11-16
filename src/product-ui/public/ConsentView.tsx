import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "../Button";
import type { ConsentController } from "./useConsentController";

export function ConsentView({ controller: c }: { controller: ConsentController }) {
  if (c.state === "loading") {
    return c.error ? (
      <div data-product-consent-status="" className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">이용 상태를 확인할 수 없어요</h1>
        <p
          className="rounded-xl border border-[var(--pui-danger)] p-3 text-sm leading-6 text-[var(--pui-danger)]"
          role="alert"
        >
          {c.error}
        </p>
        <Button type="button" onClick={() => window.location.reload()}>
          다시 불러오기
        </Button>
      </div>
    ) : (
      <p
        data-product-consent-status=""
        className="flex items-center gap-2 text-sm leading-6 text-[var(--pui-muted)]"
        role="status"
      >
        <LoaderCircle
          size={18}
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        이용 상태를 확인하고 있어요.
      </p>
    );
  }
  if (c.state === "redirecting") {
    return (
      <p
        data-product-consent-status=""
        className="text-sm leading-6 text-[var(--pui-muted)]"
        role="status"
      >
        내 화면으로 이동하고 있어요.
      </p>
    );
  }
  return (
    <section data-product-consent="" className="space-y-6" aria-labelledby="consent-title">
      <header className="space-y-3">
        <ShieldCheck size={28} className="text-[var(--pui-muted)]" aria-hidden="true" />
        <p className="text-xs font-medium text-[var(--pui-muted)]">서비스 이용을 위한 필수 확인</p>
        <h1 id="consent-title" className="text-3xl font-semibold leading-tight tracking-tight">
          시작 전에 <br />
          확인해 주세요
        </h1>
        <p className="text-sm leading-7 text-[var(--pui-muted)]">
          서비스 정책을 확인해 주세요.
          <br />
          동의를 마치면 이용하던 화면으로 이어집니다.
        </p>
      </header>
      <form
        noValidate
        data-product-consent-form=""
        className="space-y-5"
        onSubmit={c.submit}
        aria-busy={c.submitting}
      >
        {c.mock && (
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            API 예시 모드 · 합성 동의 기록입니다.
          </p>
        )}
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4">
          <input
            checked={c.accepted}
            disabled={c.submitting}
            onChange={(event) => c.setAccepted(event.currentTarget.checked)}
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:opacity-50"
          />
          <span className="min-w-0 space-y-1 text-sm leading-6">
            <strong className="block font-medium">[필수] 서비스 정책 동의</strong>
            <span className="block text-xs leading-6 text-[var(--pui-muted)]">
              이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.
            </span>
          </span>
        </label>
        <nav
          className="flex flex-wrap gap-x-4 gap-y-2 text-xs [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:rounded [&_a]:underline [&_a]:underline-offset-4 [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-[var(--pui-focus)]"
          aria-label="정책 원문"
        >
          <a href="/policies/terms" target="_blank" rel="noopener noreferrer">
            이용약관<span className="sr-only"> (새 창)</span>
          </a>
          <a href="/policies/privacy" target="_blank" rel="noopener noreferrer">
            개인정보 처리방침<span className="sr-only"> (새 창)</span>
          </a>
          <a href="/policies/ai" target="_blank" rel="noopener noreferrer">
            AI 이용 고지<span className="sr-only"> (새 창)</span>
          </a>
        </nav>
        <Button
          className="w-full"
          ref={c.submitButton}
          disabled={!c.accepted || c.submitting}
          type="submit"
        >
          {c.submitting ? (
            <LoaderCircle
              size={17}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Check size={17} aria-hidden="true" />
          )}
          {c.submitting ? "저장 중…" : "동의하고 계속하기"}
        </Button>
        {c.error ? (
          <p
            className="rounded-xl border border-[var(--pui-danger)] p-3 text-sm leading-6 text-[var(--pui-danger)]"
            role="alert"
          >
            {c.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
