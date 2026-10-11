import { useRef, useState } from "react";
import { accessHref } from "../../client/return-path";
import { errorResponseSchema } from "../../contracts";
import { trackCase } from "../../server/modules/analytics/browser";
export function Feedback({ caseId, analysisId }: { caseId: string; analysisId: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    pending = useRef(false);
  async function save(helpful: boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/cases/${caseId}/feedback`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ helpful }),
      });
      if (response.status === 401) {
        window.location.assign(accessHref("login", `/cases/${caseId}`, "session_expired"));
        return;
      }
      if (!response.ok) {
        const error = errorResponseSchema.safeParse(await response.json().catch(() => null));
        setMessage(
          error.success
            ? error.data.error.message
            : "도움 여부를 저장하지 못했어요. 다시 선택해 주세요.",
        );
        return;
      }
      setMessage("도움 여부를 저장했어요. 언제든 다시 선택할 수 있어요.");
      void trackCase("trust_answered", caseId, analysisId, { helpful: helpful ? "yes" : "no" });
    } catch {
      setMessage("도움 여부를 저장하지 못했어요. 다시 선택해 주세요.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="case-panel">
      <h2>도움이 됐나요?</h2>
      <p>
        선택 사항이에요. 도움 여부만 사건과 함께 보관하며 사건 삭제 시 지워져요. 원문이나 자유
        의견은 수집하지 않아요.
      </p>
      <button type="button" disabled={busy} onClick={() => void save(true)}>
        도움이 됐어요
      </button>
      <button type="button" disabled={busy} onClick={() => void save(false)}>
        도움이 되지 않았어요
      </button>
      <p aria-live="polite">{busy ? "도움 여부 저장 중" : message}</p>
    </section>
  );
}
