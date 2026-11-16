import { Download, Eye, Files, Trash2 } from "lucide-react";
import { accessHref } from "../../client/return-path";
import { Button, ButtonLink } from "../Button";
import { Dialog } from "../Dialog";
import { GlobalProductTheme } from "../GlobalTheme";
import { AccountLoading, AccountNotice, AccountSection } from "./AccountComponents";
import type { LegacyProfileAssetsController } from "./useLegacyProfileAssetsController";

export function LegacyAssetPreviewContents({
  controller: c,
}: {
  controller: LegacyProfileAssetsController;
}) {
  if (!c.preview) return null;
  const preview = c.preview;
  return (
    <div className="space-y-4 text-sm leading-6 text-[var(--pui-text)]">
      {c.checking ? (
        <AccountLoading title="자료 접근 상태를 확인하고 있어요." />
      ) : preview.type.startsWith("image/") ? (
        <img
          className="mx-auto max-h-[60dvh] max-w-full rounded-xl object-contain"
          src={preview.url}
          alt={preview.title}
        />
      ) : (
        <p>이 자료는 파일로 내려받아 확인해 주세요.</p>
      )}
      {c.error && <AccountNotice tone="danger">{c.error}</AccountNotice>}
      {c.notice && <AccountNotice tone="success">{c.notice}</AccountNotice>}
      <Button
        disabled={!!c.busy || c.checking}
        onClick={() => void c.download(preview.asset, preview.title, preview.scope)}
      >
        <Download size={16} aria-hidden="true" />
        파일 내려받기
      </Button>
    </div>
  );
}
export function LegacyAssetDeleteContents({
  controller: c,
}: {
  controller: LegacyProfileAssetsController;
}) {
  if (!c.target) return null;
  return (
    <div className="space-y-4 text-sm leading-6 text-[var(--pui-text)]">
      {c.checking ? (
        <AccountLoading title="자료 접근 상태를 확인하고 있어요." />
      ) : (
        <p>
          {c.target.title}의 접근을 차단하고 삭제를 요청해요. 이미 내려받은 파일은 삭제하지 않아요.
        </p>
      )}
      {c.busy && <p role="status">{c.busy}</p>}
      {c.error && <AccountNotice tone="danger">{c.error}</AccountNotice>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="danger" disabled={!!c.busy || c.checking} onClick={() => void c.remove()}>
          자료 삭제 요청
        </Button>
        <Button
          variant="secondary"
          disabled={!!c.busy || c.checking}
          onClick={() => c.setTarget(null)}
        >
          취소
        </Button>
      </div>
    </div>
  );
}

/** Recovery of the current owner's retained uploads, without profile publication controls. */
export function LegacyProfileAssetsView({
  controller: c,
}: {
  controller: LegacyProfileAssetsController;
}) {
  if (!c.eligible) return null;
  return (
    <GlobalProductTheme className="min-w-0">
      <AccountSection
        title="이전에 등록한 자료"
        description="이전에 프로필에 올린 본인 자료를 확인하고 보관하거나 삭제할 수 있어요."
        icon={<Files size={22} />}
        action={
          <Button
            variant="secondary"
            disabled={!!c.busy || c.checking}
            onClick={() => void c.load()}
          >
            자료 목록 확인
          </Button>
        }
      >
        <div
          data-product-account-assets=""
          className="space-y-4 text-sm leading-6 text-[var(--pui-text)]"
          aria-busy={!!c.busy || c.checking}
        >
          {c.checking && <AccountLoading title="자료 접근 상태를 확인하고 있어요." />}
          {c.busy && <p role="status">{c.busy}</p>}
          {c.error && !c.target && <AccountNotice tone="danger">{c.error}</AccountNotice>}
          {c.notice && <AccountNotice tone="success">{c.notice}</AccountNotice>}
          {c.usable && c.session?.needsConsent && (
            <AccountNotice>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-[var(--pui-text)]">
                    서비스 이용 전 정책을 다시 확인해 주세요
                  </h3>
                  <p className="mt-1">기존 자료는 확인하거나 삭제할 수 있어요.</p>
                </div>
                <ButtonLink href={accessHref("consent", "/settings")} variant="secondary">
                  정책 확인
                </ButtonLink>
              </div>
            </AccountNotice>
          )}
          {c.usable && c.items === null && (
            <p className="text-[var(--pui-muted)]">
              자료 목록은 버튼을 누르면 불러와요. 새 프로필을 만들거나 자료를 공개하지 않아요.
            </p>
          )}
          {c.usable && c.items?.length === 0 && (
            <div className="rounded-xl border border-dashed border-[var(--pui-border)] p-6 text-center text-[var(--pui-muted)]">
              <p>이전에 등록한 자료가 없어요</p>
            </div>
          )}
          {c.loaded && c.current(c.loaded) && c.items && c.items.length > 0 && (
            <div hidden={!c.usable} inert={!c.usable}>
              <ul className="divide-y divide-[var(--pui-border)]" aria-label="이전에 등록한 자료">
                {c.items.map((asset, index) => {
                  const title = c.assetTitle(asset, index);
                  const loaded = c.loaded;
                  if (!loaded) return null;
                  return (
                    <li
                      key={asset.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <strong className="font-medium [overflow-wrap:anywhere]">{title}</strong>
                        <p className="mt-1 text-xs text-[var(--pui-muted)]">
                          {asset.status === "ready"
                            ? "확인 가능"
                            : asset.status === "failed"
                              ? "처리 실패"
                              : "처리 중"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!!c.busy || asset.status !== "ready"}
                          onClick={(event) => {
                            c.opener.current = event.currentTarget;
                            void c.open(asset, title, loaded);
                          }}
                        >
                          <Eye size={15} aria-hidden="true" />
                          {title} 보기
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!!c.busy || asset.status !== "ready"}
                          onClick={() => void c.download(asset, title, loaded)}
                        >
                          <Download size={15} aria-hidden="true" />
                          {title} 내려받기
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!c.busy}
                          onClick={(event) => {
                            c.opener.current = event.currentTarget;
                            c.setTarget({ asset, title, scope: loaded });
                          }}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                          {title} 삭제
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
        {c.preview && c.current(c.preview.scope) && (
          <Dialog
            open
            title="이전에 등록한 자료"
            returnFocusRef={c.opener}
            onClose={() => {
              if (!c.busy) c.setPreview(null);
            }}
          >
            <LegacyAssetPreviewContents controller={c} />
          </Dialog>
        )}
        {c.target && c.current(c.target.scope) && (
          <Dialog
            open
            title="이 자료를 삭제할까요?"
            returnFocusRef={c.opener}
            showCloseButton={false}
            onClose={() => {
              if (!c.busy) c.setTarget(null);
            }}
          >
            <LegacyAssetDeleteContents controller={c} />
          </Dialog>
        )}
      </AccountSection>
    </GlobalProductTheme>
  );
}
