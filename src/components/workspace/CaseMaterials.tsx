import type { FileView } from "../../client/api/types";
import type { V2Fact } from "../../contracts/v2";
import { materialState, materialStateLabels } from "./evidence-state";
import "../../styles/evidence.css";

export function CaseMaterials({
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
    <section className="case-materials" aria-label="추가한 자료">
      <h2>
        추가한 자료 <span>{files.length}</span>
      </h2>
      <p>
        추출·교정한 내용은 자료 확인에서 검토할 수 있어요. ‘자료 내용 반영하기’로 대화에 보내면 관련
        사실을 함께 정리해요. 다르거나 빠진 내용은 사건 정리 재확인에서 알려주세요. 변경안을 확인한
        뒤 반영해요.
      </p>
      <ul>
        {files.map((file) => {
          const status = materialStateLabels[materialState(file, facts)];
          return (
            <li key={file.id}>
              <a
                href={`/cases/${encodeURIComponent(caseId)}/files?file=${encodeURIComponent(file.id)}`}
              >
                {file.name}
              </a>
              <span>{status}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
