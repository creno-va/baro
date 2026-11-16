import { FileText } from "lucide-react";
import type { FileView } from "../../client/api/types";
import { materialState, materialStateLabels } from "../../components/workspace/evidence-state";
import type { V2Fact } from "../../contracts/v2";

export function SummaryMaterials({
  caseId,
  files,
  facts = [],
}: {
  caseId: string;
  files: FileView[];
  facts?: V2Fact[] | undefined;
}) {
  if (!files.length) return null;
  return (
    <section aria-label="추가한 자료" className="space-y-3">
      <h2 className="text-sm font-medium text-[var(--pui-text)]">
        추가한 자료 <span className="ml-1 text-[var(--pui-muted)]">{files.length}</span>
      </h2>
      <p className="text-xs leading-6 text-[var(--pui-muted)]">
        추출·교정한 내용은 자료 확인에서 검토할 수 있어요. ‘자료 내용 반영하기’로 대화에 보내면 관련
        사실을 함께 정리해요. 다르거나 빠진 내용은 사건 정리 재확인에서 알려주세요. 변경안을 확인한
        뒤 반영해요.
      </p>
      <ul className="divide-y divide-[var(--pui-border)]">
        {files.map((file) => (
          <li key={file.id} className="py-3">
            <a
              className="flex min-h-11 items-center gap-2 text-sm text-[var(--pui-text)] underline-offset-4 hover:underline"
              href={`/cases/${encodeURIComponent(caseId)}/files?file=${encodeURIComponent(file.id)}`}
            >
              <FileText size={16} className="shrink-0 text-[var(--pui-muted)]" aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{file.name}</span>
            </a>
            <p className="pl-6 text-xs leading-5 text-[var(--pui-muted)]">
              {materialStateLabels[materialState(file, facts)]}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
