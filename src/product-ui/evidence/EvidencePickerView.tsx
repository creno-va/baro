import { Camera, Paperclip } from "lucide-react";
import { Button } from "../Button";
import type { EvidencePickerController } from "./useEvidencePickerController";

/** The two native inputs keep their original refs for the whole picker lifetime. */
export function EvidencePickerView({ controller: c }: { controller: EvidencePickerController }) {
  return (
    <div
      data-product-evidence-picker=""
      data-compact={c.compact || undefined}
      className="min-w-0 space-y-2"
    >
      <input
        ref={c.fileInput}
        type="file"
        hidden
        multiple
        accept={c.photoOnly ? "image/*" : c.acceptedFiles}
        aria-label={c.photoOnly ? "분석할 사진 선택" : "추가할 증거 파일 선택"}
        disabled={c.disabled}
        onChange={(event) => void c.select(event.currentTarget)}
      />
      <input
        ref={c.cameraInput}
        type="file"
        hidden
        accept="image/*"
        capture="environment"
        aria-label="촬영한 사진 선택"
        disabled={c.disabled}
        onChange={(event) => void c.select(event.currentTarget)}
      />
      <div data-product-evidence-picker-actions="" className="flex min-w-0 flex-wrap gap-2">
        {!c.captureOnly && (
          <Button
            variant="secondary"
            aria-describedby={c.description}
            disabled={c.disabled}
            onClick={() => c.open(false)}
          >
            <Paperclip size={18} aria-hidden="true" />
            {c.photoOnly ? "사진 분석" : "파일 선택"}
          </Button>
        )}
        <Button
          variant="secondary"
          aria-describedby={c.description}
          disabled={c.disabled}
          onClick={() => c.open(true)}
        >
          <Camera size={18} aria-hidden="true" />
          촬영해서 추가
        </Button>
      </div>
      <p
        id={c.description}
        className={c.compact ? "sr-only" : "text-xs leading-6 text-[var(--pui-muted)]"}
      >
        모바일에서는 촬영을 요청해요. 촬영이 지원되지 않거나 권한을 거절했다면 파일 선택으로 추가해
        주세요.
      </p>
      {c.notice && (
        <p role="status" className="text-xs leading-6 text-[var(--pui-muted)]">
          {c.notice}
        </p>
      )}
    </div>
  );
}
