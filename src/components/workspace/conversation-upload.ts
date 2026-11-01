import type { CaseView, FileView, WorkspaceView } from "../../client/api/types";
import { type V2ConversationState, v2HashSchema } from "../../contracts/v2";

export function uploadCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(uploadCanonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${uploadCanonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function source(view: WorkspaceView, item: CaseView, state: V2ConversationState, ids: string[]) {
  const { revision: _revision, updatedAt: _updatedAt, ...confirmed } = item;
  return uploadCanonical({
    confirmed,
    context: state.caseContext,
    messages: view.messages,
    actions: view.actions,
    timeline: view.timeline,
    facts: view.facts,
    people: view.people,
    unknowns: view.unknowns,
    files: view.files.filter((f) => !ids.includes(f.id)).sort((a, b) => a.id.localeCompare(b.id)),
  });
}
export type ConversationUpload = {
  caseId: string;
  epoch: number;
  text: string;
  ids: string[];
  files: Map<string, FileView>;
  baseline: string;
};
/** A first admission only; pagination is never treated as a complete history. */
export function beginConversationUpload(
  view: WorkspaceView,
  item: CaseView,
  state: V2ConversationState,
  epoch: number,
  text: string,
  ids: string[],
): ConversationUpload | null {
  if (
    !item.summaryDetails ||
    Object.values(view.pagination ?? {}).some(Boolean) ||
    view.case.revision !== item.revision ||
    item.revision !== state.workspaceRevision ||
    item.id !== view.case.id ||
    !state.summaryConfirmed
  )
    return null;
  return {
    caseId: item.id,
    epoch,
    text,
    ids: [...ids],
    files: new Map(
      ids.flatMap((id) => {
        const f = view.files.find((f) => f.id === id);
        return f ? [[id, { ...f }] as const] : [];
      }),
    ),
    baseline: source(view, item, state, ids),
  };
}
export function queuedConversationUpload(
  queue: ConversationUpload,
  view: WorkspaceView,
  item: CaseView,
  state: V2ConversationState,
  epoch: number,
  text: string,
  ids: string[],
  processed: ReadonlySet<string>,
  attempted: boolean,
): "changed" | "waiting" | "ready" {
  if (
    attempted ||
    queue.epoch !== epoch ||
    queue.caseId !== view.case.id ||
    item.id !== queue.caseId ||
    queue.text !== text ||
    uploadCanonical(queue.ids) !== uploadCanonical(ids) ||
    Object.values(view.pagination ?? {}).some(Boolean) ||
    view.case.revision !== item.revision ||
    item.revision !== state.workspaceRevision ||
    !state.summaryConfirmed ||
    queue.baseline !== source(view, item, state, ids)
  )
    return "changed";
  for (const id of ids) {
    const original = queue.files.get(id),
      file = view.files.find((f) => f.id === id);
    if (
      !original ||
      !file ||
      !original.uploadContentHash ||
      !v2HashSchema.safeParse(original.uploadContentHash).success ||
      !Number.isSafeInteger(original.revision) ||
      !Number.isSafeInteger(file.revision) ||
      original.uploadContentHash !== file.uploadContentHash ||
      original.name !== file.name ||
      original.sizeBytes !== file.sizeBytes ||
      original.mimeType !== file.mimeType ||
      file.status !== "ready" ||
      file.uploadRejection ||
      (original.status === "ready" ? original.revision !== file.revision : !processed.has(id))
    )
      return "changed";
  }
  return ["pending", "running"].includes(state.analysis.status) || state.report.status === "pending"
    ? "waiting"
    : "ready";
}
