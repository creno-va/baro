import type { LookupCatalog } from "@baro/api-client";
import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import { api } from "../../client/api";
import {
  LOOKUP_CONSENT_VERSION,
  type V2LookupRequest,
  v2LookupRequestSchema,
} from "../../contracts/v2";
import type { Tool } from "./presentation";
export function useLookupController({
  caseId,
  busy,
  onClose,
  onSubmit,
  returnFocusRef,
}: {
  caseId: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (request: V2LookupRequest) => Promise<boolean>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const prefix = useId();
  const [catalog, setCatalog] = useState<LookupCatalog | null>(null);
  const [tool, setTool] = useState<Tool | "">("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<"phone" | "account">("phone");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const attempt = useRef<V2LookupRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void api.workspace
      .lookupCatalog(caseId)
      .then((tools) => {
        if (!active) return;
        setCatalog(tools);
        const first = tools.find(
          (entry) => entry.status === "input_required" && entry.tool !== "registry",
        );
        if (first && first.tool !== "registry") setTool(first.tool);
      })
      .catch(() => {
        if (active)
          setError("조회 서비스의 연결 상태를 확인하지 못했어요. 닫은 뒤 다시 확인해 주세요.");
      });
    return () => {
      active = false;
      mounted.current = false;
      attempt.current = null;
    };
  }, [caseId]);
  const available =
    catalog?.filter((entry) => entry.status === "input_required" && entry.tool !== "registry") ??
    [];
  const definition = available.find((entry) => entry.tool === tool);
  const locked = busy || sending || !!attempt.current;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || sending || !tool || !definition) return;
    const target =
      tool === "thecheat"
        ? {
            kind,
            keyword: values.keyword ?? "",
            ...(values.bankCode ? { bankCode: values.bankCode } : {}),
          }
        : values;
    const parsed = v2LookupRequestSchema.safeParse({
      tool,
      target,
      consent: {
        version: LOOKUP_CONSENT_VERSION,
        recipient: tool === "hometax_status" ? "nts" : tool === "thecheat" ? "thecheat" : "datahub",
        transmit: consent,
      },
    });
    if (!parsed.success) {
      setError("조회 대상의 입력 형식과 전송 동의를 확인해 주세요.");
      return;
    }
    attempt.current ??= parsed.data;
    setSending(true);
    setError("");
    void onSubmit(attempt.current)
      .then((accepted) => {
        if (!mounted.current) return;
        if (accepted) onClose();
        else
          setError(
            "전송 결과를 확인하지 못했어요. 다시 확인하면 같은 요청을 사용해요. 외부 조회를 자동으로 재실행하지 않아요.",
          );
      })
      .catch(() => {
        if (mounted.current)
          setError("전송 결과를 확인하지 못했어요. 같은 요청으로 다시 확인해 주세요.");
      })
      .finally(() => {
        if (mounted.current) setSending(false);
      });
  }
  function changeTool(value: string) {
    setTool(value as Tool);
    setValues({});
    setConsent(false);
    setError("");
  }
  function changeKind(value: string) {
    setKind(value as "phone" | "account");
    setValues({});
    setConsent(false);
  }
  return {
    prefix,
    catalog,
    tool,
    values,
    kind,
    consent,
    error,
    sending,
    attempt,
    available,
    definition,
    locked,
    busy,
    onClose,
    returnFocusRef,
    submit,
    setValues,
    setConsent,
    setError,
    changeTool,
    changeKind,
  };
}
export type LookupProps = Parameters<typeof useLookupController>[0];
export type LookupController = ReturnType<typeof useLookupController>;
