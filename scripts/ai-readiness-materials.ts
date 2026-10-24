import { z } from "zod";
import { ModelError } from "../src/server/modules/llm-gateway/service";
import {
  type MaterialWindowRequest,
  materialWindowRequestSchema,
} from "../src/server/modules/workspace/materials";
import type { WorkspaceContext } from "../src/server/modules/workspace/pipeline";
import { syntheticChatContext } from "./ai-readiness-fixture";

/** Pre-extracted synthetic observations. This adapter is not live D1/R2/file processing. */
export function createSyntheticMaterialLookup() {
  const fileId = "synthetic_long_material";
  const all: WorkspaceContext["materials"] = Array.from({ length: 48 }, (_, ordinal) => ({
    reference: {
      kind: "user_material",
      fileId,
      fileRevision: 1,
      position: { kind: "document", page: ordinal + 1, paragraph: 1, table: null },
    },
    text:
      ordinal === 47
        ? "합성 문서 48쪽: 정산 금액은 86,420원이고 확인 코드는 보라등대입니다."
        : `합성 문서 ${ordinal + 1}쪽: 이 페이지에는 정산 금액이나 확인 코드가 기재되지 않았습니다.`,
    coverage: {
      limitedTo: "observation_window",
      ordinal,
      fullCoverageSnapshotId: "synthetic_coverage",
      observationCertainty: "observed",
      userEdited: false,
    },
  }));
  let reads = 0,
    observationsRead = 0,
    lastPageRead = false,
    rounds = 0;
  const context = syntheticChatContext();
  if (!context.latestMessage) throw new Error("Synthetic message unavailable");
  context.latestMessage = {
    ...context.latestMessage,
    selectedFileIds: [fileId],
    text: "첨부한 합성 문서의 마지막 48쪽에 적힌 정산 금액과 확인 코드를 그대로 알려주세요. 처음 16쪽에 없다면 허용된 파일 읽기로 뒤쪽을 확인하고, 읽은 페이지도 출처로 남겨 주세요.",
  };
  context.references = {
    ...context.references,
    files: [{ id: fileId, revision: 1, category: "document", pageCount: 48 }],
  };
  context.materials = structuredClone(all.slice(0, 16));
  context.materialWindows = [
    { fileId, fileRevision: 1, observationCount: 48, startOrdinal: 0, nextOrdinal: 16 },
  ];
  return {
    context,
    async readMaterials(
      current: WorkspaceContext,
      raw: MaterialWindowRequest[],
    ): Promise<WorkspaceContext> {
      const requests = z.array(materialWindowRequestSchema).min(1).max(2).parse(raw);
      if (
        rounds ||
        requests.some((r) => r.fileId !== fileId || r.fileRevision !== 1) ||
        !current.latestMessage?.selectedFileIds.includes(fileId) ||
        !current.references.files.some((f) => f.id === fileId && f.revision === 1)
      )
        throw new ModelError("POLICY_REJECTED");
      rounds++;
      const materials = [...current.materials];
      const windows = [...(current.materialWindows ?? [])];
      const seen = new Set(materials.map((m) => JSON.stringify([m.reference, m.text])));
      for (const request of requests) {
        reads++;
        const selected = structuredClone(
          all.slice(request.startOrdinal, request.startOrdinal + request.count),
        );
        observationsRead += selected.length;
        lastPageRead ||= selected.some(
          (m) => m.reference.position.kind === "document" && m.reference.position.page === 48,
        );
        const { count: _count, ...position } = request;
        windows.push({
          ...position,
          observationCount: 48,
          nextOrdinal:
            request.startOrdinal + selected.length >= 48
              ? null
              : request.startOrdinal + selected.length,
        });
        for (const m of selected) {
          const key = JSON.stringify([m.reference, m.text]);
          if (!seen.has(key)) {
            materials.push(m);
            seen.add(key);
          }
        }
      }
      return { ...current, materials, materialWindows: windows };
    },
    snapshot(output?: { text: string; references: readonly unknown[] }) {
      const text = output?.text.replace(/[\s,]/g, "") ?? "";
      const sourcePositionMatched =
        output?.references.some((ref) => {
          const parsed = z
            .object({
              kind: z.literal("user_material"),
              fileId: z.literal(fileId),
              fileRevision: z.literal(1),
              position: z.object({
                kind: z.literal("document"),
                page: z.literal(48),
                paragraph: z.union([z.literal(1), z.null()]),
                table: z.null(),
              }),
            })
            .safeParse(ref);
          return parsed.success;
        }) ?? false;
      return {
        readRequests: reads,
        observationsRead,
        lastPageRead,
        answerMatched: text.includes("86420") && text.includes("보라등대"),
        sourcePositionMatched,
      };
    },
  };
}
