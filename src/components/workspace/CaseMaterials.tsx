import type { FileView } from "../../client/api/types";
import type { V2Fact } from "../../contracts/v2";

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
        추출·교정한 내용은 자료 확인에서 검토할 수 있어요. 새 자료는 처리가 끝나면 자동으로
        반영하며, 내용을 고친 뒤 다시 반영할 수도 있어요. 관련 사실을 함께 정리해요. 저장한 요약
        본문은 직접 수정할 수 있어요.
      </p>
      <ul>
        {files.map((file) => {
          const references = facts
            .flatMap((fact) => fact.references)
            .filter((ref) => ref.kind === "user_material" && ref.fileId === file.id);
          const linked = references.some(
            (ref) => ref.kind === "user_material" && ref.fileRevision === file.revision,
          );
          const status =
            file.status === "ready"
              ? linked
                ? "반영 완료 · 사실에 연결된 자료"
                : references.length
                  ? "자료 변경 · 다시 반영 필요"
                  : "내용 확인 후 반영 가능"
              : file.status === "failed"
                ? "처리 결과 확인 필요"
                : "자료 처리 중";
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
