import { useRef, useState } from "react";
import { api } from "../../client/api";
import type { CaseView } from "../../client/api/types";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { ErrorPanel } from "./common";
import { useCustomerAccess } from "./useCustomerAccess";

export function CaseDeleteDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: CaseView;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const access = useCustomerAccess(onClose, setError, true);
  async function remove() {
    if (!access.ready || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const epoch = access.ticket();
    try {
      if (!(await access.verify(false, false)) || !access.current(epoch)) return;
      await api.account.deleteCase(item.id, "DELETE", item.schemaVersion ?? "2");
      if (access.alive(epoch)) onDeleted();
    } catch (cause) {
      if (access.alive(epoch)) setError(cause);
    } finally {
      locked.current = false;
      if (access.alive(epoch)) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="이 사건을 삭제할까요?"
    >
      {access.ready && (
        <>
          <p>
            사건과 연결된 자료·리포트의 삭제를 요청해요. 필요한 파일은 먼저 다운로드하세요. 삭제 후
            되돌릴 수 없어요.
          </p>
          <p>삭제 접수 후 접근을 차단하며, 원격 파일과 백업 정리는 별도 절차로 진행돼요.</p>
        </>
      )}
      {error ? <ErrorPanel error={error} /> : null}
      <div className="deletion-dialog-actions">
        <Button
          variant="destructive"
          loading={busy}
          disabled={!access.ready || busy}
          onClick={() => void remove()}
        >
          {busy ? "삭제 접수 중…" : "사건 삭제"}
        </Button>
        <Button variant="outline" autoFocus disabled={busy} onClick={onClose}>
          취소
        </Button>
      </div>
    </Dialog>
  );
}
