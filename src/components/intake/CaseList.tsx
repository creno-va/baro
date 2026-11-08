import { ArrowRight, Plus, RotateCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../client/api";
import type { CaseView } from "../../client/api/types";
import type { CaseStatus } from "../../contracts";
import { Badge } from "../ui/badge";
import { Button, ButtonLink } from "../ui/button";
import { List, ListLink, ListMeta, ListRow, ListTitle } from "../ui/list";
import { LoadingContent } from "../ui/loading";
import { PageHeader } from "../ui/page-header";
import { ReadingContent } from "../ui/reading-content";
import { Section } from "../ui/section";
import { StatePanel } from "../ui/state-panel";
import { CaseDeleteDialog } from "./CaseDeleteDialog";
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
  const [deleting, setDeleting] = useState<CaseView | null>(null);
  const [notice, setNotice] = useState("");
  const request = useRef(0);
  const { ready, version, verify, ticket, current, alive, deny } = useCustomerAccess(
    () => {
      setItems([]);
      setDeleting(null);
      setError(null);
      ++request.current;
    },
    setError,
    true,
  );
  const load = useCallback(async () => {
    const serial = ++request.current;
    let epoch = ticket();
    setLoading(true);
    setError(null);
    try {
      if (!(await verify()) || serial !== request.current) return;
      epoch = ticket();
      const items = await api.cases.list();
      if (serial !== request.current || !(await verify())) return;
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
    <ReadingContent width="wide" className="case-list ui-stack" aria-busy={loading}>
      <PageHeader
        title="내 사건"
        description="답변·자료·리포트를 이어서 확인하고 준비할 일을 보완하세요."
        action={
          <ButtonLink href="/cases/new">
            <Plus size={18} aria-hidden="true" />새 사건 만들기
          </ButtonLink>
        }
      />
      <Section
        title={ready ? `불러온 사건 ${items.length}개` : "저장한 사건"}
        action={
          <Button
            variant="ghost"
            disabled={loading}
            loading={loading && !error}
            onClick={() => void load()}
          >
            <RotateCw size={16} aria-hidden="true" />
            새로 불러오기
          </Button>
        }
      >
        {notice && <p role="status">{notice}</p>}
        {loading && !items.length && !error && (
          <LoadingContent title="사건 목록을 불러오고 있어요." />
        )}
        {error ? (
          <ErrorPanel error={error} retry={() => void load()} />
        ) : ready && !loading && items.length === 0 ? (
          <StatePanel
            variant="empty"
            title="아직 정리한 사건이 없어요"
            description="짧은 설명으로 시작해 사실과 준비할 일을 정리할 수 있어요. 자료가 없어도 시작할 수 있어요."
          />
        ) : null}
        {ready && !error && (
          <List className="case-list__rows">
            {items.map((item) => (
              <ListRow key={item.id} className="case-list__row">
                <ListLink href={caseHref(item)} className="case-list__open">
                  <div className="case-list__identity">
                    <Badge tone={item.stage === "summary" ? "warning" : "neutral"}>
                      {item.schemaVersion === "1" ? "기존 기록" : stageLabels[item.stage]}
                    </Badge>
                    <ListTitle>{item.title}</ListTitle>
                    <p>{item.summary || "저장한 질문에서 이어서 정리할 수 있어요."}</p>
                  </div>
                  <ListMeta className="case-list__next">
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
                  </ListMeta>
                </ListLink>
                <Button
                  variant="ghost"
                  aria-label={`${item.title} 사건 삭제`}
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    event.currentTarget.focus();
                    setDeleting(item);
                  }}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  사건 삭제
                </Button>
              </ListRow>
            ))}
          </List>
        )}
      </Section>
      {deleting && (
        <CaseDeleteDialog
          item={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setItems((old) => old.filter((item) => item.id !== deleting.id));
            setDeleting(null);
            setNotice("사건 삭제를 접수했어요. 원격 자료 정리는 별도 절차로 진행돼요.");
          }}
        />
      )}
    </ReadingContent>
  );
}
