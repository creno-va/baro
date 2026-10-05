import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import { CURRENT_POLICY_VERSIONS } from "../contracts/consent";

type ConsentState = "loading" | "required" | "complete";

export function ConsentForm() {
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
    fetch("/api/me/consent", { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.assign("/login?error=session_expired");
          return null;
        }
        if (!response.ok) throw new Error("CONSENT_LOAD_FAILED");
        return response.json() as Promise<{ needsConsent: boolean }>;
      })
      .then((body) => {
        if (body) setState(body.needsConsent ? "required" : "complete");
      })
      .catch(() => setError("동의 상태를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."));
  }, []);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accepted || !over14) return;

    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/me/consent", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...CURRENT_POLICY_VERSIONS,
        over14Confirmed: true,
      }),
    }).catch(() => null);

    if (response?.status === 401) {
      window.location.assign("/login?error=session_expired");
      return;
    }
    if (!response?.ok) {
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
        <a className="primary-action" href="/" ref={completedLink}>
          홈으로 돌아가기
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
