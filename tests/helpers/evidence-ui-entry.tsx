import { ActionButton as ControlButton } from "../../src/components/ui/button";
import "./headless-experience";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { FileView } from "../../src/client/api/types";
import { CaseMaterials } from "../../src/components/workspace/CaseMaterials";
import { EvidenceUpload } from "../../src/components/workspace/EvidenceUpload";
import { FileReview } from "../../src/components/workspace/FileReview";

function Fixture() {
  const [version, setVersion] = useState(0);
  const [uploaded, setUploaded] = useState<FileView[]>([]);
  const [disabled, setDisabled] = useState(false);
  const [dirty, setDirty] = useState(false),
    [selectedReview, setSelectedReview] = useState("");
  const [visible, setVisible] = useState(true);
  return (
    <>
      <ControlButton type="button" onClick={() => setDisabled((value) => !value)}>
        합성 읽기 전용 전환
      </ControlButton>
      <ControlButton type="button" onClick={() => setVisible((value) => !value)}>
        합성 업로드 패널 전환
      </ControlButton>
      {visible && (
        <EvidenceUpload
          caseId="synthetic-case"
          disabled={disabled}
          onDirtyChange={setDirty}
          onUploaded={async (files) => {
            setUploaded(files);
          }}
        />
      )}
      <p data-testid="upload-dirty">{String(dirty)}</p>
      <p data-testid="inline-file">{selectedReview}</p>
      <CaseMaterials
        caseId="synthetic-case"
        files={[
          {
            id: "synthetic-inline",
            revision: 1,
            name: "합성 인라인 자료",
            mimeType: "text/plain",
            sizeBytes: 1,
            status: "ready",
            coverage: "",
            extractedText: "",
          },
        ]}
        onReviewFile={setSelectedReview}
      />
      <p data-testid="received">{uploaded.map((file) => file.id).join(",")}</p>
      <p data-testid="changed">{version}</p>
      <FileReview
        caseId="synthetic-case"
        fileId="synthetic-photo"
        canEdit
        onChanged={async () => setVersion((value) => value + 1)}
        onError={() => {}}
      />
    </>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
