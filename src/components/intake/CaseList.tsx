import { useCallback, useEffect, useState } from "react";
import { type CaseStatus, caseListResponseSchema, type CaseList as List } from "../../contracts";
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
export function CaseList() {
  const [list, setList] = useState<List | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/cases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      if (response.status === 401) {
        window.location.assign("/login?error=session_expired");
        return;
      }
      if (!response.ok) throw new Error();
      const next = caseListResponseSchema.parse(await response.json());
      setList((current) =>
        cursor && current
          ? { items: [...current.items, ...next.items], nextCursor: next.nextCursor }
          : next,
      );
    } catch {
      setError("목록을 불러오지 못했어요. 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("pageshow", refresh);
    return () => window.removeEventListener("pageshow", refresh);
  }, [load]);
  return (
    <section className="case-panel" aria-busy={loading}>
      <div className="case-actions">
        <a className="button-link primary" href="/cases/new">
          새 사건 입력
        </a>
      </div>
      <p className="status-text" aria-live="polite">
        {loading
          ? "사건 목록을 불러오고 있어요."
          : list?.items.length === 0
            ? "아직 입력한 사건이 없어요."
            : ""}
      </p>
      {error && (
        <div role="alert">
          <p className="error-text">{error}</p>
          <button type="button" onClick={() => void load()}>
            다시 불러오기
          </button>
        </div>
      )}
      <ul className="case-list">
        {list?.items.map((item) => (
          <li key={item.id}>
            <a
              href={`/cases/${item.id}`}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                void noteExistingCase(item.id, item.createdAt)
                  .catch(() => undefined)
                  .finally(() => window.location.assign(`/cases/${item.id}`));
              }}
            >
              {item.title}
            </a>
            <p>{statusLabels[item.status]}</p>
            <time dateTime={item.createdAt}>
              {new Date(item.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
            </time>
          </li>
        ))}
      </ul>
      {list?.nextCursor && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(list.nextCursor ?? undefined)}
        >
          더 보기
        </button>
      )}
    </section>
  );
}

import { noteExistingCase } from "../../server/modules/analytics/browser";
