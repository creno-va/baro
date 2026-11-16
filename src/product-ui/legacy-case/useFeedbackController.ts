import { useRef, useState } from "react";
import { accessHref } from "../../client/return-path";
import { errorResponseSchema } from "../../contracts";
import { trackCase } from "../../server/modules/analytics/browser";
export function useFeedbackController({
  caseId,
  analysisId,
}: {
  caseId: string;
  analysisId: string;
}) {
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
  return { busy, message, save };
}
export type FeedbackController = ReturnType<typeof useFeedbackController>;
