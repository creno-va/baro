import type { FileView } from "../../client/api/types";
import type { V2EvidenceRequirement, V2Fact } from "../../contracts/v2";
import { Button } from "../ui/button";
import { evidenceRequirementStates, materialStateLabels } from "./evidence-state";
import "../../styles/evidence.css";

export function EvidenceRequirements({
  requirements,
  files,
  facts = [],
  pendingFileIdsByRequirement = {},
  disabled = false,
  onAdd,
  onReview,
}: {
  requirements: V2EvidenceRequirement[];
  files: FileView[];
  facts?: V2Fact[];
  pendingFileIdsByRequirement?: Record<string, string[]>;
  disabled?: boolean;
  onAdd: (requirement: V2EvidenceRequirement) => void;
  onReview?: (fileId: string) => void;
}) {
  if (!requirements.length) return null;
  return (
    <section className="evidence-requirements" aria-label="확인할 증거 자료">
      <h3>보완할 자료</h3>
      <ul>
        {evidenceRequirementStates(requirements, files, facts, pendingFileIdsByRequirement).map(
          ({ requirement, files: associated, status, canRequest }) => (
            <li key={requirement.id}>
              <strong>{requirement.label}</strong>
              <p>{requirement.reason}</p>
              <span className="evidence-hint">
                {status === "missing" ? "아직 추가한 자료가 없어요" : materialStateLabels[status]}
              </span>
              {canRequest && (
                <Button variant="outline" disabled={disabled} onClick={() => onAdd(requirement)}>
                  {status === "missing" ? "자료 추가" : "수정한 자료 선택"}
                </Button>
              )}
              {associated.map((file) => (
                <div className="evidence-requirement-file" key={file.id}>
                  <span>{file.name}</span>
                  {onReview && file.status === "ready" && (
                    <Button variant="ghost" disabled={disabled} onClick={() => onReview(file.id)}>
                      내용 확인
                    </Button>
                  )}
                </div>
              ))}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
