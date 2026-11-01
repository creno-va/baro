import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { FileView } from "../../src/client/api/types";
import { EvidenceUpload } from "../../src/components/workspace/EvidenceUpload";
import { FileReview } from "../../src/components/workspace/FileReview";

function Fixture() {
  const [version, setVersion] = useState(0);
  const [uploaded, setUploaded] = useState<FileView[]>([]);
  const [disabled, setDisabled] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setDisabled((value) => !value)}>
        합성 읽기 전용 전환
      </button>
      <EvidenceUpload
        caseId="synthetic-case"
        disabled={disabled}
        onUploaded={async (files) => {
          setUploaded(files);
        }}
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
