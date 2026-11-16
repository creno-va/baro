import { type ChangeEvent, useEffect, useRef, useState } from "react";
import type { CaseDetail as Detail } from "../../contracts";
import { observeResult, trackCase } from "../../server/modules/analytics/browser";
export type LegacyResultProps = {
  result: NonNullable<Detail["result"]>;
  caseId: string;
  analysisId: string;
};
type EvidenceItem = Extract<
  LegacyResultProps["result"],
  { kind: "guidance" }
>["evidenceChecklist"][number];
export function useLegacyResultController({ result, caseId, analysisId }: LegacyResultProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const summary = useRef<HTMLElement>(null);
  useEffect(() => {
    let stop: (() => void) | undefined;
    const start = () => {
      stop?.();
      if (summary.current && result.kind === "guidance")
        stop = observeResult(summary.current, caseId, analysisId, result.citations.length);
    };
    start();
    window.addEventListener("baro-analytics-change", start);
    return () => {
      stop?.();
      window.removeEventListener("baro-analytics-change", start);
    };
  }, [result, caseId, analysisId]);
  function evidenceChange(item: EvidenceItem, index: number) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setChecked((current) => ({ ...current, [item.id]: event.target.checked }));
      void trackCase("evidence_checked", caseId, analysisId, {
        itemIndex: index,
        checked: event.target.checked,
      });
    };
  }
  function citationClick(index: number) {
    return () =>
      void trackCase("citation_opened", caseId, analysisId, {
        sourceType: "statute",
        itemIndex: index,
      });
  }
  return { checked, summary, evidenceChange, citationClick };
}
export type LegacyResultController = ReturnType<typeof useLegacyResultController>;
