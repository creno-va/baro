import { useRef } from "react";
import type { FileView } from "../../client/api/types";

export function useChatAttachmentsController({
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
  return { local, uploaded, disabled, removeLocal, removeUploaded, label, localKey };
}
export type ChatAttachmentsProps = Parameters<typeof useChatAttachmentsController>[0];
export type ChatAttachmentsController = ReturnType<typeof useChatAttachmentsController>;
