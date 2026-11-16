import { useEffect, useId, useRef, useState } from "react";
import { validateUpload } from "../../client/api/files";

const acceptedFiles =
  ".txt,.pdf,.doc,.docx,.hwp,.hwpx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.heic,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.mov,.webm,.avi,.mkv";

export function useEvidencePickerController({
  disabled = false,
  onSelect,
  onError,
  photoOnly = false,
  compact = false,
  captureOnly = false,
  scopeKey = "",
}: {
  disabled?: boolean;
  onSelect: (files: File[]) => void | Promise<void>;
  onError?: (cause: unknown) => unknown;
  photoOnly?: boolean;
  compact?: boolean;
  /** The parent already provides a general file picker. */
  captureOnly?: boolean;
  /** Use caseId + session ticket/epoch, not a foreground refresh counter. */
  scopeKey?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null),
    cameraInput = useRef<HTMLInputElement>(null);
  const opened = useRef<string | null>(null),
    scope = useRef(scopeKey);
  scope.current = scopeKey;
  const [notice, setNotice] = useState("");
  const description = useId();
  useEffect(() => {
    const inputs = [fileInput.current, cameraInput.current];
    const cancel = (event: Event) => {
      // A file picker cancellation must not cancel an enclosing native Dialog.
      event.stopPropagation();
      setNotice("선택을 취소했어요. 파일 선택으로도 추가할 수 있어요.");
    };
    for (const input of inputs) input?.addEventListener("cancel", cancel);
    return () => {
      for (const input of inputs) input?.removeEventListener("cancel", cancel);
    };
  }, []);
  const open = (camera: boolean) => {
    if (disabled) return;
    const input = camera ? cameraInput.current : fileInput.current;
    if (!input) return;
    opened.current = scope.current;
    // Reset before opening so selecting a failed file again emits change.
    input.value = "";
    setNotice(camera ? "촬영을 마치거나 취소한 뒤 파일 선택으로도 추가할 수 있어요." : "");
    try {
      input.click();
    } catch {
      setNotice("촬영 창을 열지 못했어요. 파일 선택으로 추가해 주세요.");
    }
  };
  const select = async (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (disabled || !files.length || opened.current !== scope.current) return;
    try {
      if (files.length > 100)
        throw { code: "VALIDATION_ERROR", message: "한 번에 100개 이하로 선택해 주세요." };
      for (const file of files) {
        validateUpload(file);
        if (photoOnly && !/\.(jpe?g|png|webp|gif|bmp|tiff?|heic)$/i.test(file.name))
          throw { code: "VALIDATION_ERROR", message: "분석할 사진 파일을 선택해 주세요." };
      }
      setNotice("");
      await onSelect(files);
    } catch (cause) {
      onError?.(cause);
    }
  };
  return {
    fileInput,
    cameraInput,
    description,
    disabled,
    photoOnly,
    compact,
    captureOnly,
    notice,
    open,
    select,
    acceptedFiles,
  };
}
export type EvidencePickerProps = Parameters<typeof useEvidencePickerController>[0];
export type EvidencePickerController = ReturnType<typeof useEvidencePickerController>;
