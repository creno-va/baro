import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createCaseRequestSchema,
  createCaseResponseSchema,
  errorResponseSchema,
} from "../../contracts";

interface Turnstile {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      size: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
export function CaseInput({ siteKey }: { siteKey: string }) {
  const [narrative, setNarrative] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "consent" | "error">("loading");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const button = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const request = useRef<{ narrative: string; key: string } | null>(null);
  const completed = useRef<HTMLAnchorElement>(null);
  const count = [...narrative.trim()].length;
  const valid = count >= 20 && count <= 5000;
  const consent = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/me/consent", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) {
        window.location.assign("/login?error=session_expired");
        return;
      }
      if (!response.ok) throw new Error();
      const body = (await response.json()) as { needsConsent: boolean };
      setState(body.needsConsent ? "consent" : "ready");
    } catch {
      setState("error");
      setError("동의 상태를 불러오지 못했어요.");
    }
  }, []);
  useEffect(() => {
    void consent();
  }, [consent]);
  useEffect(() => {
    if (saved) completed.current?.focus();
    else if (error && !submitting) button.current?.focus();
  }, [saved, error, submitting]);
  useEffect(() => {
    if (state !== "ready") return;
    if (!siteKey) {
      setError("보안 확인을 준비하고 있어요. 잠시 후 다시 방문해 주세요.");
      return;
    }
    let disposed = false;
    let id: string | undefined;
    const mount = () => {
      if (disposed || !widget.current || !window.turnstile) return;
      id = window.turnstile.render(widget.current, {
        sitekey: siteKey,
        action: "case_create",
        size: "flexible",
        callback: setToken,
        "expired-callback": () => setToken(""),
        "error-callback": () => {
          setToken("");
          setError("보안 확인을 다시 진행해 주세요.");
        },
      });
      widgetId.current = id;
    };
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = mount;
    script.onerror = () => setError("보안 확인을 불러오지 못했어요. 다시 시도해 주세요.");
    if (window.turnstile) mount();
    else document.head.appendChild(script);
    return () => {
      disposed = true;
      if (id) window.turnstile?.remove(id);
      script.remove();
      widgetId.current = undefined;
    };
  }, [state, siteKey]);
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !valid || !token || saved) return;
    const input = createCaseRequestSchema.safeParse({ narrative, turnstileToken: token });
    if (!input.success) return;
    if (request.current?.narrative !== input.data.narrative)
      request.current = { narrative: input.data.narrative, key: crypto.randomUUID() };
    pending.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": request.current.key },
        body: JSON.stringify(input.data),
      });
      if (response.status === 401) {
        window.location.assign("/login?error=session_expired");
        return;
      }
      if (response.status === 403) {
        const body = errorResponseSchema.safeParse(await response.json());
        if (body.success && body.data.error.code === "CONSENT_REQUIRED") {
          setState("consent");
          return;
        }
        throw new Error("보안 확인을 다시 진행해 주세요.");
      }
      if (!response.ok) {
        const body = errorResponseSchema.safeParse(await response.json());
        throw new Error(
          body.success
            ? body.data.error.message
            : "요청을 완료하지 못했어요. 같은 입력으로 다시 시도해 주세요.",
        );
      }
      const result = createCaseResponseSchema.parse(await response.json());
      setNarrative("");
      setSaved(result.caseId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "요청을 완료하지 못했어요.");
      setToken("");
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }
  if (saved)
    return (
      <section className="case-panel">
        <p role="status">입력이 안전하게 저장됐어요.</p>
        <a className="button-link primary" ref={completed} href={`/cases/${saved}`}>
          분석 상태 확인
        </a>
      </section>
    );
  return (
    <section className="case-panel">
      <p className="status-text" aria-live="polite">
        {state === "loading"
          ? "동의 상태를 확인하고 있어요."
          : submitting
            ? "입력을 저장하고 있어요."
            : ""}
      </p>
      {state === "consent" ? (
        <p>
          현재 필수 동의가 필요해요. <a href="/consent">동의 확인</a>
        </p>
      ) : state === "error" ? (
        <button type="button" onClick={() => void consent()}>
          다시 확인
        </button>
      ) : state === "ready" ? (
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="narrative">어떤 일이 있었는지 편하게 적어주세요</label>
          <p id="input-help" className="case-muted">
            이름, 주민등록번호, 계좌번호 전체처럼 꼭 필요하지 않은 정보는 적지 마세요.
          </p>
          <textarea
            id="narrative"
            value={narrative}
            disabled={submitting}
            aria-describedby="input-help input-count input-error"
            aria-invalid={count > 0 && !valid}
            onChange={(event) => setNarrative(event.target.value)}
          />
          <p id="input-count">{count.toLocaleString()} / 5,000자</p>
          <p id="input-error" className="error-text" aria-live="polite">
            {count > 0 && !valid ? "20자 이상 5,000자 이하로 적어주세요." : ""}
          </p>
          <p className="case-muted">
            AI가 입력을 처리하며 분석에 필요한 정보를 외부 서비스로 전송합니다. 결과는 일반 정보이며
            법률 자문이 아닙니다.
          </p>
          <section ref={widget} className="turnstile-widget" aria-label="보안 확인" />
          <p aria-live="polite">{token ? "보안 확인 완료" : "보안 확인이 필요해요."}</p>
          <button
            className="primary"
            ref={button}
            type="submit"
            disabled={submitting || !valid || !token}
          >
            상황 정리 시작
          </button>
        </form>
      ) : null}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}
