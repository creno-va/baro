import { ArrowRight, Building2, FileText, WalletCards } from "lucide-react";
import { type SyntheticEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { ApiError } from "../../client/api/core";
import type { CaseView, SessionView } from "../../client/api/types";
import { sessionDestination } from "../../client/return-path";
import { isExplicitSignOut } from "../../client/session-events";
import type { V2CaseContext } from "../../contracts/v2";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { FieldDescription, Label, Select, Textarea } from "../ui/form";
import { PageHeader } from "../ui/page-header";
import { ReadingContent } from "../ui/reading-content";
import { Section } from "../ui/section";
import { ErrorPanel } from "./common";

// A web entry requirement; saved narratives and installed clients keep their read contracts.
const APP_NARRATIVE_MIN_LENGTH = 10;

// UI choices map to the existing purpose/procedure contract. They are not new stored enums.
const entryChoices = [
  { id: "civil-prepare", label: "민사 준비", purpose: "prepare_claim", kind: "civil" },
  { id: "civil-response", label: "민사 대응", purpose: "respond_to_claim", kind: "civil" },
  { id: "criminal-prepare", label: "형사 고소 준비", purpose: "prepare_claim", kind: "criminal" },
  { id: "criminal-response", label: "형사 대응", purpose: "respond_to_claim", kind: "criminal" },
  {
    id: "unknown-prepare",
    label: "분야는 아직 모름 · 요구 준비",
    purpose: "prepare_claim",
    kind: "unconfirmed",
  },
  {
    id: "unknown-response",
    label: "분야는 아직 모름 · 받은 주장에 대응",
    purpose: "respond_to_claim",
    kind: "unconfirmed",
  },
] as const;

const individualExamples = [
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

const responseExamples = [
  {
    label: "돈을 갚으라는 연락을 받았어요",
    text: "상대방에게서 돈을 갚으라는 연락을 받았어요. 상대방의 주장과 제가 기억하는 일을 구분해 정리하고 싶어요. ",
    Icon: WalletCards,
  },
  {
    label: "고소했다는 연락을 받았어요",
    text: "상대방이 고소했다고 알려왔어요. 어떤 일이 있었는지와 제가 받은 연락, 확인된 진행 상황을 정리하고 싶어요. ",
    Icon: FileText,
  },
  {
    label: "계약 책임을 묻는 연락을 받았어요",
    text: "상대방이 계약을 지키지 않았다고 주장해요. 당시 약속과 실제로 한 일, 서로 다르게 기억하는 부분을 정리하고 싶어요. ",
    Icon: Building2,
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
  const [entryChoice, setEntryChoice] = useState<string>("unknown-prepare");
  const choice = entryChoices.find((item) => item.id === entryChoice) ?? entryChoices[4];
  const casePurpose = choice.purpose;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [contextSaved, setContextSaved] = useState(false);
  const registration = useRef<CaseView | null>(null);
  const [lengthError, setLengthError] = useState("");
  const narrativeRef = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const identity = useRef<string | undefined>(undefined);
  const sessionRequest = useRef(0);
  const operation = useRef(0);
  const mounted = useRef(false);
  const signedOut = useRef(false);
  const count = [...narrative.trim()].length;
  const valid = count >= APP_NARRATIVE_MIN_LENGTH && count <= 5000;
  const canCreate = !!session?.user && !session.needsConsent;
  const clearDraft = useCallback(() => {
    ++operation.current;
    pending.current = false;
    setBusy(false);
    setNarrative("");
    setEntryChoice("unknown-prepare");
    registration.current = null;
    setCreated(null);
    setContextSaved(false);
    setError(null);
    setLengthError("");
  }, []);
  const loadSession = useCallback(async () => {
    if (signedOut.current) return null;
    const ticket = ++sessionRequest.current;
    const current = () =>
      mounted.current && !signedOut.current && ticket === sessionRequest.current;
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
      if (requireSession && (!next.user || next.needsConsent)) {
        window.location.replace(sessionDestination(next, window.location.pathname));
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
    signedOut.current = false;
    const refresh = () => void loadSession();
    const changed = (event: Event) => {
      if (!isExplicitSignOut(event)) return refresh();
      signedOut.current = requireSession;
      ++sessionRequest.current;
      clearDraft();
      identity.current = JSON.stringify([null, null, false]);
      setSession({ user: null, needsConsent: false });
      setLoading(false);
      setSessionError(null);
      // The menu owns same-tab navigation. Peer tabs need their own redirect.
      if (requireSession && event.type === "storage") window.location.replace("/login");
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const storage = (event: StorageEvent) => {
      if (isExplicitSignOut(event)) return changed(event);
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
    window.addEventListener("baro-session-changed", changed);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      ++sessionRequest.current;
      ++operation.current;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("baro-session-changed", changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [clearDraft, loadSession, requireSession]);

  async function create(event?: SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canCreate || loading || sessionError || pending.current || contextSaved) return;
    if (!valid) {
      setLengthError(
        count < APP_NARRATIVE_MIN_LENGTH
          ? `어떤 일이 있었는지 ${APP_NARRATIVE_MIN_LENGTH}자 이상 적어주세요. 짧게 시작하고 나중에 보완해도 괜찮아요.`
          : "이야기는 5,000자까지 적을 수 있어요. 내용을 조금 줄여주세요.",
      );
      return;
    }
    const ticket = ++operation.current;
    const current = () => mounted.current && ticket === operation.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const fresh = await loadSession();
      if (!current() || !fresh?.user || fresh.needsConsent) return;
      const item =
        registration.current ??
        (await api.rework.createCase(
          {
            narrative: narrative.trim(),
            // Compatibility field for installed clients; the UI no longer classifies the owner.
            subjectContext: "individual",
            casePurpose,
          },
          { expectedOwner: fresh.user.id },
        ));
      if (!current()) return;
      // Keep an accepted registration across a context failure. Retrying must not create another case.
      registration.current = item;
      setCreated(item.id);
      const desired: V2CaseContext = {
        casePurpose,
        subjectContext: "individual",
        procedure: { kind: choice.kind, stage: "unconfirmed", description: null },
      };
      const saved = await api.rework.getContext(item.id, { expectedOwner: fresh.user.id });
      if (!current()) return;
      // An ambiguous prior PUT may already have saved this exact selection.
      if (JSON.stringify(saved.context) !== JSON.stringify(desired)) {
        await api.rework.updateContext(
          item.id,
          {
            ...desired,
            casePurpose,
            expectedRevision: saved.workspaceRevision,
          },
          { expectedOwner: fresh.user.id },
        );
      }
      // A completed request must not restore a prior owner's UI after an account switch.
      await loadSession();
      if (!current()) return;
      setContextSaved(true);
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
    <>
      <ReadingContent className="case-entry ui-stack">
        <PageHeader
          title="내 사건, 무엇부터 준비할까요?"
          description="사건의 흐름과 준비할 일을 정리하고, 대화·자료·리포트에서 계속 보완해요."
        />
        {created && canCreate && !loading && !sessionError ? (
          <Section title={contextSaved ? "사건과 준비 방향을 저장했어요" : "사건은 등록했어요"}>
            <div className="ui-stack" role="status">
              {!contextSaved && error ? (
                <>
                  <p>
                    선택한 방향은 {choice.label}예요. 같은 사건에서 다시 저장하며 사건을 새로 만들지
                    않아요.
                  </p>
                  <ErrorPanel error={error} disabled={busy} />
                  <Button disabled={busy} loading={busy} onClick={() => void create()}>
                    준비 방향 저장 다시 시도
                  </Button>
                </>
              ) : contextSaved ? (
                <ButtonLink href={`/cases/${encodeURIComponent(created)}/intake`}>
                  질문 이어가기 <ArrowRight size={18} aria-hidden="true" />
                </ButtonLink>
              ) : (
                <p>선택한 준비 방향을 저장하고 있어요.</p>
              )}
            </div>
          </Section>
        ) : (
          <Section
            title="설명으로 시작해요"
            description="기억나는 일부터 짧게 적어주세요. 자료는 사건을 만든 뒤 추가할 수 있어요."
          >
            <form
              className="case-entry__form ui-stack"
              aria-busy={busy || loading}
              onSubmit={(event) => void create(event)}
            >
              <div className="case-entry__direction ui-stack">
                <Label htmlFor="case-entry-choice">준비하는 방향</Label>
                <Select
                  id="case-entry-choice"
                  value={entryChoice}
                  onChange={(event) => setEntryChoice(event.target.value)}
                  disabled={busy || loading || !canCreate}
                  aria-describedby="subject-context-help"
                >
                  {entryChoices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
                <FieldDescription id="subject-context-help" aria-live="polite">
                  {casePurpose === "respond_to_claim"
                    ? "소장이나 고소장이 없어도, 알고 있는 주장과 내 설명으로 시작할 수 있어요."
                    : "돈·보증금 등 원하는 해결이나 피해로 겪은 일을 정리해요. 분야와 단계는 나중에 확인할 수 있어요."}
                </FieldDescription>
              </div>
              <div className="case-entry__narrative ui-stack">
                <Label htmlFor="narrative">지금까지 있었던 일</Label>
                <Textarea
                  ref={narrativeRef}
                  id="narrative"
                  rows={4}
                  value={loading || sessionError ? "" : narrative}
                  onChange={(event) => setNarrative(event.target.value)}
                  disabled={busy || loading || !!sessionError || !canCreate}
                  aria-describedby="narrative-minimum entry-support"
                  aria-invalid={count > 5000 || Boolean(lengthError)}
                  placeholder={
                    casePurpose === "respond_to_claim"
                      ? "어떤 주장을 받았나요? 상대방의 주장과 내가 기억하는 일을 구분해 적어주세요."
                      : "누구와 어떤 일이 있었나요? 기억나는 일부터 편하게 적어주세요."
                  }
                />
                <FieldDescription id="narrative-minimum" className="conversation-context-hint">
                  {APP_NARRATIVE_MIN_LENGTH}자 이상 입력해주세요
                </FieldDescription>
              </div>
              {error ? (
                <ErrorPanel error={error} retry={() => void create()} disabled={busy} />
              ) : null}
              <div className="ui-actions">
                {loading || sessionError ? (
                  <Button disabled>
                    {sessionError ? "로그인 상태를 확인해 주세요" : "로그인 상태 확인 중…"}
                  </Button>
                ) : canCreate ? (
                  <Button type="submit" loading={busy}>
                    {busy ? "이야기를 저장하고 있어요…" : "저장하고 계속"}
                    <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                ) : (
                  <ButtonLink href={session?.needsConsent ? "/consent" : "/login"}>
                    {session?.needsConsent ? "동의하고 시작하기" : "로그인하고 시작하기"}
                    <ArrowRight size={18} aria-hidden="true" />
                  </ButtonLink>
                )}
              </div>
              <FieldDescription id="entry-support">
                문서만으로 시작하는 기능은 아직 제공하지 않아요. 설명을 저장한 뒤 자료를 추가해
                주세요.
              </FieldDescription>
            </form>
            {!narrative && !session?.needsConsent ? (
              <div className="case-entry__examples ui-stack">
                <p>어떻게 시작할지 막막하다면</p>
                <div className="ui-actions">
                  {(casePurpose === "respond_to_claim" ? responseExamples : individualExamples).map(
                    ({ label, text, Icon }) => (
                      <Button
                        key={label}
                        variant="ghost"
                        disabled={loading || !canCreate}
                        onClick={() => {
                          setNarrative((existing) =>
                            existing.trim() ? `${existing}\n${text}` : text,
                          );
                          narrativeRef.current?.focus();
                        }}
                      >
                        <Icon size={16} aria-hidden="true" />
                        {label}
                      </Button>
                    ),
                  )}
                </div>
              </div>
            ) : null}
            {sessionError ? (
              <ErrorPanel error={sessionError} retry={() => void loadSession()} />
            ) : null}
          </Section>
        )}
        <footer className="case-entry__footer ui-stack">
          <FieldDescription>
            상황 입력 → 질문 최대 두 차례·차례당 최대 3개 → 요약 확인
          </FieldDescription>
          <FieldDescription>
            BARO의 AI 답변은 법률 자문이 아니에요. 중요한 판단은 전문가와 확인해 주세요.
          </FieldDescription>
        </footer>
      </ReadingContent>
      <Dialog
        returnFocusRef={narrativeRef}
        open={Boolean(lengthError)}
        onOpenChange={(open) => {
          if (!open) {
            setLengthError("");
          }
        }}
        title={count > 5000 ? "이야기를 조금 줄여주세요" : "이야기를 조금만 더 적어주세요"}
        description={lengthError}
      >
        <Button onClick={() => setLengthError("")}>계속 작성하기</Button>
      </Dialog>
    </>
  );
}
