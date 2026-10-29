import type { FileView, TimelineView } from "../../client/api/types";
import type { V2Fact, V2FactReference } from "../../contracts/v2";

const states = {
  observed: {
    label: "자료에서 확인",
    tone: "success",
    description: "연결된 자료에서 관찰된 내용이에요.",
  },
  material: {
    label: "자료 근거 있음",
    tone: "primary",
    description: "사건 내용과 연결된 자료가 있어요. 원문의 해당 부분을 확인할 수 있어요.",
  },
  reported: {
    label: "사용자 진술",
    tone: "neutral",
    description: "이야기나 대화로 제공한 내용이며, 연결된 자료 근거는 아직 없어요.",
  },
  edited: {
    label: "사용자 수정",
    tone: "neutral",
    description: "직접 작성하거나 수정한 내용이에요. 연결 자료와의 일치는 다시 확인해 주세요.",
  },
  uncertain: {
    label: "추가 확인 필요",
    tone: "warning",
    description: "불확실하거나 수정된 사실이 연결돼 있어 추가 확인이 필요해요.",
  },
  conflicting: {
    label: "내용 상충",
    tone: "danger",
    description: "서로 다른 내용이 연결돼 있어 자료와 진술을 대조해야 해요.",
  },
  stale: {
    label: "근거 재확인",
    tone: "warning",
    description: "연결 자료가 변경됐거나 현재 확인할 수 없어 다시 확인해야 해요.",
  },
  unknown: {
    label: "출처 확인 필요",
    tone: "warning",
    description: "이 항목의 근거 정보를 아직 확인할 수 없어요.",
  },
} as const;

/** A material link supports the stated source scope, never a blanket finding of truth. */
export function timelineEvidence(
  entry: TimelineView,
  files: readonly FileView[],
  facts: readonly V2Fact[] = [],
) {
  const linkedFacts = facts.filter((fact) => entry.factIds?.includes(fact.id));
  const references = [
    ...(entry.references ?? []),
    ...linkedFacts.flatMap((fact) => fact.references),
  ];
  const seen = new Set<string>();
  const materials = references
    .filter(
      (ref): ref is Extract<V2FactReference, { kind: "user_material" }> =>
        ref.kind === "user_material",
    )
    .flatMap((reference) => {
      const key = JSON.stringify(reference);
      if (seen.has(key)) return [];
      seen.add(key);
      const file = files.find((file) => file.id === reference.fileId);
      const current = file?.status === "ready" && file.revision === reference.fileRevision;
      return [{ reference, file, current }];
    });
  const hasMaterials = materials.some((material) => material.current);
  const kind =
    entry.certainty === "conflicting" ||
    linkedFacts.some((f) => f.certainty === "conflicting" || f.conflictingFactIds.length > 0)
      ? "conflicting"
      : entry.certainty === "uncertain" ||
          linkedFacts.some((f) => f.certainty === "uncertain" || f.userEdited)
        ? "uncertain"
        : entry.userEdited
          ? "edited"
          : materials.some((material) => !material.current)
            ? "stale"
            : hasMaterials
              ? entry.certainty === "observed"
                ? "observed"
                : "material"
              : entry.certainty === "reported" ||
                  references.some((ref) =>
                    ["intake_narrative", "intake_answer", "user_message"].includes(ref.kind),
                  )
                ? "reported"
                : "unknown";
  return { kind, ...states[kind], materials, hasMaterials };
}
