import { ApiError } from "../../client/api/errors";
import type { ReportView, SessionView } from "../../client/api/types";
import { opaqueIdSchema } from "../../contracts";
import { downloadBlob } from "./download";

export type ReviewedReportDownload = {
  caseId: string;
  reportId: string;
  reportRevision: number;
  expectedOwner: string;
  signal?: AbortSignal;
  /** The host's mounted/case/account epoch fence. false is a cancellation. */
  verify?: () => Promise<boolean | void>;
};
export type ReviewedReportDownloadPorts = {
  session: () => Promise<SessionView>;
  peekReport: (
    caseId: string,
    options: { expectedOwner: string; signal?: AbortSignal },
  ) => Promise<ReportView | null>;
  pdf: (reportId: string) => Promise<Blob>;
  download?: (blob: Blob, filename: string) => void;
};

/** A current, reviewed version only. Metadata reads never prepare an analysis.
 * Resolve means the browser download request was dispatched, not that the user
 * accepted an operating-system save dialog or that a file exists on disk. */
export async function downloadReviewedReport(
  input: ReviewedReportDownload,
  injected?: ReviewedReportDownloadPorts,
): Promise<void> {
  input.signal?.throwIfAborted();
  for (const id of [input.caseId, input.reportId, input.expectedOwner]) opaqueIdSchema.parse(id);
  if (!Number.isSafeInteger(input.reportRevision) || input.reportRevision < 1)
    throw new ApiError("VALIDATION_ERROR", "검토한 리포트 버전을 다시 확인해 주세요.");
  const live = async () => {
    input.signal?.throwIfAborted();
    if ((await input.verify?.()) === false)
      throw new ApiError("UNAUTHENTICATED", "다운로드 화면 또는 이용 계정이 변경됐어요.");
    input.signal?.throwIfAborted();
  };
  await live();
  const ports: ReviewedReportDownloadPorts =
    injected ??
    (await (async () => {
      const { api } = await import("../../client/api");
      return {
        session: () => api.session.get(),
        peekReport: api.rework.peekReport,
        pdf: api.reports.pdf,
      };
    })());
  const owner = async () => {
    await live();
    const session = await ports.session();
    await live();
    if (session.user?.id !== input.expectedOwner)
      throw new ApiError(
        "UNAUTHENTICATED",
        "이용 계정이 변경됐어요. 검토한 리포트를 다시 열어 주세요.",
      );
  };
  const reviewed = async () => {
    const report = await ports.peekReport(input.caseId, {
      expectedOwner: input.expectedOwner,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    await live();
    if (
      report?.caseId !== input.caseId ||
      report.id !== input.reportId ||
      report.revision !== input.reportRevision ||
      report.stale
    )
      throw new ApiError(
        "CONFLICT",
        "검토한 리포트 버전이 바뀌었어요. 내용을 확인한 뒤 다시 저장해 주세요.",
      );
  };
  await owner();
  await reviewed();
  await owner();
  const blob = await ports.pdf(input.reportId);
  await owner();
  await reviewed();
  await owner();
  (ports.download ?? downloadBlob)(blob, `BARO-${input.reportId}.pdf`);
}
