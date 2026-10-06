import { ArrowRight, FolderOpen, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { CaseView } from "../../client/api/types";
import type { CaseStatus } from "../../contracts";
import { Button, ButtonLink } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import { caseHref, ErrorPanel } from "./common";
import { useCustomerAccess } from "./useCustomerAccess";

// Used by the preserved v1 detail UI.
export const statusLabels: Record<CaseStatus, string> = {
  screening: "입력 확인",
  needs_clarification: "추가 질문",
  queued: "분석 대기",
  analyzing: "공식 자료 확인·결과 점검",
  completed: "결과 완료",
  out_of_scope: "지원 범위 안내",
  urgent_redirect: "긴급 안전 안내",
  failed: "분석 실패",
};
const stageLabels = {
  intake: "질문 답변 중",
  summary: "요약 확인 필요",
  active: "정리 진행 중",
  archived: "보관된 사건",
};
export function CaseList() {
  const [items, setItems] = useState<CaseView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const request = useRef(0);
  const { ready, version, verify, ticket, current, alive, deny } = useCustomerAccess(() => {
    setItems([]);
    setError(null);
    ++request.current;
  }, setError);
  const load = useCallback(async () => {
    const serial = ++request.current;
    let epoch = ticket();
    setLoading(true);
    setError(null);
    try {
      if (!(await verify())) return;
      epoch = ticket();
      const items = await api.cases.list();
      if (!(await verify())) return;
      if (current(epoch) && serial === request.current) setItems(items);
    } catch (cause) {
      if (alive(epoch) && serial === request.current) {
        if (
          ["UNAUTHENTICATED", "CONSENT_REQUIRED", "NOT_FOUND"].includes(
            (cause as { code?: string }).code ?? "",
          )
        )
          deny();
        setError(cause);
      }
    } finally {
      if (alive(epoch) && serial === request.current) setLoading(false);
    }
  }, [verify, ticket, current, alive, deny]);
  useEffect(() => {
    if (version) void load();
  }, [load, version]);
  return (
    <section className="intake-list" aria-busy={loading}>
      <div className="intake-toolbar">
        <span>{ready && items.length ? `${items.length}개의 사건` : "내가 정리하는 사건"}</span>
        <div className="intake-actions">
          <Button variant="outline" disabled={loading} onClick={() => void load()}>
            새로 불러오기
          </Button>
          <ButtonLink href="/cases/new">
            <Plus size={18} aria-hidden="true" />새 사건 만들기
          </ButtonLink>
        </div>
      </div>
      {loading && !error && <StatePanel variant="loading" title="사건 목록을 불러오고 있어요." />}
      {error ? (
        <ErrorPanel error={error} retry={() => void load()} />
      ) : ready && !loading && items.length === 0 ? (
        <div className="intake-empty">
          <FolderOpen size={48} aria-hidden="true" />
          <h2>아직 정리한 사건이 없어요</h2>
          <p>
            어떤 일이 있었는지 적어주세요.
            <br />
            질문에 하나씩 답하며 사실관계를 정리할 수 있어요.
          </p>
          <ButtonLink href="/cases/new">
            첫 사건 만들기
            <ArrowRight size={18} aria-hidden="true" />
          </ButtonLink>
        </div>
      ) : null}
      {ready && !error && (
        <ul className="intake-case-grid">
          {items.map((item) => (
            <li key={item.id}>
              <a href={caseHref(item)} className="intake-case-card">
                <div>
                  <span className="intake-tag">
                    {item.schemaVersion === "1" ? "기존 기록" : stageLabels[item.stage]}
                  </span>
                  <span className="intake-muted">
                    {item.subjectContext === "company" ? "기업 사건" : "개인 사건"}
                  </span>
                </div>
                <h2>{item.title}</h2>
                <p>{item.summary || "저장한 질문에서 이어서 정리할 수 있어요."}</p>
                <footer>
                  <time dateTime={item.updatedAt}>
                    {new Date(item.updatedAt).toLocaleDateString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })}{" "}
                    수정
                  </time>
                  <span>
                    {item.stage === "intake"
                      ? "이어 답하기"
                      : item.stage === "summary"
                        ? "요약 확인"
                        : "사건 열기"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </span>
                </footer>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
