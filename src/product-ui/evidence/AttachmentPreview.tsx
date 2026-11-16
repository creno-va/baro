import { FileText } from "lucide-react";
import { useEffect, useState } from "react";

/** Only local image previews create object URLs, and each URL is revoked on release. */
export function AttachmentPreview({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? (
    <img
      className="h-10 w-10 shrink-0 rounded-lg object-cover"
      src={url}
      alt={`${file.name} 미리보기`}
      onError={() => setUrl("")}
    />
  ) : (
    <FileText size={20} className="shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
  );
}
