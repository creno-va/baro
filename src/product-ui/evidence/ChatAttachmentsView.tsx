import { FileText, X } from "lucide-react";
import { materialState, materialStateLabels } from "../../components/workspace/evidence-state";
import { Button } from "../Button";
import { AttachmentPreview } from "./AttachmentPreview";
import type { ChatAttachmentsController } from "./useChatAttachmentsController";

export function ChatAttachmentsView({ controller: c }: { controller: ChatAttachmentsController }) {
  if (!c.local.length && !c.uploaded.length) return null;
  return (
    <ul
      data-product-chat-attachments=""
      aria-label={c.label}
      className="m-0 grid min-w-0 list-none gap-2 p-0 text-[var(--pui-text)]"
    >
      {c.local.map((file) => (
        <li
          key={c.localKey(file)}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-2"
        >
          <AttachmentPreview file={file} />
          <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            {file.name}
            <small className="mt-1 block text-xs text-[var(--pui-muted)]">
              전송 전 · {(file.size / 1024).toFixed(0)} KB
            </small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={c.disabled}
            aria-label={`${file.name} 첨부 제거`}
            onClick={() => c.removeLocal(file)}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </li>
      ))}
      {c.uploaded.map((file) => (
        <li
          key={file.id}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-2"
        >
          <FileText size={20} className="shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
            {file.name}
            <small className="mt-1 block text-xs text-[var(--pui-muted)]">
              {file.status === "ready" && !file.uploadRejection
                ? "대화에 함께 보낼 준비 완료 · 내용 검토 필요"
                : materialStateLabels[materialState(file)]}
            </small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={c.disabled}
            aria-label={`${file.name} 첨부 제거`}
            onClick={() => c.removeUploaded(file.id)}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
