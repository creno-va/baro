import { FolderPlus } from "lucide-react";
import type { FileView } from "../../client/api/types";
import {
  evidenceRequirementStates,
  materialStateLabels,
} from "../../components/workspace/evidence-state";
import type { V2EvidenceRequirement, V2Fact } from "../../contracts/v2";
import { Button } from "../Button";

export function EvidenceRequirementsView({
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
    <section
      data-product-evidence-requirements=""
      aria-label="확인할 증거 자료"
      className="min-w-0 space-y-3 text-sm leading-6 text-[var(--pui-text)]"
    >
      <h3 className="flex items-center gap-2 text-base font-semibold">
        <FolderPlus size={18} aria-hidden="true" />
        보완할 자료
      </h3>
      <ul className="m-0 grid list-none gap-3 p-0">
        {evidenceRequirementStates(requirements, files, facts, pendingFileIdsByRequirement).map(
          ({ requirement, files: associated, status, canRequest }) => (
            <li
              key={requirement.id}
              className="min-w-0 space-y-2 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-4 [overflow-wrap:anywhere]"
            >
              <strong className="font-medium">{requirement.label}</strong>
              <p className="text-xs text-[var(--pui-muted)]">{requirement.reason}</p>
              <span className="block text-xs text-[var(--pui-muted)]">
                {status === "missing" ? "아직 추가한 자료가 없어요" : materialStateLabels[status]}
              </span>
              {canRequest && (
                <Button variant="secondary" disabled={disabled} onClick={() => onAdd(requirement)}>
                  {status === "missing" ? "자료 추가" : "수정한 자료 선택"}
                </Button>
              )}
              {associated.map((file) => (
                <div
                  data-product-evidence-requirement-file=""
                  key={file.id}
                  className="flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--pui-border)] pt-2"
                >
                  <span className="min-w-0 flex-1 basis-32 text-xs">{file.name}</span>
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
