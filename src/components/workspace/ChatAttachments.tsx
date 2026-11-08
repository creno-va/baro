import { FileText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileView } from "../../client/api/types";
import { Button } from "../ui/button";
import { materialState, materialStateLabels } from "./evidence-state";
import "../../styles/evidence.css";

function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? (
    <img src={url} alt={`${file.name} 미리보기`} onError={() => setUrl("")} />
  ) : (
    <FileText aria-hidden="true" />
  );
}

export function ChatAttachments({
  local,
  uploaded,
  disabled,
  removeLocal,
  removeUploaded,
  label = "이번 메시지의 첨부 파일",
}: {
  local: File[];
  uploaded: FileView[];
  disabled: boolean;
  removeLocal: (file: File) => void;
  removeUploaded: (id: string) => void;
  label?: string;
}) {
  const localKeys = useRef(new WeakMap<File, number>()),
    nextKey = useRef(0);
  const localKey = (file: File) => {
    let key = localKeys.current.get(file);
    if (key === undefined) {
      key = ++nextKey.current;
      localKeys.current.set(file, key);
    }
    return key;
  };
  if (!local.length && !uploaded.length) return null;
  return (
    <ul className="workspace-chat-attachments" aria-label={label}>
      {local.map((file) => (
        <li key={localKey(file)}>
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
              {file.status === "ready" && !file.uploadRejection
                ? "대화에 함께 보낼 준비 완료 · 내용 검토 필요"
                : materialStateLabels[materialState(file)]}
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
