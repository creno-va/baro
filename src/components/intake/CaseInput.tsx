import { ArrowRight, Building2, UserRound } from "lucide-react";
import { type SyntheticEvent, useRef, useState } from "react";
import { api } from "../../client/api";
import { Button, ButtonLink } from "../ui/button";
import { Textarea } from "../ui/form";
import { BackToCases, ErrorPanel, IntakeProgress } from "./common";

export function CaseInput({ siteKey: _siteKey }: { siteKey?: string }) {
  const [narrative, setNarrative] = useState("");
  const [subjectContext, setContext] = useState<"individual" | "company">("individual");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<string | null>(null);
  const pending = useRef(false);
  const count = [...narrative.trim()].length;
  const valid = count >= 20 && count <= 5000;
  async function create(event?: SyntheticEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!valid || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const item = await api.cases.create({ narrative: narrative.trim(), subjectContext });
      setCreated(item.id);
      window.location.assign(`/cases/${encodeURIComponent(item.id)}/intake`);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  return (
    <div className="intake-flow">
      <BackToCases />
      <IntakeProgress step={0} />
      <section className="intake-card">
        <p className="intake-eyebrow">새 사건</p>
        <h1>어떤 일이 있었나요?</h1>
        <p className="intake-muted">
          완벽하게 쓰지 않아도 괜찮아요. 질문에 답하며 차근차근 정리할 수 있어요.
        </p>
        {created ? (
          <div role="status">
            <p>사건이 저장됐어요.</p>
            <ButtonLink href={`/cases/${encodeURIComponent(created)}/intake`}>
              질문 이어가기
            </ButtonLink>
          </div>
        ) : (
          <form onSubmit={(event) => void create(event)}>
            <fieldset className="intake-context" disabled={busy}>
              <legend>누구의 사건인가요?</legend>
              {(["individual", "company"] as const).map((value) => (
                <label key={value} className={subjectContext === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="subject"
                    value={value}
                    checked={subjectContext === value}
                    onChange={() => setContext(value)}
                  />
                  {value === "individual" ? (
                    <UserRound size={20} aria-hidden="true" />
                  ) : (
                    <Building2 size={20} aria-hidden="true" />
                  )}
                  <span>{value === "individual" ? "개인" : "기업"}</span>
                </label>
              ))}
            </fieldset>
            <label className="ui-label" htmlFor="narrative">
              지금까지 있었던 일
            </label>
            <p id="narrative-help" className="intake-muted">
              언제, 누구와, 어떤 일이 있었는지 적어주세요. 불리하거나 확실하지 않은 내용도 함께 적을
              수 있어요. 주민등록번호·계좌번호 전체는 적지 마세요.
            </p>
            <Textarea
              id="narrative"
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
              disabled={busy}
              aria-describedby="narrative-help narrative-count"
              aria-invalid={count > 0 && !valid}
              placeholder="예: 지난달 지인에게 돈을 빌려줬는데, 약속한 날짜가 지나도 돌려받지 못했어요."
            />
            <p id="narrative-count" className="intake-count">
              {count.toLocaleString()} / 5,000자 · 최소 20자
            </p>
            <div className="intake-actions">
              <Button type="submit" disabled={busy || !valid}>
                {busy ? "사건을 저장하고 있어요…" : "저장하고 질문 시작"}
                <ArrowRight size={18} aria-hidden="true" />
              </Button>
              <ButtonLink variant="outline" href="/cases">
                취소
              </ButtonLink>
            </div>
            <p className="intake-muted intake-small" role="status">
              {busy
                ? "필요한 보안 확인이 나타나면 완료해 주세요."
                : "입력한 상황은 사건으로 저장돼요. 이후 언제든 이어서 정리할 수 있어요."}
            </p>
            {error ? (
              <ErrorPanel error={error} retry={() => void create()} disabled={busy} />
            ) : null}
          </form>
        )}
      </section>
    </div>
  );
}
