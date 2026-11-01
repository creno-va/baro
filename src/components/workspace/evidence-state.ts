import type { FileView } from "../../client/api/types";
import type { V2EvidenceRequirement, V2Fact, V2FileObservation } from "../../contracts/v2";

export type MaterialState =
  | "uploading"
  | "waiting"
  | "processing"
  | "rejected"
  | "failed"
  | "review"
  | "linked"
  | "stale";
export const materialStateLabels: Record<MaterialState, string> = {
  uploading: "업로드 중",
  waiting: "처리 대기",
  processing: "분석 중",
  rejected: "등록 거절",
  failed: "처리 실패 · 확인 필요",
  review: "내용 확인 후 반영 가능",
  linked: "현재 자료가 사실에 연결됨",
  stale: "자료 변경 · 다시 반영 필요",
};

/** A successful upload or interpretation alone never means the case used the evidence. */
export function materialState(file: FileView, facts: readonly V2Fact[] = []): MaterialState {
  if (file.uploadRejection) return "rejected";
  if (file.status !== "ready") return file.status;
  if (file.revision === undefined) return "review";
  const references = facts
    .flatMap((fact) => fact.references)
    .filter((ref) => ref.kind === "user_material" && ref.fileId === file.id);
  if (references.some((ref) => ref.kind === "user_material" && ref.fileRevision === file.revision))
    return "linked";
  return references.length ? "stale" : "review";
}

export function observationKind(value: V2FileObservation) {
  if (value.userEdited) return "edited";
  if (value.text.startsWith("[문서 기재]")) return "stated";
  if (value.text.startsWith("[보이는 상태]")) return "visible";
  if (value.text.startsWith("[확인 필요]") || value.certainty === "uncertain") return "uncertain";
  return "extracted";
}
export const observationKindLabels = {
  stated: "사진 속 기재 내용",
  visible: "화면에서 관찰한 내용",
  uncertain: "불확실한 해석·확인 필요",
  edited: "사용자 교정 · 확인 필요",
  extracted: "자료에서 추출한 내용",
};

/** Associations come from the server/contextual user action, never a filename guess. */
export function evidenceRequirementStates(
  requirements: readonly V2EvidenceRequirement[],
  files: readonly FileView[],
  facts: readonly V2Fact[] = [],
  pendingFileIdsByRequirement: Readonly<Record<string, readonly string[]>> = {},
) {
  const priority: MaterialState[] = [
    "rejected",
    "failed",
    "uploading",
    "waiting",
    "processing",
    "stale",
    "review",
    "linked",
  ];
  return requirements.map((requirement) => {
    const ids = new Set([
      ...requirement.fileIds,
      ...(pendingFileIdsByRequirement[requirement.id] ?? []),
    ]);
    const associated = files.filter((file) => ids.has(file.id));
    const states = associated.map((file) => materialState(file, facts));
    const status: MaterialState | "missing" =
      priority.find((candidate) => states.includes(candidate)) ?? "missing";
    return {
      requirement,
      files: associated,
      status,
      canRequest: status === "missing" || status === "rejected" || status === "failed",
    };
  });
}
