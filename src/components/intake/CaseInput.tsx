import { ArrowRight, ArrowUp, Building2, FileText, UserRound, WalletCards } from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
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

export function CaseInput({ siteKey: _siteKey }: { siteKey?: string }) {
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
        ++operation.current;
        pending.current = false;
        setBusy(false);
        setNarrative("");
        setContext("individual");
        setCreated(null);
        setError(null);
      }
      identity.current = nextIdentity;
      setSession(next);
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
  }, []);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => void loadSession();
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const storage = (event: StorageEvent) => {
      if (!event.key || event.key === "baro-api-mock-v1:session") refresh();
    };
    void loadSession();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      ++sessionRequest.current;
      ++operation.current;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [loadSession]);

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

  return (
    <section className="conversation-home" aria-labelledby="conversation-heading">
      <header className="conversation-greeting">
        <span className="conversation-emblem" aria-hidden="true">
          <BrandMark size={48} />
        </span>
        <h1 id="conversation-heading">
          복잡한 일도,
          <br />
          <span>하나씩 풀어가요.</span>
        </h1>
        <p>어떤 일이 있었는지 편하게 들려주세요.</p>
      </header>
      {created ? (
        <div className="conversation-saved" role="status">
          <p>사건이 저장됐어요. 상황에 맞는 질문을 준비할게요.</p>
          <ButtonLink href={`/cases/${encodeURIComponent(created)}/intake`}>
            질문 이어가기 <ArrowRight size={18} aria-hidden="true" />
          </ButtonLink>
        </div>
      ) : (
        <>
          <form className="conversation-entry" onSubmit={(event) => void create(event)}>
            <div className="conversation-composer" aria-busy={busy || loading}>
              <label className="sr-only" htmlFor="narrative">
                지금까지 있었던 일
              </label>
              <Textarea
                id="narrative"
                value={loading || sessionError ? "" : narrative}
                onChange={(event) => setNarrative(event.target.value)}
                disabled={busy || loading || !!sessionError || !canCreate}
                aria-describedby="narrative-help narrative-count"
                aria-invalid={count > 0 && !valid}
                placeholder="어떤 일이 있었나요? 처음부터 완벽하게 정리하지 않아도 괜찮아요."
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
                        checked={subjectContext === value}
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
                {loading || sessionError ? (
                  <Button
                    className="conversation-send"
                    size="icon"
                    disabled
                    aria-label="로그인 상태 확인 중"
                  >
                    <ArrowUp size={20} aria-hidden="true" />
                  </Button>
                ) : canCreate ? (
                  <Button
                    className="conversation-send"
                    type="submit"
                    size="icon"
                    disabled={busy || !valid}
                    aria-label={busy ? "사건을 저장하고 있어요…" : "저장하고 질문 시작"}
                    title="저장하고 질문 시작"
                  >
                    <ArrowUp size={20} aria-hidden="true" />
                  </Button>
                ) : (
                  <ButtonLink
                    className="conversation-signin"
                    href={session?.needsConsent ? "/consent" : session?.user ? "/lawyer" : "/login"}
                  >
                    {session?.needsConsent
                      ? "동의하고 시작하기"
                      : session?.user
                        ? "변호사 홈으로"
                        : "로그인하고 시작하기"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </ButtonLink>
                )}
              </div>
            </div>
            <div className="conversation-input-meta">
              <p id="narrative-help">주민등록번호·계좌번호 전체는 적지 마세요.</p>
              <p id="narrative-count" aria-live="polite">
                {count > 0
                  ? `${count.toLocaleString()} / 5,000자 · 최소 20자`
                  : "20자 이상 적어주세요"}
              </p>
            </div>
            {error ? (
              <ErrorPanel error={error} retry={() => void create()} disabled={busy} />
            ) : null}
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
                ? "사건을 저장하고 있어요. 필요한 보안 확인이 나타나면 완료해 주세요."
                : loading
                  ? "로그인 상태를 확인하고 있어요."
                  : sessionError
                    ? "로그인 상태를 다시 확인해 주세요."
                    : session?.needsConsent
                      ? "필수 동의를 확인하면 바로 시작할 수 있어요."
                      : session?.user?.accountType === "lawyer"
                        ? "변호사 홈에서 프로필과 활동 정보를 관리할 수 있어요."
                        : canCreate
                          ? "들려주신 상황에 맞춰 꼭 필요한 것부터 질문할게요."
                          : "로그인하면 상황을 저장하고, 언제든 대화를 이어갈 수 있어요."}
            </p>
          )}
          {sessionError ? (
            <ErrorPanel error={sessionError} retry={() => void loadSession()} />
          ) : null}
        </>
      )}
      <footer className="conversation-home-footer">
        <p>
          상황 이야기 <span aria-hidden="true">→</span> 맞춤 질문 <span aria-hidden="true">→</span>{" "}
          함께 정리
        </p>
        <p>BARO의 AI 답변은 법률 자문이 아니에요. 중요한 판단은 전문가와 확인해 주세요.</p>
      </footer>
    </section>
  );
}
