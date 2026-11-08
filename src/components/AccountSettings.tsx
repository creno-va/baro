import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../client/api";
import { accountDeleted } from "../server/modules/analytics/browser";
import { ProviderIcon } from "./AuthButtons";
import { LegacyProfileAssets } from "./lawyers/LegacyProfileAssets";
import { Button, ButtonLink } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input, Label } from "./ui/form";
import { InlineNotice } from "./ui/inline-notice";
import { PageHeader } from "./ui/page-header";
import { ReadingContent } from "./ui/reading-content";
import { ActionGroup, Section } from "./ui/section";
import { StatePanel } from "./ui/state-panel";

const markerKey = "baro.account-reauth.v1";
const providerNames = { google: "Google", naver: "네이버", kakao: "카카오" };
const superseded = () =>
  Object.assign(new Error("설정 확인 요청이 변경됐어요."), { code: "SETTINGS_READ_SUPERSEDED" });
const isSuperseded = (error: unknown) =>
  (error as { code?: string })?.code === "SETTINGS_READ_SUPERSEDED";
type Access = Awaited<ReturnType<typeof api.account.deletionAccess>>;
export function AccountSettings() {
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.account.usage>> | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState<"account" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [deleted, setDeleted] = useState(false);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const owner = useRef<string | null>(null);
  const [checking, setChecking] = useState(true);
  const clearOwnerState = useCallback(() => {
    ++loadSequence.current;
    lock.current = false;
    owner.current = null;
    setUsage(null);
    setAccess(null);
    setReady(false);
    setTarget(null);
    setConfirmation("");
    setNotice("");
    setBusy("");
    setChecking(false);
    sessionStorage.removeItem(markerKey);
  }, []);
  const verifyOwner = useCallback(
    async (onInvalidated?: (sequence: number) => void) => {
      const sequence = loadSequence.current;
      try {
        const value = await api.account.deletionAccess();
        if (sequence !== loadSequence.current) throw superseded();
        if (owner.current && owner.current !== value.ownerTag) {
          throw new Error("계정이 변경됐어요. 설정을 다시 불러와 삭제할 계정을 확인해 주세요.");
        }
        owner.current = value.ownerTag;
        setAccess(value);
        setReady(value.canDelete);
        return value;
      } catch (error) {
        if (isSuperseded(error) || sequence !== loadSequence.current) throw superseded();
        clearOwnerState();
        onInvalidated?.(loadSequence.current);
        throw error;
      }
    },
    [clearOwnerState],
  );
  const load = useCallback(async () => {
    let sequence = ++loadSequence.current;
    const checkOwner = () =>
      verifyOwner((next) => {
        // Clearing inaccessible state invalidates other reads, not this failure.
        sequence = next;
      });
    setChecking(true);
    setBusy("설정 확인 중…");
    setError("");
    try {
      await checkOwner();
      const session = await api.session.get();
      if (sequence !== loadSequence.current) return;
      if (!session.user) throw new Error("로그인 후 설정을 다시 확인해 주세요.");
      const results = await Promise.allSettled([api.account.usage(), api.account.deletionAccess()]);
      if (sequence !== loadSequence.current) return;
      await checkOwner();
      if (sequence !== loadSequence.current) return;
      const problems: string[] = [];
      if (results[0].status === "fulfilled") setUsage(results[0].value);
      else {
        setUsage(null);
        problems.push("사용량을 확인하지 못했어요.");
      }
      if (results[1].status === "fulfilled") {
        const value = results[1].value;
        if (value.ownerTag !== owner.current) {
          throw new Error("계정이 변경됐어요. 설정을 다시 불러와 주세요.");
        }
        setAccess(value);
        const raw = sessionStorage.getItem(markerKey);
        let marker: { ownerTag?: string; startedAt?: number; purpose?: string } | null = null;
        try {
          marker = raw ? JSON.parse(raw) : null;
        } catch {
          sessionStorage.removeItem(markerKey);
        }
        const confirmed = value.canDelete;
        setReady(Boolean(confirmed));
        if (marker && marker.ownerTag !== value.ownerTag) {
          sessionStorage.removeItem(markerKey);
          problems.push("다른 계정으로 인증했어요. 삭제할 계정으로 다시 로그인해 주세요.");
        } else if (confirmed && marker?.purpose === "account-delete") {
          setTarget("account");
          setConfirmation("");
          sessionStorage.setItem(
            markerKey,
            JSON.stringify({ ownerTag: marker.ownerTag, startedAt: marker.startedAt }),
          );
        }
      } else {
        setAccess(null);
        setReady(false);
        problems.push("계정 상태를 확인하지 못했어요. 다시 로그인하거나 재시도해 주세요.");
      }
      setError(problems.join(" "));
    } catch (error) {
      if (isSuperseded(error) || sequence !== loadSequence.current) return;
      clearOwnerState();
      setError(
        `계정 상태를 확인하지 못했어요. ${error instanceof Error ? error.message : "다시 로그인하거나 재시도해 주세요."}`,
      );
    } finally {
      if (sequence === loadSequence.current) {
        setBusy("");
        setChecking(false);
      }
    }
  }, [verifyOwner, clearOwnerState]);
  useEffect(() => {
    void load();
    const check = () => {
      if (document.visibilityState === "hidden" || lock.current) return;
      const sequence = loadSequence.current;
      setChecking(true);
      void verifyOwner()
        .catch((error: unknown) => {
          if (!isSuperseded(error))
            setError(
              error instanceof Error ? error.message : "계정 접근 상태를 다시 확인해 주세요.",
            );
        })
        .finally(() => {
          if (sequence === loadSequence.current) setChecking(false);
        });
    };
    const leaving = () => {
      ++loadSequence.current;
    };
    const returned = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      lock.current = false;
      setTarget(null);
      setConfirmation("");
      void load();
    };
    window.addEventListener("pageshow", returned);
    window.addEventListener("pagehide", leaving);
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      ++loadSequence.current;
      window.removeEventListener("pageshow", returned);
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load, verifyOwner]);
  async function reauthenticate(provider: Access["providers"][number]) {
    if (lock.current || checking || !access) return;
    lock.current = true;
    let sequence = loadSequence.current;
    setBusy("재인증 시작 중…");
    setError("");
    setReady(false);
    try {
      const verified = await verifyOwner();
      if (!verified.providers.includes(provider))
        throw new Error("이 계정에 연결된 로그인 수단을 다시 확인해 주세요.");
      // Earlier load/focus reads cannot consume the new reauthentication marker.
      sequence = ++loadSequence.current;
      sessionStorage.setItem(
        markerKey,
        JSON.stringify({
          ownerTag: verified.ownerTag,
          startedAt: Date.now(),
          purpose: "account-delete",
        }),
      );
      await api.account.reauthenticate(provider);
    } catch (e) {
      if (sequence !== loadSequence.current || isSuperseded(e)) return;
      sessionStorage.removeItem(markerKey);
      setError(e instanceof Error ? e.message : "재인증을 시작하지 못했어요.");
    } finally {
      if (sequence === loadSequence.current) {
        lock.current = false;
        setBusy("");
      }
    }
  }
  async function remove() {
    if (
      lock.current ||
      checking ||
      !target ||
      confirmation !== "DELETE" ||
      (target === "account" && !ready)
    )
      return;
    lock.current = true;
    setBusy("삭제 요청 중…");
    setError("");
    setNotice("");
    try {
      const verified = await verifyOwner();
      if (target === "account" && !verified.canDelete)
        throw Object.assign(new Error("삭제 전 같은 계정으로 다시 인증해 주세요."), {
          code: "REAUTHENTICATION_REQUIRED",
        });
      if (target === "account") {
        await api.account.deleteAccount(confirmation);
        sessionStorage.removeItem(markerKey);
        setDeleted(true);
        setTarget(null);
        await accountDeleted().catch(() => false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제를 확인하지 못했어요. 다시 확인해 주세요.");
      if (
        [
          "UNAUTHENTICATED",
          "REAUTHENTICATION_REQUIRED",
          "CONSENT_REQUIRED",
          "NOT_FOUND",
          "FORBIDDEN",
        ].includes((e as { code?: string })?.code ?? "")
      ) {
        setReady(false);
        setConfirmation("");
        setTarget(null);
        sessionStorage.removeItem(markerKey);
      }
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  const open = (value: "account") => {
    setTarget(value);
    setConfirmation("");
    setError("");
  };
  if (deleted)
    return (
      <ReadingContent className="ui-stack">
        <PageHeader title="계정 삭제를 접수했어요" />
        <StatePanel
          variant="success"
          title="로그인 세션을 종료하고 접근을 차단했어요"
          description="원격 파일·백업 정리는 삭제 절차에 따라 진행돼요."
        />
        <ActionGroup>
          <ButtonLink href="/login">로그인 화면으로</ButtonLink>
          <ButtonLink href="/help#deletion" variant="secondary">
            삭제 도움말
          </ButtonLink>
        </ActionGroup>
      </ReadingContent>
    );
  return (
    <ReadingContent className="account-settings ui-stack" aria-busy={Boolean(busy) || checking}>
      <PageHeader
        title="설정과 사용량"
        description="이용 현황과 계정 정보를 확인해요."
        action={
          <Button
            variant="secondary"
            loading={Boolean(busy) || checking}
            disabled={Boolean(busy) || checking}
            onClick={() => void load()}
          >
            다시 확인
          </Button>
        }
      />
      {(busy || checking) && (
        <StatePanel variant="loading" title={busy || "계정 접근 상태 확인 중…"} />
      )}
      {error && !target && <InlineNotice tone="danger" title={error} announce />}
      {notice && <InlineNotice tone="success" title={notice} announce />}
      <Section
        title="사용량과 한도"
        description="오늘 얼마나 이용했는지 살펴보세요. 일일 한도는 한국 시간 자정에 다시 열려요."
        className="settings-usage"
      >
        {usage && !checking && (
          <div className="ui-grid">
            {(
              [
                ["오늘 새 사건", usage.newCases, "건"],
                ["오늘 AI 응답", usage.aiResponses, "회"],
                ["오늘 음성·영상", usage.mediaMinutes, "분"],
                [
                  "계정 저장 공간",
                  { used: usage.storageBytes.used / 1e9, limit: usage.storageBytes.limit / 1e9 },
                  "GB",
                ],
              ] as const
            ).map(([label, count, unit]) => (
              <div key={label} className="ui-stack">
                <dl>
                  <dt>{label}</dt>
                  <dd>
                    <strong>
                      {Number(count.used.toFixed(2))} {unit}
                    </strong>{" "}
                    / {count.limit} {unit}
                  </dd>
                </dl>
                <progress
                  aria-label={label}
                  value={Math.min(count.used, count.limit)}
                  max={count.limit}
                />
                {count.used >= count.limit && (
                  <InlineNotice tone="warning" title="한도에 도달했어요">
                    저장한 내용은 확인·삭제할 수 있어요.
                  </InlineNotice>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="ui-stack">
          <p>저장 공간은 자료를 삭제해 확보할 수 있어요.</p>
          {usage?.includesReservations && (
            <p className="ui-muted">진행 중인 처리 예약을 포함한 사용량이에요.</p>
          )}
          {usage?.resetAt && (
            <p className="ui-meta">
              다음 일일 한도 갱신:{" "}
              {new Date(usage.resetAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
            </p>
          )}
          {usage?.waitReasons?.includes("monthly_budget") && (
            <InlineNotice tone="warning" title="새 자동 처리가 대기 중이에요">
              처리 상태를 다시 확인해 주세요. 저장한 내용을 확인하거나 삭제할 수 있어요.
            </InlineNotice>
          )}
          {usage?.waitReasons?.includes("ai_funding") && (
            <InlineNotice tone="warning" title="AI 실행 설정을 확인 중이에요">
              저장한 내용을 확인하거나 삭제할 수 있어요.
            </InlineNotice>
          )}
          {usage?.waitReasons?.includes("processing_capacity") && (
            <InlineNotice tone="warning" title="처리 용량 때문에 새 자동 처리가 대기 중이에요">
              잠시 후 다시 확인해 주세요.
            </InlineNotice>
          )}
          <details>
            <summary>파일별 한도와 처리 안내</summary>
            <p>
              사건별 원본은 최대 100개·5GB예요. 문서·이미지 100MB, 음성·영상 1GB, PDF 500쪽, 미디어
              60분 한도를 적용해요. 실제 처리 용량이나 서비스 장애로 자동 처리가 대기할 수 있어요.
            </p>
            <a className="ui-link" href="/help#limits">
              한도와 대기 도움말
            </a>
          </details>
        </div>
      </Section>
      <Section title="도움말과 정책" className="settings-help">
        <nav className="ui-cluster" aria-label="도움말과 정책">
          <a className="ui-link" href="/help">
            사용 도움말
          </a>
          <a className="ui-link" href="/policies/terms">
            이용약관
          </a>
          <a className="ui-link" href="/policies/privacy">
            개인정보 처리방침
          </a>
          <a className="ui-link" href="/policies/ai">
            AI 이용 고지
          </a>
        </nav>
      </Section>
      <LegacyProfileAssets />
      <Section
        title="계정 삭제"
        className="settings-danger"
        action={
          <Button
            variant="destructive"
            disabled={Boolean(busy) || checking || !access}
            onClick={(event) => {
              event.currentTarget.focus();
              open("account");
            }}
          >
            계정과 모든 사건 삭제
          </Button>
        }
      >
        <p>
          이 계정에 연결된 로그인 수단으로 본인을 확인한 뒤 삭제를 요청할 수 있어요. 삭제 전에
          필요한 자료를 보관하세요.
        </p>
      </Section>
      {target && (
        <Dialog
          open
          title={ready ? "계정과 모든 사건을 삭제할까요?" : "계정 삭제 전 본인 확인"}
          showCloseButton={false}
          onOpenChange={(value) => {
            if (!value && !busy) setTarget(null);
          }}
        >
          <div className="ui-stack" aria-busy={Boolean(busy)}>
            {busy && <StatePanel variant="loading" title={busy} />}
            {!ready ? (
              <>
                <p>안전한 삭제를 위해 이 계정에 연결된 로그인 수단으로 다시 인증해 주세요.</p>
                <div className="ui-stack">
                  {access?.providers.map((provider) => (
                    <Button
                      key={provider}
                      variant="secondary"
                      className="settings-provider"
                      disabled={Boolean(busy) || checking}
                      onClick={() => void reauthenticate(provider)}
                    >
                      <ProviderIcon provider={provider} />
                      <span>{providerNames[provider]}로 재인증</span>
                    </Button>
                  ))}
                </div>
                {access && !access.providers.length && (
                  <a className="ui-link" href="/login">
                    다시 로그인
                  </a>
                )}
              </>
            ) : (
              <>
                <p>
                  계정의 사건·자료·리포트·프로필 접근을 차단하고 세션을 종료해요. 삭제를 접수한 뒤
                  원격 자료 정리가 진행돼요. 이미 다운로드하거나 외부에 전달한 파일은 삭제할 수
                  없어요.
                </p>
                <div>
                  <Label htmlFor="delete-confirmation">삭제 확인 — DELETE 입력</Label>
                  <Input
                    id="delete-confirmation"
                    autoComplete="off"
                    value={confirmation}
                    disabled={Boolean(busy) || checking}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </div>
              </>
            )}
            {error && <InlineNotice tone="danger" title={error} announce />}
            <ActionGroup>
              {ready && (
                <Button
                  variant="destructive"
                  disabled={Boolean(busy) || checking || !ready || confirmation !== "DELETE"}
                  onClick={() => void remove()}
                >
                  {busy ? "삭제 요청 중…" : "삭제 요청 확인"}
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={Boolean(busy) || checking}
                onClick={() => setTarget(null)}
              >
                취소
              </Button>
            </ActionGroup>
          </div>
        </Dialog>
      )}
    </ReadingContent>
  );
}
