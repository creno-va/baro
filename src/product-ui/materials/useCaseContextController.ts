import { useEffect, useState } from "react";
import type { CaseContextPanelProps } from "./types";

/** Preserve explicit tab choice and lazy research intent across data refreshes. */
export function useCaseContextController({
  files,
  reportStatus,
  viewingFileId,
  materialsRequest = 0,
  needsEvidence = false,
}: CaseContextPanelProps) {
  const failed = files.filter((file) => file.status === "failed" || file.uploadRejection);
  const processing = files.filter((file) =>
    ["uploading", "processing", "waiting"].includes(file.status),
  );
  const attention =
    needsEvidence ||
    failed.length > 0 ||
    processing.length > 0 ||
    reportStatus === "stale" ||
    reportStatus === "failed";
  const [chosen, setChosen] = useState<number | null>(null);
  const [researchOpened, setResearchOpened] = useState(false);
  const active = chosen ?? (attention || !files.length ? 0 : 1);
  useEffect(() => {
    if (viewingFileId) setChosen(1);
  }, [viewingFileId]);
  useEffect(() => {
    if (materialsRequest > 0) setChosen(1);
  }, [materialsRequest]);
  const select = (index: number) => {
    setChosen(index);
    if (index === 2) setResearchOpened(true);
  };
  return { failed, processing, attention, active, researchOpened, select };
}
export type CaseContextController = ReturnType<typeof useCaseContextController>;
