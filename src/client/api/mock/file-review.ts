import { v2ObservationEditRequestSchema } from "../../../contracts/v2";
import type { FileReviewView } from "../types";
import {
  mockFailure,
  mockResponse,
  requireMockCase,
  WorkspaceMockError,
  type WorkspaceMockRuntime,
} from "./workspace";

export async function handleFileReviewMock(
  runtime: WorkspaceMockRuntime,
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match =
    /^\/api\/v2\/cases\/([^/]+)\/files\/([^/]+)\/(review|observations(?:\/([^/]+)(?:\/(continue))?)?)$/.exec(
      url.pathname,
    );
  if (!match) return null;
  const caseId = decodeURIComponent(match[1] ?? ""),
    fileId = decodeURIComponent(match[2] ?? "");
  try {
    const input =
      request.method === "PATCH"
        ? v2ObservationEditRequestSchema.parse(await request.json())
        : null;
    return runtime.update((state) => {
      const item = requireMockCase(state, caseId, !["GET", "DELETE"].includes(request.method));
      const file = state.files[caseId]?.find((f) => f.id === fileId);
      if (!file) throw new WorkspaceMockError("NOT_FOUND", "자료를 찾을 수 없어요.");
      const store = (state.fileReviews ?? {}) as Record<string, FileReviewView>;
      const current =
        store[fileId] ??
        ({
          file: { id: fileId, revision: 1, name: file.name, status: file.status },
          workspaceRevision: item.revision,
          coverage:
            file.status === "ready"
              ? {
                  category: "document",
                  status: "complete",
                  pageCount: 1,
                  pages: [{ page: 1, status: "processed" }],
                }
              : null,
          observations:
            file.status === "ready"
              ? [
                  {
                    ordinal: 0,
                    value: {
                      id: `observation-${fileId}`,
                      text: file.extractedText || "합성 추출 내용",
                      position: { kind: "document", page: 1, paragraph: null, table: null },
                      certainty: "observed",
                      userEdited: false,
                      included: true,
                    },
                    original: {
                      id: `observation-${fileId}`,
                      text: file.extractedText || "합성 추출 내용",
                      position: { kind: "document", page: 1, paragraph: null, table: null },
                      certainty: "observed",
                      userEdited: false,
                      included: true,
                    },
                  },
                ]
              : [],
          nextAfterOrdinal: null,
          pendingReview: null,
          recovery: null,
        } satisfies FileReviewView);
      current.workspaceRevision = item.revision;
      if (request.method === "GET") return mockResponse(current);
      if (request.method === "PATCH" && input) {
        const key = `review:${state.session.user?.id}:${fileId}:${request.headers.get("idempotency-key")}`;
        const signature = JSON.stringify({ input, revision: request.headers.get("if-match") });
        const receipts = (state.fileReviewReceipts ?? {}) as Record<
          string,
          { signature: string; value: unknown }
        >;
        const old = receipts[key];
        if (old) {
          if (old.signature !== signature)
            throw new WorkspaceMockError("CONFLICT", "같은 요청에 다른 교정 내용이 포함됐어요.");
          return mockResponse(old.value);
        }
        if (
          input.expectedRevision !== current.file.revision ||
          request.headers.get("if-match") !== String(item.revision)
        )
          throw new WorkspaceMockError("CONFLICT", "자료가 바뀌었어요. 최신 내용을 확인해 주세요.");
        if (
          input.edits.some(
            (edit) => !current.observations.some((o) => o.value.id === edit.observationId),
          )
        )
          throw new WorkspaceMockError("VALIDATION_ERROR", "수정할 내용을 찾을 수 없어요.");
        current.observations = current.observations.map((o) => {
          const edit = input.edits.find((e) => e.observationId === o.value.id);
          return edit
            ? {
                ...o,
                value: {
                  ...o.value,
                  text: edit.text,
                  included: edit.included,
                  userEdited: true,
                  certainty: "uncertain",
                },
              }
            : o;
        });
        current.file.revision++;
        item.revision++;
        current.workspaceRevision = item.revision;
        store[fileId] = current;
        state.fileReviews = store;
        file.extractedText = current.observations
          .filter((o) => o.value.included)
          .map((o) => o.value.text)
          .join("\n");
        if (state.reports?.[caseId]) state.reports[caseId].stale = true;
        const value = {
          reviewId: crypto.randomUUID(),
          fileId,
          revision: current.file.revision,
          workspaceRevision: item.revision,
          status: "ready",
          completed: 1,
          total: 1,
        };
        receipts[key] = { signature, value };
        state.fileReviewReceipts = receipts;
        return mockResponse(value);
      }
      throw new WorkspaceMockError("NOT_FOUND", "진행 중인 교정을 찾을 수 없어요.");
    });
  } catch (cause) {
    return mockFailure(cause);
  }
}
