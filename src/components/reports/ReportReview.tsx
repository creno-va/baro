import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { ReportReviewView } from "../../product-ui/reports/ReportReviewView";
import {
  type ReportReviewProps,
  useReportReviewController,
} from "../../product-ui/reports/useReportReviewController";
import { FollowUpResolution } from "../resolution/FollowUpResolution";
import { EvidenceUpload } from "../workspace/EvidenceUpload";

export type { ReportReviewProps } from "../../product-ui/reports/useReportReviewController";
export function ReportReview(props: ReportReviewProps) {
  const controller = useReportReviewController(props);
  const resolution = controller.report ? (
    <FollowUpResolution
      caseId={controller.caseId}
      reportId={controller.report.id}
      reportRevision={controller.report.revision}
      embedded={controller.embedded}
      disabled={
        Boolean(controller.busy) ||
        controller.accessChecking ||
        controller.accessUnknown ||
        controller.dirty ||
        controller.evidenceBusy ||
        controller.evidenceDirty ||
        controller.exportingPdf
      }
      onSaveReport={controller.downloadCurrentReport}
      onChanged={controller.refreshAfterResolution}
      onDirtyChange={controller.setResolutionDirty}
      onBusyChange={controller.setResolutionBusy}
    />
  ) : null;
  const evidence = (
    <EvidenceUpload
      caseId={controller.caseId}
      disabled={
        Boolean(controller.busy) ||
        controller.exportingPdf ||
        controller.needsConsent ||
        controller.dirty ||
        controller.resolutionBusy ||
        controller.resolutionDirty ||
        controller.accessChecking ||
        controller.accessUnknown
      }
      facts={controller.evidenceFacts}
      onUploaded={controller.evidenceChanged}
      onEvidenceChanged={controller.evidenceChanged}
      onReflect={controller.reflectEvidence}
      onBusyChange={controller.setEvidenceBusy}
      onDirtyChange={controller.setEvidenceDirty}
      onError={controller.reportEvidenceError}
    />
  );
  return (
    <GlobalProductTheme className="contents">
      <ReportReviewView controller={controller} resolution={resolution} evidence={evidence} />
    </GlobalProductTheme>
  );
}
