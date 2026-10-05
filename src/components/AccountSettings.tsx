import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "../client/auth";
import { deletionAccessSchema } from "../contracts";
import { accountDeleted } from "../server/modules/analytics/browser";

const markerKey = "baro.account-reauth.v1";
type Access = ReturnType<typeof deletionAccessSchema.parse>;

export function AccountSettings() {
  const [access, setAccess] = useState<Access | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleted, setDeleted] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setError("");
    try {
      const response = await fetch("/api/me/deletion", { cache: "no-store" });
      if (response.status === 401) {
        location.assign("/login?error=session_expired");
        return;
      }
      if (!response.ok) throw new Error();
      const value = deletionAccessSchema.parse(await response.json());
      if (sequence !== requestSequence.current) return;
      setAccess(value);
      const raw = sessionStorage.getItem(markerKey);
      const marker = raw ? JSON.parse(raw) : null;
      // A URL parameter or sliding refresh cannot arm deletion. A new callback
      // timestamp for the same account must follow this tab's explicit request.
      const confirmed =
        marker &&
        marker.ownerTag === value.ownerTag &&
        value.recentOAuth &&
        value.authenticatedAt &&
        Date.parse(value.authenticatedAt) >= marker.startedAt;
      setReady(Boolean(confirmed));
      setConfirmation("");
      if (!confirmed && marker && marker.ownerTag !== value.ownerTag) {
        sessionStorage.removeItem(markerKey);
        setError("다른 계정으로 인증했어요. 삭제할 계정으로 다시 로그인해 주세요.");
      }
    } catch {
      if (sequence === requestSequence.current)
        setError("계정 상태를 확인하지 못했어요. 다시 시도해 주세요.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (ready) input.current?.focus();
  }, [ready]);
  async function reauthenticate(provider: Access["providers"][number]) {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setReady(false);
    setConfirmation("");
    setError("");
    try {
      if (!access) throw new Error();
      sessionStorage.setItem(
        markerKey,
        JSON.stringify({ ownerTag: access.ownerTag, startedAt: Date.now() }),
      );
      const response = await authClient.signIn.social({
        provider,
        callbackURL: "/settings",
        errorCallbackURL: "/settings?error=oauth",
      });
      if (!response.error) return;
    } catch {
      /* Restore a recoverable form without retaining any authorization URL. */
    }
    sessionStorage.removeItem(markerKey);
    setError("재인증을 시작하지 못했어요. 다시 시도해 주세요.");
    setBusy(false);
    submitted.current = false;
  }
  async function remove() {
    if (submitted.current || !ready || confirmation !== "DELETE") return;
    submitted.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/me", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (response.status === 202) {
        sessionStorage.removeItem(markerKey);
        setDeleted(true);
        await accountDeleted();
        return;
      }
      if (response.status === 403 || response.status === 401) {
        setReady(false);
        setConfirmation("");
      }
      throw new Error();
    } catch {
      setError("삭제를 확인하지 못했어요. 계정 상태를 다시 확인한 후 시도해 주세요.");
    }
    setBusy(false);
    submitted.current = false;
  }
  if (deleted)
    return (
      <section role="status">
        <h2>계정 삭제를 접수했어요</h2>
        <p>
          로그인 세션과 운영 데이터가 삭제됐어요. 실행 저장 상태와 백업 잔존은 복구·정리 절차에 따라
          처리돼요.
        </p>
        <a href="/">홈으로 돌아가기</a>
      </section>
    );
  return (
    <section className="case-panel account-settings" aria-busy={busy}>
      <h2>계정 삭제</h2>
      <p>
        사건, 답변, 결과, 동의와 로그인 정보가 삭제돼요. 먼저 같은 계정으로 다시 인증한 뒤 삭제를
        명시적으로 확인해 주세요.
      </p>
      {!access && !error ? <p role="status">계정 상태 확인 중…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="case-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setReady(false);
            void load();
          }}
        >
          계정 상태 다시 확인
        </button>
        {access?.providers.map((provider) => (
          <button
            type="button"
            key={provider}
            disabled={busy}
            onClick={() => void reauthenticate(provider)}
          >
            {provider}로 재인증
          </button>
        ))}
      </div>
      {access && !access.providers.length ? (
        <p>연결된 로그인 공급자를 확인하지 못했어요. 다시 로그인해 주세요.</p>
      ) : null}
      <p aria-live="polite">
        {ready
          ? "재인증을 확인했어요. 아래에서 다시 삭제를 확인해 주세요."
          : "삭제 전에 재인증이 필요해요."}
      </p>
      <label htmlFor="account-confirmation">삭제 확인 — DELETE 입력</label>
      <input
        id="account-confirmation"
        ref={input}
        value={confirmation}
        autoComplete="off"
        disabled={!ready || busy}
        onChange={(e) => setConfirmation(e.target.value)}
      />
      <button
        className="primary"
        type="button"
        disabled={!ready || busy || confirmation !== "DELETE"}
        onClick={() => void remove()}
      >
        {busy ? "처리 중…" : "계정과 모든 사건 삭제"}
      </button>
    </section>
  );
}
