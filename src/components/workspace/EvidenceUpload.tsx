import { EvidenceUploadView } from "../../product-ui/evidence/EvidenceUploadView";
import {
  type EvidenceUploadProps,
  useEvidenceUploadController,
} from "../../product-ui/evidence/useEvidenceUploadController";
import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { ChatAttachments } from "./ChatAttachments";
import { EvidencePicker } from "./EvidencePicker";
import { FileReview } from "./FileReview";

export type { EvidenceUploadProps } from "../../product-ui/evidence/useEvidenceUploadController";

/** Case changes discard local handles, never the server's pending work. */
export function EvidenceUpload(props: EvidenceUploadProps) {
  return <EvidenceUploadEditor key={props.caseId} {...props} />;
}
function EvidenceUploadEditor(props: EvidenceUploadProps) {
  const c = useEvidenceUploadController(props);
  return (
    <GlobalProductTheme className="contents">
      <EvidenceUploadView
        controller={c}
        picker={
          <EvidencePicker
            scopeKey={c.upload.scopeKey}
            disabled={!c.upload.writable || c.busy}
            photoOnly={c.photoOnly}
            onSelect={c.upload.select}
            onError={c.upload.report}
          />
        }
        attachments={
          <ChatAttachments
            local={c.upload.local}
            uploaded={[]}
            disabled={c.busy}
            removeLocal={c.upload.remove}
            removeUploaded={() => {}}
          />
        }
        review={
          c.reviewFile ? (
            <FileReview
              key={`${c.upload.scopeKey}:${c.reviewFile.id}`}
              caseId={c.caseId}
              fileId={c.reviewFile.id}
              canEdit={!c.disabled && !c.upload.busy && !c.reflectBusy}
              onChanged={c.changed}
              onError={c.upload.report}
              onDirtyChange={c.setReviewDirty}
              onBusyChange={c.setReviewBusy}
              refreshVersion={String(c.reviewFile.revision ?? "")}
            />
          ) : null
        }
      />
    </GlobalProductTheme>
  );
}
