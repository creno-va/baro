import type { LookupCatalog } from "@baro/api-client";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../client/api";
import {
  LOOKUP_CONSENT_VERSION,
  type V2LookupRequest,
  v2LookupRequestSchema,
} from "../../contracts/v2";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

type Tool = V2LookupRequest["tool"];
const recipients = {
  hometax_status: "국세청",
  thecheat: "더치트",
  datahub_property: "데이터허브",
  datahub_building: "데이터허브",
} as const;
const fields = {
  hometax_status: [["businessNumber", "사업자등록번호", 10]],
  thecheat: [
    ["keyword", "조회할 전화번호 또는 계좌번호", 20],
    ["bankCode", "은행 코드 (선택, 숫자 3자리)", 3],
  ],
  datahub_property: [["address", "조회할 주소", 200]],
  datahub_building: [
    ["INNB", "대지 고유번호 (INNB)", 19],
    ["RNMGTSN", "도로명 코드 (RNMGTSN)", 12],
    ["BULDMNNM", "건물 본번 (BULDMNNM)", 5],
    ["BULDSLNO", "건물 부번 (BULDSLNO)", 5],
  ],
} as const;

/** Targets exist only in component memory and the encrypted server request.
 * Closing/unmounting discards the form; the model never supplies its values. */
export function LookupDialog({
  caseId,
  busy,
  onClose,
  onSubmit,
}: {
  caseId: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (request: V2LookupRequest) => Promise<boolean>;
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy && !sending) onClose();
      }}
      title="공공·외부 정보 조회"
      description="조회 대상을 직접 입력하고, 전송할 내용을 확인해 주세요."
    >
      {!catalog ? (
        <p role="status">{error || "연결된 조회 서비스를 확인하고 있어요."}</p>
      ) : !available.length ? (
        <p role="status">아직 연결된 조회 서비스가 없어요.</p>
      ) : (
        <form
          className="workspace-lookup"
          onSubmit={(event) => {
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
                recipient:
                  tool === "hometax_status" ? "nts" : tool === "thecheat" ? "thecheat" : "datahub",
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
          }}
        >
          <label htmlFor={`${prefix}-tool`}>조회 서비스</label>
          <select
            id={`${prefix}-tool`}
            value={tool}
            disabled={locked}
            onChange={(event) => {
              setTool(event.target.value as Tool);
              setValues({});
              setConsent(false);
              setError("");
            }}
          >
            {available.map((entry) => (
              <option key={entry.tool} value={entry.tool}>
                {entry.title}
              </option>
            ))}
          </select>
          <p className="workspace-lookup__hint">{definition?.description}</p>
          {tool === "thecheat" && (
            <>
              <label htmlFor={`${prefix}-kind`}>조회할 정보 종류</label>
              <select
                id={`${prefix}-kind`}
                value={kind}
                disabled={locked}
                onChange={(event) => {
                  setKind(event.target.value as "phone" | "account");
                  setValues({});
                  setConsent(false);
                }}
              >
                <option value="phone">전화번호</option>
                <option value="account">계좌번호</option>
              </select>
            </>
          )}
          {tool &&
            fields[tool].map(([name, label, max]) => (
              <div key={name} className="workspace-lookup__field">
                <label htmlFor={`${prefix}-${name}`}>{label}</label>
                <input
                  id={`${prefix}-${name}`}
                  type="text"
                  inputMode={name === "address" ? "text" : "numeric"}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={max}
                  required={name !== "bankCode"}
                  value={values[name] ?? ""}
                  disabled={locked}
                  onChange={(event) => {
                    setValues((old) => ({ ...old, [name]: event.target.value }));
                    setConsent(false);
                    setError("");
                  }}
                />
              </div>
            ))}
          {tool === "datahub_building" && (
            <p className="workspace-lookup__hint">
              공식 자료에서 확인한 식별자를 입력해 주세요. 주소만으로 값을 추정하지 않아요.
            </p>
          )}
          {tool && (
            <div className="workspace-lookup__consent">
              <p>
                <strong>수신 서비스: {recipients[tool]}</strong>
              </p>
              <p>
                입력한 {fields[tool].map(([, label]) => label).join(", ")}를 해당 서비스에 전송해요.
                결과는 이 사건에 저장되며, 거래 안전이나 권리관계를 확정하지 않아요.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={locked}
                  onChange={(event) => setConsent(event.target.checked)}
                />{" "}
                위 조회 대상의 외부 전송에 동의합니다.
              </label>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="workspace-buttons">
            <Button type="button" variant="outline" disabled={busy || sending} onClick={onClose}>
              닫기
            </Button>
            <Button type="submit" disabled={busy || sending || !consent || !tool}>
              {sending || busy
                ? "요청 확인 중"
                : attempt.current
                  ? "같은 요청 다시 확인"
                  : "동의하고 조회 요청"}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
