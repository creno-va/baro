import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { type LawyerAssetView, lawyerAssets, lawyerErrorMessage } from "../../client/api/lawyers";
import type { SessionView } from "../../client/api/types";
import { accessHref } from "../../client/return-path";
import { Button, ButtonLink } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { InlineNotice } from "../ui/inline-notice";
import { ActionGroup, Section } from "../ui/section";
import { StatePanel } from "../ui/state-panel";
import { downloadLawyerAsset } from "./AssetPhoto";

type Scope = { identity: string; epoch: number };
const assetTitle = (asset: LawyerAssetView, index: number) =>
  `${asset.purpose === "profile_photo" ? "프로필 사진" : "등록 자료"} ${index + 1}`;

/** Existing owners recover their uploads here; no profile creation/edit/publication is exposed. */
export function LegacyProfileAssets() {
  const [eligible, setEligible] = useState(false);
  const [session, setSession] = useState<SessionView | null>(null);
  const [checking, setChecking] = useState(true);
  const [items, setItems] = useState<LawyerAssetView[] | null>(null);
  const [loaded, setLoaded] = useState<Scope | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState<{
    asset: LawyerAssetView;
    title: string;
    scope: Scope;
  } | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    type: string;
    title: string;
    asset: LawyerAssetView;
    scope: Scope;
  } | null>(null);
  const alive = useRef(false);
  const identity = useRef<string | null>(null);
  const epoch = useRef(0);
  const checks = useRef(0);
  const operation = useRef(0);
  const locked = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const current = useCallback(
    (scope: Scope) =>
      alive.current && identity.current === scope.identity && epoch.current === scope.epoch,
    [],
  );
  const clear = useCallback(() => {
    ++epoch.current;
    ++operation.current;
    locked.current = false;
    setItems(null);
    setLoaded(null);
    setTarget(null);
    setPreview(null);
    setBusy("");
    setNotice("");
  }, []);
  const verify = useCallback(async (): Promise<Scope | null> => {
    const ticket = ++checks.current;
    setChecking(true);
    try {
      const value = await api.session.get();
      if (!alive.current || ticket !== checks.current) return null;
      const next = value.user
        ? `${value.user.id}:${value.user.accountType}:${value.needsConsent}`
        : "signed-out";
      if (identity.current !== next) {
        clear();
        identity.current = next;
      }
      setSession(value);
      setEligible(value.user?.accountType === "lawyer");
      setChecking(false);
      return value.user?.accountType === "lawyer" ? { identity: next, epoch: epoch.current } : null;
    } catch (cause) {
      if (!alive.current || ticket !== checks.current) return null;
      clear();
      identity.current = null;
      setSession(null);
      setChecking(false);
      setError(lawyerErrorMessage(cause));
      return null;
    }
  }, [clear]);
  useEffect(() => {
    alive.current = true;
    const refresh = () => {
      void verify();
    };
    const changed = () => {
      clear();
      identity.current = null;
      setSession(null);
      refresh();
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", changed);
    window.addEventListener("baro-session-changed", changed);
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive.current = false;
      ++epoch.current;
      ++checks.current;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", changed);
      window.removeEventListener("baro-session-changed", changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [clear, verify]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function run(label: string, work: (scope: Scope) => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    const ticket = ++operation.current;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const scope = await verify();
      if (!scope || operation.current !== ticket) return;
      await work(scope);
    } catch (cause) {
      if (
        (cause as { httpStatus?: number })?.httpStatus === 403 ||
        ["UNAUTHENTICATED", "FORBIDDEN", "ROLE_REQUIRED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(
          (cause as { code?: string })?.code ?? "",
        )
      ) {
        // A resource denial is authoritative even if a separate session read
        // still reports the same account. Never retain a revoked private view.
        clear();
        setError("자료 접근 권한을 확인하지 못했어요. 로그인과 계정 상태를 다시 확인해 주세요.");
        await verify();
        return;
      }
      const verified = await verify();
      if (verified && operation.current === ticket) setError(lawyerErrorMessage(cause));
    } finally {
      if (alive.current && operation.current === ticket) {
        locked.current = false;
        setBusy("");
      }
    }
  }
  const same = async (scope: Scope) => {
    const verified = await verify();
    return (
      !!verified &&
      current(scope) &&
      verified.identity === scope.identity &&
      verified.epoch === scope.epoch
    );
  };
  const load = () =>
    run("자료 목록을 확인하고 있어요.", async (scope) => {
      const result = await lawyerAssets.list();
      if (!(await same(scope))) return;
      setItems(result);
      setLoaded(scope);
    });
  const download = (asset: LawyerAssetView, title: string, scope: Scope) =>
    run("파일을 내려받고 있어요.", async (checked) => {
      if (!current(scope) || checked.identity !== scope.identity) return;
      // privateRead selects the current-owner asset endpoint. Its profileId argument
      // is unused; do not call getMine(), whose legacy GET can create a new profile.
      await downloadLawyerAsset("", asset.id, true, title, () => same(scope));
      if (current(scope)) setNotice("파일 내려받기를 요청했어요.");
    });
  const open = (asset: LawyerAssetView, title: string, scope: Scope) =>
    run("자료를 열고 있어요.", async (checked) => {
      if (!current(scope) || checked.identity !== scope.identity) return;
      const blob = await lawyerAssets.blob("", asset.id, true);
      if (!(await same(scope))) return;
      setPreview({ url: URL.createObjectURL(blob), type: blob.type, title, asset, scope });
    });
  const remove = () => {
    const selected = target;
    if (!selected) return;
    return run("자료 삭제를 요청하고 있어요.", async (scope) => {
      if (!current(selected.scope) || scope.identity !== selected.scope.identity) return;
      await lawyerAssets.remove(selected.asset.id, selected.asset.revision);
      if (!(await same(selected.scope))) return;
      setItems((values) => values?.filter((asset) => asset.id !== selected.asset.id) ?? null);
      setTarget(null);
      setPreview(null);
      setNotice("자료 삭제를 접수했어요. 원격 자료 정리는 삭제 절차에 따라 진행돼요.");
    });
  };

  if (!eligible) return null;
  const usable = !checking && session?.user?.accountType === "lawyer";
  return (
    <Section
      title="이전에 등록한 자료"
      description="이전에 프로필에 올린 본인 자료를 확인하고 보관하거나 삭제할 수 있어요."
      action={
        <Button variant="secondary" disabled={!!busy || checking} onClick={() => void load()}>
          자료 목록 확인
        </Button>
      }
    >
      <div className="ui-stack" aria-busy={!!busy || checking}>
        {checking && <StatePanel variant="loading" title="자료 접근 상태를 확인하고 있어요." />}
        {busy && <p role="status">{busy}</p>}
        {error && !target && <InlineNotice tone="danger" title={error} announce />}
        {notice && <InlineNotice tone="success" title={notice} announce />}
        {usable && session.needsConsent && (
          <InlineNotice
            title="서비스 이용 전 정책을 다시 확인해 주세요"
            action={
              <ButtonLink href={accessHref("consent", "/settings")} variant="secondary">
                정책 확인
              </ButtonLink>
            }
          >
            기존 자료는 확인하거나 삭제할 수 있어요.
          </InlineNotice>
        )}
        {usable && items === null && (
          <p>자료 목록은 버튼을 누르면 불러와요. 새 프로필을 만들거나 자료를 공개하지 않아요.</p>
        )}
        {usable && items?.length === 0 && (
          <StatePanel variant="empty" title="이전에 등록한 자료가 없어요" />
        )}
        {loaded && current(loaded) && items && items.length > 0 && (
          <div hidden={!usable} inert={!usable}>
            <ul className="ui-stack" aria-label="이전에 등록한 자료">
              {items.map((asset, index) => {
                const title = assetTitle(asset, index);
                return (
                  <li key={asset.id}>
                    <p>
                      <strong>{title}</strong> ·{" "}
                      {asset.status === "ready"
                        ? "확인 가능"
                        : asset.status === "failed"
                          ? "처리 실패"
                          : "처리 중"}
                    </p>
                    <ActionGroup>
                      <Button
                        variant="secondary"
                        disabled={!!busy || asset.status !== "ready"}
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          void open(asset, title, loaded);
                        }}
                      >
                        {title} 보기
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!!busy || asset.status !== "ready"}
                        onClick={() => void download(asset, title, loaded)}
                      >
                        {title} 내려받기
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!!busy}
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          setTarget({ asset, title, scope: loaded });
                        }}
                      >
                        {title} 삭제
                      </Button>
                    </ActionGroup>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      {preview && current(preview.scope) && (
        <Dialog
          open
          title="이전에 등록한 자료"
          returnFocusRef={opener}
          onOpenChange={(value) => {
            if (!value && !busy) setPreview(null);
          }}
        >
          <div className="ui-stack">
            {checking ? (
              <StatePanel variant="loading" title="자료 접근 상태를 확인하고 있어요." />
            ) : preview.type.startsWith("image/") ? (
              <img src={preview.url} alt={preview.title} />
            ) : (
              <p>이 자료는 파일로 내려받아 확인해 주세요.</p>
            )}
            <Button
              disabled={!!busy || checking}
              onClick={() => void download(preview.asset, preview.title, preview.scope)}
            >
              파일 내려받기
            </Button>
          </div>
        </Dialog>
      )}
      {target && current(target.scope) && (
        <Dialog
          open
          title="이 자료를 삭제할까요?"
          returnFocusRef={opener}
          showCloseButton={false}
          onOpenChange={(value) => {
            if (!value && !busy) setTarget(null);
          }}
        >
          <div className="ui-stack">
            {checking ? (
              <StatePanel variant="loading" title="자료 접근 상태를 확인하고 있어요." />
            ) : (
              <p>
                {target.title}의 접근을 차단하고 삭제를 요청해요. 이미 내려받은 파일은 삭제하지
                않아요.
              </p>
            )}
            {busy && <p role="status">{busy}</p>}
            {error && <InlineNotice tone="danger" title={error} announce />}
            <ActionGroup>
              <Button
                variant="destructive"
                disabled={!!busy || checking}
                onClick={() => void remove()}
              >
                자료 삭제 요청
              </Button>
              <Button
                variant="secondary"
                disabled={!!busy || checking}
                onClick={() => setTarget(null)}
              >
                취소
              </Button>
            </ActionGroup>
          </div>
        </Dialog>
      )}
    </Section>
  );
}
