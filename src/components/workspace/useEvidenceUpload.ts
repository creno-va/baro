import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import { browserSessionScope } from "../../client/api/context";
import { uploadFingerprints, validateUpload } from "../../client/api/files";
import type { FileUploadProgress, FileView } from "../../client/api/types";
import { useCustomerAccess } from "../intake/useCustomerAccess";

/** No raw file/OCR persistence. Existing private API owns checksums, receipts and resume.
 * Mount the consuming editor with key=caseId. Pending server work survives dismissal. */
export function useEvidenceUpload({
  caseId,
  disabled = false,
  onUploaded,
  onError,
  onBusyChange,
}: {
  caseId: string;
  disabled?: boolean;
  onUploaded: (files: FileView[]) => Promise<unknown>;
  onError?: ((cause: unknown) => unknown) | undefined;
  onBusyChange?: ((busy: boolean) => void) | undefined;
}) {
  const [local, setLocal] = useState<File[]>([]),
    [uploaded, setUploaded] = useState<FileView[]>([]);
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<{ name: string; value: FileUploadProgress } | null>(
    null,
  );
  const locked = useRef(false),
    reading = useRef(false),
    serial = useRef(0);
  const selected = useRef(local),
    callbacks = useRef({ onUploaded, onError });
  const selectionQueue = useRef<Promise<void>>(Promise.resolve());
  const selectionCount = useRef(0);
  const hashes = useRef(new WeakMap<File, Promise<string>>());
  selected.current = local;
  callbacks.current = { onUploaded, onError };
  const report = useCallback((cause: unknown) => {
    setError(cause);
    callbacks.current.onError?.(cause);
  }, []);
  const purge = useCallback(() => {
    // An actual owner/role/sign-out transition must also stop an in-flight part chain.
    browserSessionScope.invalidate();
    serial.current++;
    locked.current = false;
    reading.current = false;
    selectionQueue.current = Promise.resolve();
    selectionCount.current = 0;
    setSelecting(false);
    hashes.current = new WeakMap();
    setLocal([]);
    setUploaded([]);
    setConsent(false);
    setBusy(false);
    setProgress(null);
    setNotice("");
    setError(null);
  }, []);
  const access = useCustomerAccess(purge, report, true);
  const { ready, canMutate, verify, ticket, current, alive, version } = access;
  const writable = ready && canMutate && !disabled;
  useEffect(() => {
    onBusyChange?.(busy || selecting);
    return () => onBusyChange?.(false);
  }, [busy, selecting, onBusyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!locked.current && !selectionCount.current && !selected.current.length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const refresh = useCallback(async () => {
    if (reading.current || locked.current) return;
    reading.current = true;
    const request = ++serial.current;
    let epoch = ticket();
    try {
      if (!(await verify()) || request !== serial.current) return;
      epoch = ticket();
      const next = await api.files.list(caseId, { metadataOnly: true });
      if (!(await verify()) || !current(epoch) || request !== serial.current) return;
      setUploaded(next);
    } catch (cause) {
      if (alive(epoch) && request === serial.current) report(cause);
    } finally {
      if (request === serial.current) reading.current = false;
    }
  }, [caseId, verify, ticket, current, alive, report]);
  useEffect(() => {
    if (version) void refresh();
  }, [version, refresh]);
  const pending = uploaded.some(
    (file) => !file.uploadRejection && ["uploading", "processing", "waiting"].includes(file.status),
  );
  useEffect(() => {
    if (!ready || !pending) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [ready, pending, refresh]);

  async function select(files: File[]) {
    if (locked.current || !writable) return;
    const epoch = ticket();
    selectionCount.current++;
    setSelecting(true);
    const task = selectionQueue.current
      .catch(() => {})
      .then(async () => {
        if (locked.current || !writable || !current(epoch)) return;
        if (!(await verify(false, true)) || !current(epoch)) return;
        const merged = [...selected.current];
        const fingerprint = (file: File) => {
          let value = hashes.current.get(file);
          if (!value) {
            value = uploadFingerprints(file, browserSessionScope.signal()).then(
              (value) => value.contentHash,
            );
            hashes.current.set(file, value);
          }
          return value;
        };
        for (const file of files) {
          validateUpload(file);
          let duplicate = merged.includes(file);
          for (const other of merged) {
            if (duplicate) break;
            if (other.name === file.name && other.size === file.size && other.type === file.type)
              duplicate = (await fingerprint(other)) === (await fingerprint(file));
          }
          if (!current(epoch)) return;
          if (!duplicate) merged.push(file);
        }
        if (merged.length > 100)
          throw { code: "VALIDATION_ERROR", message: "한 번에 100개 이하로 선택해 주세요." };
        selected.current = merged;
        setLocal(merged);
        setError(null);
        setNotice("");
      })
      .finally(() => {
        if (!alive(epoch)) return;
        selectionCount.current--;
        if (!selectionCount.current) setSelecting(false);
      });
    selectionQueue.current = task;
    return task;
  }
  async function upload() {
    if (
      locked.current ||
      selectionCount.current ||
      !writable ||
      !consent ||
      !selected.current.length
    )
      return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    const epoch = ticket(),
      chosen = [...selected.current],
      accepted: FileView[] = [];
    serial.current++;
    reading.current = false;
    try {
      if (!(await verify(false, true)) || !current(epoch)) return;
      for (const file of chosen) {
        if (!current(epoch)) return;
        try {
          const result = await api.files.upload(
            caseId,
            file,
            (value) => {
              if (current(epoch)) setProgress({ name: file.name, value });
            },
            { metadataOnly: true },
          );
          if (!(await verify(false, true)) || !current(epoch)) return;
          accepted.push(result);
          // Clear accepted inputs before callbacks/readback so an unrelated refresh failure
          // never resends a committed file. The API reconciles an ambiguous ACK by exact ID.
          setLocal((items) => items.filter((item) => item !== file));
          setUploaded((items) => [...items.filter((item) => item.id !== result.id), result]);
        } catch (cause) {
          if (!current(epoch)) return;
          if ((cause as { code?: string })?.code === "FILE_REJECTED") {
            setLocal((items) => items.filter((item) => item !== file));
            setNotice(
              "등록이 거절됐어요. 암호·보호를 해제하거나 지원하는 형식의 파일을 새로 선택해 주세요.",
            );
          }
          throw cause;
        }
      }
      if (current(epoch))
        setNotice("자료를 저장했어요. 분석 후 관찰 내용을 확인하고 사건에 반영해 주세요.");
    } catch (cause) {
      if (alive(epoch)) report(cause);
    } finally {
      if (alive(epoch)) {
        // Notification failure is independent of upload admission and retained selections.
        if (accepted.length) {
          try {
            await callbacks.current.onUploaded(accepted);
          } catch (cause) {
            if (alive(epoch)) report(cause);
          }
        }
        if (alive(epoch)) {
          locked.current = false;
          setBusy(false);
          setProgress(null);
          void refresh();
        }
      }
    }
  }
  return {
    local,
    uploaded,
    consent,
    setConsent,
    busy,
    selecting,
    error,
    notice,
    progress,
    writable,
    ready,
    scopeKey: `${caseId}:${ticket()}`,
    select,
    upload,
    refresh,
    report,
    verifyWrite: async () => {
      const epoch = ticket();
      return (await verify(false, true)) && current(epoch);
    },
    remove: (file: File) => {
      if (!locked.current && !selectionCount.current)
        setLocal((items) => items.filter((item) => item !== file));
    },
  };
}
