import { FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { FileView } from "../../client/api/types";
import { Button } from "../ui/button";

function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt={`${file.name} 미리보기`} /> : <FileText aria-hidden="true" />;
}

export function ChatAttachments({
  local,
  uploaded,
  disabled,
  removeLocal,
  removeUploaded,
}: {
  local: File[];
  uploaded: FileView[];
  disabled: boolean;
  removeLocal: (file: File) => void;
  removeUploaded: (id: string) => void;
}) {
  if (!local.length && !uploaded.length) return null;
  return (
    <ul className="workspace-chat-attachments" aria-label="이번 메시지의 첨부 파일">
      {local.map((file) => (
        <li key={`${file.name}:${file.size}:${file.lastModified}`}>
          <LocalPreview file={file} />
          <span>
            {file.name}
            <small>전송 전 · {(file.size / 1024).toFixed(0)} KB</small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`${file.name} 첨부 제거`}
            onClick={() => removeLocal(file)}
          >
            <X size={16} />
          </Button>
        </li>
      ))}
      {uploaded.map((file) => (
        <li key={file.id}>
          <FileText aria-hidden="true" />
          <span>
            {file.name}
            <small>
              {file.status === "ready"
                ? "대화에 함께 보낼 준비 완료"
                : file.status === "failed" || file.uploadRejection
                  ? "처리 실패 · 자료에서 확인"
                  : "파일 처리 중"}
            </small>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`${file.name} 첨부 제거`}
            onClick={() => removeUploaded(file.id)}
          >
            <X size={16} />
          </Button>
        </li>
      ))}
    </ul>
  );
}
