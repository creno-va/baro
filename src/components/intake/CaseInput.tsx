import { ArrowRight, Building2, Check, FileText, UserRound, WalletCards } from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, roleStart } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { SessionView } from "../../client/api/types";
import { BrandMark } from "../ui/brand";
import { Button, ButtonLink } from "../ui/button";
import { Textarea } from "../ui/form";
import { ErrorPanel } from "./common";

const examples = [
  {
    label: "빌려준 돈을 못 받았어요",
    text: "지인에게 돈을 빌려줬는데, 약속한 날짜가 지나도 돌려받지 못했어요. ",
    Icon: WalletCards,
  },
  {
    label: "보증금을 돌려받고 싶어요",
    text: "임대차 계약이 끝났는데 보증금을 아직 돌려받지 못했어요. ",
    Icon: Building2,
  },
  {
    label: "계약에 문제가 생겼어요",
    text: "계약한 내용과 실제로 진행된 내용이 달라서 어떻게 정리할지 고민이에요. ",
    Icon: FileText,
  },
];

export function CaseInput({
  siteKey: _siteKey,
  requireSession = false,
}: {
  siteKey?: string;
  requireSession?: boolean;
}) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const [narrative, setNarrative] = useState("");
  const [subjectContext, setContext] = useState<"individual" | "company">("individual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);
  const pending = useRef(false);
  const identity = useRef<string | undefined>(undefined);
  const sessionRequest = useRef(0);
  const operation = useRef(0);
  const mounted = useRef(false);
  const count = [...narrative.trim()].length;
  const valid = count >= 20 && count <= 5000;
  const canCreate = session?.user?.accountType === "customer" && !session.needsConsent;
  const clearDraft = useCallback(() => {
    ++operation.current;
    pending.current = false;
    setBusy(false);
    setNarrative("");
    setContext("individual");
    setCreated(null);
    setError(null);
  }, []);
  const loadSession = useCallback(async () => {
    const ticket = ++sessionRequest.current;
    const current = () => mounted.current && ticket === sessionRequest.current;
    setLoading(true);
    setSessionError(null);
    const accept = (next: SessionView) => {
      if (!current()) return null;
      const nextIdentity = JSON.stringify([
        next.user?.id ?? null,
        next.user?.accountType ?? null,
        next.needsConsent,
      ]);
      if (identity.current !== undefined && identity.current !== nextIdentity) {
        clearDraft();
      }
      identity.current = nextIdentity;
      setSession(next);
      if (requireSession && (next.user?.accountType !== "customer" || next.needsConsent)) {
        window.location.replace(roleStart(next));
      }
      return next;
    };
    try {
      return accept(await api.session.get());
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "UNAUTHENTICATED")
        return accept({ user: null, needsConsent: false });
      if (current()) setSessionError(cause);
      return null;
    } finally {
      if (current()) setLoading(false);
    }
  }, [clearDraft, requireSession]);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => void loadSession();
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "better-auth.message") {
        try {
          const message = JSON.parse(event.newValue ?? "null");
          if (message?.event === "session" && message?.data?.trigger === "signout") {
            ++sessionRequest.current;
            clearDraft();
            identity.current = JSON.stringify([null, null, false]);
            setSession({ user: null, needsConsent: false });
            setLoading(false);
            setSessionError(null);
            if (requireSession) window.location.replace("/login");
            return;
          }
        } catch {
          /* Unknown messages only trigger server verification. */
        }
      }
      if (
        !event.key ||
        ["baro-api-mock-v1:session", "better-auth.message", "baro-session-changed"].includes(
          event.key,
        )
      )
        refresh();
    };
    void loadSession();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("baro-session-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      ++sessionRequest.current;
      ++operation.current;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("baro-session-changed", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [clearDraft, loadSession, requireSession]);

  async function create(event?: SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canCreate || loading || sessionError || !valid || pending.current || created) return;
    const ticket = ++operation.current;
    const current = () => mounted.current && ticket === operation.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const fresh = await loadSession();
      if (!current() || fresh?.user?.accountType !== "customer" || fresh.needsConsent) return;
      const item = await api.cases.create({ narrative: narrative.trim(), subjectContext });
      // A completed request must not restore a prior owner's UI after an account switch.
      await loadSession();
      if (!current()) return;
      setCreated(item.id);
      window.location.assign(`/cases/${encodeURIComponent(item.id)}/intake`);
    } catch (cause) {
      if (current()) setError(cause);
    } finally {
      if (current()) {
        setBusy(false);
        pending.current = false;
      }
    }
  }

  // Private case data remains API-authorized. Keep the application composer out
  // of SSR and pending/error states until the session, role and consent resolve.
  if (requireSession && (loading || !canCreate || sessionError)) {
    return sessionError ? (
      <ErrorPanel error={sessionError} retry={() => void loadSession()} />
    ) : (
      <p className="conversation-reassurance" role="status">
        로그인 상태를 확인하고 있어요.
      </p>
    );
  }

  return (
    <section className="conversation-home" aria-labelledby="conversation-heading">
      <header className="conversation-greeting">
        <span className="conversation-emblem" aria-hidden="true">
          <BrandMark size={48} />
        </span>
        <h1 id="conversation-heading">어떤 일이 있었나요?</h1>
        <p>
          생각나는 대로 적어주세요.
          <br />
          필요한 내용은 BARO가 함께 정리할게요.
        </p>
        <div className="conversation-effort">
          <Check size={15} aria-hidden="true" />
          질문은 두 차례, 한 번에 최대 3개예요
        </div>
      </header>
      {created && canCreate && !loading && !sessionError ? (
        <div className="conversation-saved" role="status">
          <p>이야기를 저장했어요. 필요한 내용만 조금 더 확인할게요.</p>
          <ButtonLink href={`/cases/${encodeURIComponent(created)}/intake`}>
            질문 이어가기 <ArrowRight size={18} aria-hidden="true" />
          </ButtonLink>
        </div>
      ) : (
        <>
          <form className="conversation-entry" onSubmit={(event) => void create(event)}>
            <label className="conversation-field-label" htmlFor="narrative">
              지금까지 있었던 일
            </label>
            <div className="conversation-composer" aria-busy={busy || loading}>
              <Textarea
                id="narrative"
                value={loading || sessionError ? "" : narrative}
                onChange={(event) => setNarrative(event.target.value)}
                disabled={busy || loading || !!sessionError || !canCreate}
                aria-describedby="narrative-help narrative-count"
                aria-invalid={count > 5000}
                placeholder="누구와 어떤 일이 있었고, 지금 무엇이 가장 걱정되나요? 정확한 날짜나 금액은 나중에 보완해도 괜찮아요."
              />
              <div className="conversation-composer-toolbar">
                <fieldset className="conversation-context" disabled={busy || loading || !canCreate}>
                  <legend className="sr-only">누구의 사건인가요?</legend>
                  {(["individual", "company"] as const).map((value) => (
                    <label key={value} className={subjectContext === value ? "selected" : ""}>
                      <input
                        type="radio"
                        name="subject"
                        value={value}
                        checked={!loading && !sessionError && subjectContext === value}
                        onChange={() => setContext(value)}
                      />
                      {value === "individual" ? (
                        <UserRound size={15} aria-hidden="true" />
                      ) : (
                        <Building2 size={15} aria-hidden="true" />
                      )}
                      <span>{value === "individual" ? "개인" : "기업"}</span>
                    </label>
                  ))}
                </fieldset>
                <span className="conversation-context-hint">누구의 사건인가요?</span>
              </div>
            </div>
            <div className="conversation-input-meta">
              <p id="narrative-help">주민등록번호·계좌번호 전체는 적지 마세요.</p>
              <p id="narrative-count" aria-live="polite">
                {count < 20
                  ? count > 0
                    ? `${20 - count}자만 더 적어주세요`
                    : "20자 이상 적어주세요"
                  : `${count.toLocaleString()} / 5,000자`}
              </p>
            </div>
            {error ? (
              <ErrorPanel error={error} retry={() => void create()} disabled={busy} />
            ) : null}
            <div className="conversation-primary-action">
              {loading || sessionError ? (
                <Button disabled>
                  {sessionError ? "로그인 상태를 확인해 주세요" : "로그인 상태 확인 중…"}
                </Button>
              ) : canCreate ? (
                <Button type="submit" disabled={busy || !valid}>
                  {busy ? "이야기를 저장하고 있어요…" : "저장하고 계속"}
                  <ArrowRight size={18} aria-hidden="true" />
                </Button>
              ) : (
                <ButtonLink
                  href={session?.needsConsent ? "/consent" : session?.user ? "/lawyer" : "/login"}
                >
                  {session?.needsConsent
                    ? "동의하고 시작하기"
                    : session?.user
                      ? "변호사 홈으로"
                      : "로그인하고 시작하기"}
                  <ArrowRight size={18} aria-hidden="true" />
                </ButtonLink>
              )}
            </div>
          </form>
          {!narrative && !session?.needsConsent && session?.user?.accountType !== "lawyer" ? (
            <div className="conversation-examples">
              {examples.map(({ label, text, Icon }) => (
                <Button
                  key={label}
                  variant="outline"
                  disabled={loading || !canCreate}
                  onClick={() => {
                    setNarrative(text);
                    document.getElementById("narrative")?.focus();
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                  {label}
                </Button>
              ))}
            </div>
          ) : null}
          {(!canCreate || busy || loading || !!sessionError) && (
            <p className="conversation-reassurance" role="status">
              {busy
                ? "저장한 뒤 이어서 질문을 확인할 수 있어요."
                : loading
                  ? "로그인 상태를 확인하고 있어요."
                  : sessionError
                    ? "로그인 상태를 다시 확인해 주세요."
                    : session?.needsConsent
                      ? "필수 동의를 확인하면 바로 시작할 수 있어요."
                      : session?.user?.accountType === "lawyer"
                        ? "변호사 홈에서 프로필과 활동 정보를 관리할 수 있어요."
                        : "로그인하면 상황을 저장하고, 언제든 이어서 정리할 수 있어요."}
            </p>
          )}
          {sessionError ? (
            <ErrorPanel error={sessionError} retry={() => void loadSession()} />
          ) : null}
        </>
      )}
      <footer className="conversation-home-footer">
        <p>
          상황 입력 <span aria-hidden="true">→</span> 질문 두 차례 <span aria-hidden="true">→</span>{" "}
          요약 확인
        </p>
        <p>BARO의 AI 답변은 법률 자문이 아니에요. 중요한 판단은 전문가와 확인해 주세요.</p>
      </footer>
    </section>
  );
}
