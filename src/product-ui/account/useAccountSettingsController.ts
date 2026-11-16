import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { accountDeleted } from "../../server/modules/analytics/browser";

const markerKey = "baro.account-reauth.v1";
const superseded = () =>
  Object.assign(new Error("설정 확인 요청이 변경됐어요."), { code: "SETTINGS_READ_SUPERSEDED" });
const isSuperseded = (error: unknown) =>
  (error as { code?: string })?.code === "SETTINGS_READ_SUPERSEDED";
type Access = Awaited<ReturnType<typeof api.account.deletionAccess>>;
export function useAccountSettingsController() {
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof api.account.usage>> | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState<"account" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const confirmationField = useRef<HTMLInputElement | null>(null);
  const [deleted, setDeleted] = useState(false);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const owner = useRef<string | null>(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    if (target && ready && !busy && !checking) confirmationField.current?.focus();
  }, [target, ready, busy, checking]);
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
  return {
    usage,
    access,
    ready,
    busy,
    error,
    notice,
    target,
    confirmation,
    confirmationField,
    deleted,
    checking,
    load,
    reauthenticate,
    remove,
    open,
    setTarget,
    setConfirmation,
  };
}
export type AccountSettingsController = ReturnType<typeof useAccountSettingsController>;
export type AccountProvider = Access["providers"][number];
