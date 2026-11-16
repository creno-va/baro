import { Send } from "lucide-react";
import { Button } from "../Button";
import { Dialog } from "../Dialog";
import { InputField } from "../Field";
import { SelectField } from "../Select";
import { fields, recipients } from "./presentation";
import type { LookupController } from "./useLookupController";

export function LookupView({ controller }: { controller: LookupController }) {
  const { returnFocusRef, busy, sending, onClose } = controller;
  return (
    <Dialog
      open
      returnFocusRef={returnFocusRef}
      onClose={() => {
        if (!busy && !sending) onClose();
      }}
      title="공공·외부 정보 조회"
      description="조회 대상을 직접 입력하고, 전송할 내용을 확인해 주세요."
    >
      <LookupContents controller={controller} />
    </Dialog>
  );
}

/** The catalog and recipient-specific request remain data; only submit can send. */
export function LookupContents({ controller: c }: { controller: LookupController }) {
  const {
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
    submit,
    setValues,
    setConsent,
    setError,
    changeTool,
    changeKind,
  } = c;
  if (!catalog)
    return (
      <p role="status" className="text-sm leading-7 text-[var(--pui-muted)]">
        {error || "연결된 조회 서비스를 확인하고 있어요."}
      </p>
    );
  if (!available.length)
    return (
      <p role="status" className="text-sm leading-7 text-[var(--pui-muted)]">
        아직 연결된 조회 서비스가 없어요.
      </p>
    );
  return (
    <form
      noValidate
      data-product-lookup=""
      className="min-w-0 space-y-5 text-[var(--pui-text)] [overflow-wrap:anywhere]"
      onSubmit={submit}
    >
      <SelectField
        id={`${prefix}-tool`}
        label="조회 서비스"
        value={tool}
        disabled={locked}
        onValueChange={changeTool}
        options={available.map((entry) => ({ value: entry.tool, label: entry.title }))}
      />
      <p className="text-xs leading-6 text-[var(--pui-muted)]">{definition?.description}</p>
      {tool === "thecheat" && (
        <SelectField
          id={`${prefix}-kind`}
          label="조회할 정보 종류"
          value={kind}
          disabled={locked}
          onValueChange={changeKind}
          options={[
            { value: "phone", label: "전화번호" },
            { value: "account", label: "계좌번호" },
          ]}
        />
      )}
      {tool &&
        fields[tool].map(([name, label, max]) => (
          <InputField
            key={name}
            id={`${prefix}-${name}`}
            label={label}
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
        ))}
      {tool === "datahub_building" && (
        <p className="rounded-xl bg-[var(--pui-background)] p-3 text-xs leading-6 text-[var(--pui-muted)]">
          공식 자료에서 확인한 식별자를 입력해 주세요. 주소만으로 값을 추정하지 않아요.
        </p>
      )}
      {tool && (
        <section
          data-product-lookup-consent=""
          className="space-y-3 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-background)] p-4 text-sm leading-7"
        >
          <p>
            <strong className="font-medium">수신 서비스: {recipients[tool]}</strong>
          </p>
          <p className="text-xs leading-6 text-[var(--pui-muted)]">
            입력한 {fields[tool].map(([, label]) => label).join(", ")}를 해당 서비스에 전송해요.
            결과는 이 사건에 저장되며, 거래 안전이나 권리관계를 확정하지 않아요.
          </p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm leading-6">
            <input
              type="checkbox"
              checked={consent}
              disabled={locked}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 appearance-auto accent-[var(--pui-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pui-focus)] disabled:opacity-50"
            />
            위 조회 대상의 외부 전송에 동의합니다.
          </label>
        </section>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-[var(--pui-danger)] p-3 text-sm leading-6 text-[var(--pui-danger)]"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" disabled={busy || sending} onClick={onClose}>
          닫기
        </Button>
        <Button type="submit" disabled={busy || sending || !consent || !tool}>
          <Send size={15} aria-hidden="true" />
          {sending || busy
            ? "요청 확인 중"
            : attempt.current
              ? "같은 요청 다시 확인"
              : "동의하고 조회 요청"}
        </Button>
      </div>
    </form>
  );
}
