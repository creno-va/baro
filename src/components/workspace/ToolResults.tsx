import { useEffect, useState } from "react";
import { z } from "zod";
import { browserSessionScope } from "../../client/api/context";
import { apiRequest } from "../../client/api/core";
import { type V2ToolResult, v2ToolResultsSchema } from "../../contracts/v2";

const replySchema = z.strictObject({ schemaVersion: z.literal("2"), results: v2ToolResultsSchema });
const statusLabel: Record<V2ToolResult["status"], string> = {
  not_configured: "아직 연결되지 않음",
  input_required: "조회 대상과 전송 동의 필요",
  retrieved: "조회 결과 수신",
  no_record: "제공 범위에서 기록 미확인",
  test_data: "테스트 응답 · 실제 조회 아님",
  unavailable: "응답 확인 실패",
  access_denied: "조회 권한 확인 필요",
};

export function ToolResultCards({ results }: { results: V2ToolResult[] }) {
  return (
    <div className="workspace-tool-results">
      {results.map((result) => (
        <section key={result.id} aria-label={result.title} className="workspace-tool-card">
          <div className="workspace-tool-heading">
            <strong>{result.title}</strong>
            <span>{statusLabel[result.status]}</span>
          </div>
          {result.observedAt && (
            <p className="workspace-tool-time">
              원천 응답 수신{" "}
              <time dateTime={result.observedAt}>
                {new Date(result.observedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}{" "}
                (한국 시간)
              </time>
            </p>
          )}
          {!!result.rows.length && (
            <dl>
              {result.rows.map((row) => (
                <div key={`${row.label}:${row.value}`}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <ul>
            {result.notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
          <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer">
            제공 기관 안내
          </a>
        </section>
      ))}
    </div>
  );
}

/** Separate opt-in endpoint preserves installed clients' strict message DTO. */
export function ToolResults({ caseId, messageId }: { caseId: string; messageId: string }) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<V2ToolResult[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const generation = browserSessionScope.snapshot();
    const scopeSignal = browserSessionScope.signal();
    const clear = () => {
      setResults(null);
      setOpen(false);
      setFailed(false);
    };
    scopeSignal.addEventListener("abort", clear, { once: true });
    setResults(null);
    setFailed(false);
    void (async () => {
      try {
        const response = await apiRequest(
          `/api/v2/cases/${encodeURIComponent(caseId)}/messages/${encodeURIComponent(messageId)}/tool-results`,
          { signal: AbortSignal.any([controller.signal, scopeSignal]) },
        );
        if (!response.ok) throw new Error("TOOL_RESULTS_UNAVAILABLE");
        const value = replySchema.parse(await response.json());
        if (!controller.signal.aborted && browserSessionScope.isCurrent(generation))
          setResults(value.results);
      } catch {
        if (!controller.signal.aborted && browserSessionScope.isCurrent(generation))
          setFailed(true);
      }
    })();
    return () => {
      controller.abort();
      scopeSignal.removeEventListener("abort", clear);
    };
  }, [open, caseId, messageId]);
  return (
    <details
      className="workspace-tool-details"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>공공·외부 조회 내역</summary>
      {open &&
        (failed ? (
          <p role="status">조회 내역을 불러오지 못했어요. 닫았다 다시 열어 주세요.</p>
        ) : results === null ? (
          <p role="status">조회 내역을 확인하고 있어요.</p>
        ) : results.length ? (
          <ToolResultCards results={results} />
        ) : (
          <p>이 답변에 기록된 외부 조회가 없어요.</p>
        ))}
    </details>
  );
}
