import type { ReportDocument } from "../../../components/reports/document";
import type { V2ReportBody } from "../../../contracts/v2";
import type { Actor, V2Core } from "../../db/v2-core";
import { createV2FilesRepository } from "../../db/v2-files";
import { digest } from "../files/binary";
import type { FilesService } from "../files/service";
import { ReportError, reportFile } from "./source";

export const MAX_REPORT_PHOTOS = 12;
export const MAX_REPORT_PHOTO_BYTES = 5_000_000;
export const MAX_REPORT_PHOTOS_BYTES = 8_000_000;
const imageTypes = new Set(["jpeg", "png", "webp"]);
export type PhotoCandidate = { id: string; name: string; revision: number };
export async function photoCandidates(core: V2Core, actor: Actor, body: V2ReportBody) {
  const candidates: PhotoCandidate[] = [];
  const imageRows = body.selectedFiles.length
    ? await core
        .statement(
          "SELECT f.id FROM v2_files f JOIN v2_workspaces w ON w.id=f.workspace_id WHERE w.owner_id=? AND f.state='ready' AND f.probe_kind='image' AND f.id IN (SELECT value FROM json_each(?))",
          [actor.ownerId, JSON.stringify(body.selectedFiles.map((file) => file.id))],
        )
        .all<{ id: string }>()
    : { results: [] };
  for (const selected of body.selectedFiles.filter((file) =>
    imageRows.results.some((row) => row.id === file.id),
  )) {
    const file = await createV2FilesRepository(core).metadata(actor, selected.id);
    if (!file || file.revision !== selected.revision) throw new ReportError("STALE_REVISION");
    if (
      file.probe?.category === "image" &&
      imageTypes.has(file.probe.format) &&
      selected.byteLength <= MAX_REPORT_PHOTO_BYTES
    )
      candidates.push({ id: file.id, name: file.name, revision: file.revision });
  }
  return candidates;
}
export async function validatePhotos(
  core: V2Core,
  actor: Actor,
  body: V2ReportBody,
  ids: readonly string[],
  excluded: readonly string[],
) {
  if (
    ids.length > MAX_REPORT_PHOTOS ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => excluded.includes(id))
  )
    throw new ReportError("VALIDATION_ERROR");
  if (!ids.length) return [];
  const candidates = await photoCandidates(core, actor, {
    ...body,
    selectedFiles: body.selectedFiles.filter((file) => ids.includes(file.id)),
  });
  if (ids.some((id) => !candidates.some((photo) => photo.id === id)))
    throw new ReportError("VALIDATION_ERROR");
  const bytes = body.selectedFiles
    .filter((file) => ids.includes(file.id))
    .reduce((sum, file) => sum + file.byteLength, 0);
  if (bytes > MAX_REPORT_PHOTOS_BYTES) throw new ReportError("EXPORT_LIMIT_EXCEEDED");
  return candidates;
}
function dataUrl(bytes: Uint8Array, mime: string) {
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime};base64,${btoa(raw)}`;
}
/** Only authenticated, revision/hash-bound originals. Never caller URLs or public R2. */
export async function loadReportPhotos(
  core: V2Core,
  actor: Actor,
  workspaceId: string,
  body: V2ReportBody,
  ids: readonly string[],
  excluded: readonly string[],
  files: FilesService,
  authorize: () => Promise<void>,
): Promise<NonNullable<ReportDocument["photos"]>> {
  await validatePhotos(core, actor, body, ids, excluded);
  const photos: NonNullable<ReportDocument["photos"]> = [];
  for (const id of ids) {
    await authorize();
    const selected = body.selectedFiles.find((file) => file.id === id);
    const file = await reportFile(core, actor, id);
    if (
      !selected ||
      file?.probe?.category !== "image" ||
      !imageTypes.has(file.probe.format) ||
      selected.revision !== file.revision
    )
      throw new ReportError("STALE_REVISION");
    const original = await files.content(actor.ownerId, workspaceId, id);
    if (original.byteLength !== selected.byteLength || original.name !== selected.name) {
      await original.body.cancel();
      throw new ReportError("STALE_REVISION");
    }
    const reader = original.body.getReader();
    const bytes = new Uint8Array(selected.byteLength);
    let offset = 0;
    try {
      for (;;) {
        await authorize();
        const item = await reader.read();
        if (item.done) break;
        if (offset + item.value.length > bytes.length) throw new ReportError("STORAGE_UNAVAILABLE");
        bytes.set(item.value, offset);
        offset += item.value.length;
      }
      await authorize();
      if (offset !== bytes.length || (await digest(bytes)) !== selected.contentHash)
        throw new ReportError("STORAGE_UNAVAILABLE");
      photos.push({
        id,
        name: selected.name,
        revision: selected.revision,
        dataUrl: dataUrl(bytes, `image/${file.probe.format}`),
        notes: body.facts
          .filter((fact) =>
            fact.references.some(
              (ref) =>
                ref.kind === "user_material" &&
                ref.fileId === id &&
                ref.fileRevision === selected.revision,
            ),
          )
          .map(
            (fact) =>
              `${fact.certainty === "uncertain" || fact.certainty === "conflicting" || fact.userEdited ? "확인 필요: " : "자료 내용: "}${fact.text}`,
          ),
      });
    } finally {
      bytes.fill(0);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  await authorize();
  return photos;
}
