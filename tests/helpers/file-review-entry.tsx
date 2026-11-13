import { ActionButton as ControlButton } from "../../src/components/ui/button";
import "./headless-experience";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FileReview } from "../../src/components/workspace/FileReview";

const changed = async () => {};
const report = () => {};
function Fixture() {
  const [file, setFile] = useState("synthetic-file-a");
  return (
    <>
      <ControlButton type="button" onClick={() => setFile("synthetic-file-b")}>
        합성 두 번째 자료 열기
      </ControlButton>
      <FileReview
        key={file}
        caseId="synthetic-case"
        fileId={file}
        canEdit
        onChanged={changed}
        onError={report}
      />
    </>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
