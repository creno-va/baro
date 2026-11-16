import { FileText, FolderOpen } from "lucide-react";
import type { FileView } from "../../client/api/types";
import { materialState, materialStateLabels } from "../../components/workspace/evidence-state";
import type { V2Fact } from "../../contracts/v2";
import { Button, ButtonLink } from "../Button";

export function CaseMaterialsView({
  caseId,
  files,
  facts = [],
  onReviewFile,
}: {
  caseId: string;
  files: FileView[];
  facts?: V2Fact[] | undefined;
  /** Open the same private review inside a conversation panel when supplied. */
  onReviewFile?: (fileId: string) => void;
}) {
  if (!files.length) return null;
  return (
    <section
      data-product-case-materials=""
      aria-label="추가한 자료"
      className="min-w-0 space-y-3 text-sm leading-6 text-[var(--pui-text)]"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <FolderOpen size={18} aria-hidden="true" />
        추가한 자료{" "}
        <span className="rounded-md bg-[var(--pui-background)] px-2 text-xs font-medium text-[var(--pui-muted)]">
          {files.length}
        </span>
      </h2>
      <p className="text-xs leading-6 text-[var(--pui-muted)]">
        추출·교정한 내용은 자료 확인에서 검토할 수 있어요. ‘자료 내용 반영하기’로 대화에 보내면 관련
        사실을 함께 정리해요. 다르거나 빠진 내용은 사건 정리 재확인에서 알려주세요. 변경안을 확인한
        뒤 반영해요.
      </p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {files.map((file) => {
          const status = materialStateLabels[materialState(file, facts)];
          return (
            <li
              key={file.id}
              className="flex min-w-0 items-start gap-2 rounded-xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-3"
            >
              <FileText
                size={18}
                className="mt-3 shrink-0 text-[var(--pui-muted)]"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                {onReviewFile ? (
                  <Button
                    variant="ghost"
                    data-product-evidence-material-open=""
                    className="h-auto max-w-full justify-start whitespace-normal px-1 text-left [overflow-wrap:anywhere]"
                    onClick={(event) => {
                      event.currentTarget.focus();
                      onReviewFile(file.id);
                    }}
                  >
                    {file.name}
                  </Button>
                ) : (
                  <ButtonLink
                    variant="ghost"
                    data-product-evidence-material-open=""
                    className="h-auto max-w-full justify-start whitespace-normal px-1 text-left [overflow-wrap:anywhere]"
                    href={`/cases/${encodeURIComponent(caseId)}/files?file=${encodeURIComponent(file.id)}`}
                  >
                    {file.name}
                  </ButtonLink>
                )}
                <span className="block px-1 text-xs text-[var(--pui-muted)]">{status}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
