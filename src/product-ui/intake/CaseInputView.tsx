import { ArrowRight, ArrowUp, LoaderCircle, LockKeyhole } from "lucide-react";
import { Button, ButtonLink } from "../Button";
import { Dialog } from "../Dialog";
import { TextareaField } from "../Field";
import { CaseInputError } from "./CaseInputError";
import { APP_NARRATIVE_MAX_LENGTH, APP_NARRATIVE_MIN_LENGTH } from "./controller";
import { prepareExamples, responseExamples } from "./examples";
import type { CaseInputController } from "./useCaseInputController";

export function CaseInputView({
  controller,
  requireSession,
}: {
  controller: CaseInputController;
  requireSession: boolean;
}) {
  const {
    session,
    loading,
    sessionError,
    narrative,
    casePurpose,
    busy,
    error,
    created,
    lengthError,
    narrativeRef,
    count,
    canCreate,
    submit,
    refresh,
    setNarrative,
    setCasePurpose,
    dismissLengthError,
  } = controller;
  const unavailable = busy || loading || Boolean(sessionError) || !canCreate;
  const examples = casePurpose === "respond_to_claim" ? responseExamples : prepareExamples;

  // Keep the private composer out of SSR and unresolved authorization states.
  if (requireSession && (loading || !canCreate || sessionError)) {
    return (
      <div className="mx-auto w-full max-w-[800px] px-4 py-16 sm:px-8">
        {sessionError ? (
          <CaseInputError error={sessionError} retry={refresh} />
        ) : (
          <p
            className="flex items-center justify-center gap-2 text-sm text-[var(--pui-muted)]"
            role="status"
          >
            <LoaderCircle
              size={18}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            로그인 상태를 확인하고 있어요.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <section
        data-product-case-input=""
        className="mx-auto flex min-h-[calc(100svh-5rem)] w-full max-w-[800px] flex-col px-4 pb-6 pt-12 text-[var(--pui-text)] [view-transition-name:intake-page] sm:px-8 sm:pt-20"
        aria-labelledby="conversation-heading"
      >
        <header className="text-center">
          <p className="mb-3 text-sm text-[var(--pui-muted)]">복잡한 일도, 하나씩</p>
          <h1
            id="conversation-heading"
            className="text-3xl font-medium leading-tight tracking-tight sm:text-4xl"
          >
            어떤 일이 있었나요?
          </h1>
          <p className="mt-4 text-sm leading-6 text-[var(--pui-muted)] sm:text-base">
            생각나는 대로 적어주세요. 필요한 내용은 BARO가 함께 정리할게요.
          </p>
        </header>
        {created && canCreate && !loading && !sessionError ? (
          <div role="status" className="my-auto space-y-5 py-12 text-center">
            <p className="text-sm text-[var(--pui-muted)]">
              이야기를 저장했어요. 필요한 내용만 조금 더 확인할게요.
            </p>
            <ButtonLink variant="secondary" href={`/cases/${encodeURIComponent(created)}/intake`}>
              질문 이어가기 <ArrowRight size={18} aria-hidden="true" />
            </ButtonLink>
          </div>
        ) : (
          <>
            <fieldset
              disabled={unavailable}
              className="mt-8 flex flex-wrap justify-center gap-1.5"
              aria-describedby="subject-context-help"
            >
              <legend className="sr-only">사건을 정리하는 목적</legend>
              {(["prepare_claim", "respond_to_claim"] as const).map((purpose) => (
                <label key={purpose} className="cursor-pointer">
                  <input
                    className="peer sr-only"
                    type="radio"
                    name="case-purpose"
                    value={purpose}
                    checked={!loading && !sessionError && casePurpose === purpose}
                    onChange={() => setCasePurpose(purpose)}
                  />
                  <span className="flex min-h-11 items-center rounded-full border border-transparent px-4 text-sm text-[var(--pui-muted)] transition-colors peer-checked:border-[var(--pui-border)] peer-checked:bg-[var(--pui-background)] peer-checked:text-[var(--pui-text)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--pui-focus)] peer-disabled:cursor-not-allowed peer-disabled:opacity-50 motion-reduce:transition-none">
                    {purpose === "prepare_claim" ? "고소 준비" : "주장 대응"}
                  </span>
                </label>
              ))}
            </fieldset>
            <p
              id="subject-context-help"
              className="mt-3 text-center text-xs leading-5 text-[var(--pui-muted)]"
            >
              {casePurpose === "respond_to_claim"
                ? "받은 주장과 확인한 사실을 구분해 정리해요."
                : "일어난 일과 가지고 있는 자료를 함께 정리해요."}
            </p>
            {!narrative && !session?.needsConsent && (
              <fieldset className="mt-7 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-center sm:overflow-visible">
                <legend className="sr-only">상황 입력 예시</legend>
                {examples.map(({ label, text }) => (
                  <Button
                    key={label}
                    variant="secondary"
                    className="max-w-full rounded-full border-[var(--pui-border)] px-3.5 text-xs font-normal text-[var(--pui-muted)] [overflow-wrap:anywhere]"
                    disabled={unavailable}
                    onClick={() => {
                      setNarrative(text);
                      narrativeRef.current?.focus();
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </fieldset>
            )}
            <form noValidate onSubmit={submit} className="mt-10 space-y-4 pt-4 sm:mt-auto sm:pt-12">
              <div
                className="rounded-[20px] border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4 shadow-[0_4px_20px_rgb(0_0_0/3%)] focus-within:ring-2 focus-within:ring-[var(--pui-focus)] sm:p-5"
                aria-busy={busy || loading}
              >
                <TextareaField
                  ref={narrativeRef}
                  id="narrative"
                  name="narrative"
                  label={<span className="sr-only">지금까지 있었던 일</span>}
                  wrapperClassName="gap-0"
                  className="min-h-36 resize-y rounded-none border-0 bg-transparent px-0 py-0 text-base leading-7 focus-visible:outline-none"
                  rows={4}
                  value={loading || sessionError ? "" : narrative}
                  onChange={(event) => setNarrative(event.target.value)}
                  disabled={unavailable}
                  aria-describedby="subject-context-help narrative-minimum narrative-count"
                  invalid={count > APP_NARRATIVE_MAX_LENGTH || Boolean(lengthError)}
                  aria-invalid={count > APP_NARRATIVE_MAX_LENGTH || Boolean(lengthError)}
                  placeholder={
                    casePurpose === "respond_to_claim"
                      ? "어떤 주장을 받았나요? 상대방의 주장과 내가 기억하는 일을 적어주세요."
                      : "누구와 어떤 일이 있었나요? 기억나는 일부터 편하게 적어주세요."
                  }
                />
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div className="min-w-0 text-xs leading-5 text-[var(--pui-muted)]">
                    <p id="narrative-minimum">{APP_NARRATIVE_MIN_LENGTH}자 이상 입력해주세요</p>
                    <p
                      id="narrative-count"
                      className={
                        count > APP_NARRATIVE_MAX_LENGTH ? "text-[var(--pui-danger)]" : undefined
                      }
                    >
                      <span className="sr-only">입력한 글자 수 </span>
                      {loading || sessionError ? 0 : count.toLocaleString("ko-KR")} / 5,000자
                    </p>
                  </div>
                  {loading || sessionError ? (
                    <Button
                      disabled
                      size="icon"
                      className="rounded-full bg-[var(--pui-text)] text-[var(--pui-surface)]"
                      aria-label={
                        sessionError ? "로그인 상태를 확인해 주세요" : "로그인 상태 확인 중…"
                      }
                    >
                      <LoaderCircle
                        size={20}
                        className="animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    </Button>
                  ) : canCreate ? (
                    <Button
                      type="submit"
                      size="icon"
                      disabled={busy}
                      aria-busy={busy}
                      aria-label={busy ? "이야기를 저장하고 있어요…" : "저장하고 계속"}
                      className="rounded-full bg-[var(--pui-text)] text-[var(--pui-surface)]"
                    >
                      {busy ? (
                        <LoaderCircle
                          size={20}
                          className="animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      ) : (
                        <ArrowUp size={20} aria-hidden="true" />
                      )}
                    </Button>
                  ) : (
                    <ButtonLink
                      variant="secondary"
                      href={session?.needsConsent ? "/consent" : "/login"}
                    >
                      {session?.needsConsent ? "동의하고 시작하기" : "로그인하고 시작하기"}
                      <ArrowRight size={18} aria-hidden="true" />
                    </ButtonLink>
                  )}
                </div>
              </div>
              {error ? (
                <CaseInputError error={error} retry={() => submit()} disabled={busy} />
              ) : null}
              {(!canCreate || busy || loading || Boolean(sessionError)) && (
                <p role="status" className="text-center text-xs leading-5 text-[var(--pui-muted)]">
                  {busy
                    ? "저장한 뒤 이어서 질문을 확인할 수 있어요."
                    : loading
                      ? "로그인 상태를 확인하고 있어요."
                      : sessionError
                        ? "로그인 상태를 다시 확인해 주세요."
                        : session?.needsConsent
                          ? "필수 동의를 확인하면 바로 시작할 수 있어요."
                          : "로그인하면 상황을 저장하고, 언제든 이어서 정리할 수 있어요."}
                </p>
              )}
              {sessionError ? <CaseInputError error={sessionError} retry={refresh} /> : null}
            </form>
          </>
        )}
        <footer className="mt-4 space-y-2 text-center text-xs leading-5 text-[var(--pui-muted)]">
          <p className="flex items-start justify-center gap-1.5">
            <LockKeyhole size={13} className="mt-1 shrink-0" aria-hidden="true" />
            이름·연락처처럼 민감한 정보는 필요한 만큼만 적어주세요.
          </p>
          <p>BARO의 AI 답변은 법률 자문이 아니에요. 중요한 판단은 전문가와 확인해 주세요.</p>
        </footer>
      </section>
      <Dialog
        open={Boolean(lengthError)}
        onClose={dismissLengthError}
        title={
          count > APP_NARRATIVE_MAX_LENGTH
            ? "이야기를 조금 줄여주세요"
            : "이야기를 조금만 더 적어주세요"
        }
        description={lengthError}
        footer={
          <Button variant="secondary" onClick={dismissLengthError}>
            계속 작성하기
          </Button>
        }
      >
        <p className="text-sm leading-6 text-[var(--pui-muted)]">
          작성한 내용은 그대로 남아 있어요.
        </p>
      </Dialog>
    </>
  );
}
