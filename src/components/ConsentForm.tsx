import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { api, roleStart } from "../client/api";
import { ApiError } from "../client/api/errors";
import { CURRENT_POLICY_VERSIONS } from "../contracts/consent";

type ConsentState = "loading" | "required" | "complete";

export function ConsentForm() {
  const [startPath, setStartPath] = useState("/");
  const [state, setState] = useState<ConsentState>("loading");
  const [accepted, setAccepted] = useState(false);
  const [over14, setOver14] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitButton = useRef<HTMLButtonElement | null>(null);
  const completedLink = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    if (state === "complete") completedLink.current?.focus();
    else if (error && !submitting) submitButton.current?.focus();
  }, [state, error, submitting]);

  useEffect(() => {
    api.session
      .get()
      .then(async (session) => {
        if (!session.user) {
          window.location.assign("/login?error=session_expired");
          return;
        }
        setStartPath(session.user.accountType === "lawyer" ? "/lawyer" : "/");
        const consent = await api.session.getConsent();
        setState(consent.needsConsent ? "required" : "complete");
      })
      .catch(() => setError("동의 상태를 불러오지 못했어요. 다시 불러와 주세요."));
  }, []);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted || !over14) return;

    setSubmitting(true);
    setError(null);

    try {
      const session = await api.session.saveConsent({
        ...CURRENT_POLICY_VERSIONS,
        over14Confirmed: true,
      });
      setStartPath(roleStart(session));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "UNAUTHENTICATED") {
        window.location.assign("/login?error=session_expired");
        return;
      }
      setError("동의를 저장하지 못했어요. 다시 시도해 주세요.");
      setSubmitting(false);
      return;
    }

    setState("complete");
    setSubmitting(false);
  }

  if (state === "loading") {
    return error ? (
      <div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          다시 불러오기
        </button>
      </div>
    ) : (
      <p aria-live="polite">동의 상태를 확인하고 있어요.</p>
    );
  }

  if (state === "complete") {
    return (
      <div className="consent-complete">
        <p>필수 확인이 완료됐어요.</p>
        <a className="primary-action" href={startPath} ref={completedLink}>
          내 화면으로 계속하기
        </a>
      </div>
    );
  }

  return (
    <form className="consent-form" onSubmit={submit} aria-busy={submitting}>
      <label>
        <input
          checked={accepted}
          disabled={submitting}
          onChange={(event) => setAccepted(event.currentTarget.checked)}
          type="checkbox"
        />
        이용약관, 개인정보 처리방침, AI 이용 고지를 확인하고 동의합니다.
      </label>
      <label>
        <input
          checked={over14}
          disabled={submitting}
          onChange={(event) => setOver14(event.currentTarget.checked)}
          type="checkbox"
        />
        만 14세 이상입니다.
      </label>
      <p className="case-muted">
        <a href="/policies/terms">이용약관</a> · <a href="/policies/privacy">개인정보 처리방침</a> ·{" "}
        <a href="/policies/ai">AI 이용 고지</a>
      </p>
      <a href="/login" className="secondary-action">
        취소하고 돌아가기
      </a>
      <button
        className="primary-action"
        ref={submitButton}
        disabled={!accepted || !over14 || submitting}
        type="submit"
      >
        {submitting ? "저장 중…" : "동의하고 계속하기"}
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
