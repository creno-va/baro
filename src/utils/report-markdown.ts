/** Small, escaped Markdown vocabulary shared by private preview and PDF. No
 * raw HTML, remote images, scripts or user-authored URL attributes are accepted. */
export const escapeReportHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
export type ReportPhoto = { id: string; name: string; url: string };
export type MarkdownBlock =
  | { kind: "paragraph" | "heading" | "quote" | "code"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "photo"; id: string; caption: string };
export function reportMarkdownBlocks(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let code: string[] | null = null;
  for (const line of text.split(/\r?\n/u)) {
    if (/^\s*```/.test(line)) {
      if (code) {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (!line.trim() || /^(?:주의|출처|작성 시각|검증 시각):/u.test(line.trim())) continue;
    const photo = /^!\[([^\]\r\n]{0,200})\]\(baro-photo:([A-Za-z0-9_-]{1,128})\)\s*$/u.exec(
      line.trim(),
    );
    if (photo) {
      blocks.push({ kind: "photo", id: photo[2] ?? "", caption: photo[1] ?? "" });
      continue;
    }
    const list = /^\s*(?:([-+*])|\d+[.)])\s+(.+)$/u.exec(line);
    if (list) {
      const ordered = !list[1];
      const previous = blocks.at(-1);
      if (previous?.kind === "list" && previous.ordered === ordered)
        previous.items.push(list[2] ?? "");
      else blocks.push({ kind: "list", ordered, items: [list[2] ?? ""] });
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/u.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", text: heading[1] ?? "" });
      continue;
    }
    if (/^>\s?/u.test(line)) {
      blocks.push({ kind: "quote", text: line.replace(/^>\s?/u, "") });
      continue;
    }
    blocks.push({ kind: "paragraph", text: line });
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n") });
  return blocks;
}
export function reportPhotoIds(content: string) {
  return [
    ...new Set(
      reportMarkdownBlocks(content).flatMap((block) => (block.kind === "photo" ? [block.id] : [])),
    ),
  ];
}
export const reportPhotoToken = (id: string, caption: string) =>
  `![${caption.replace(/[[\]\r\n]/gu, " ").slice(0, 200)}](baro-photo:${id})`;
function inline(text: string): string {
  // Code is a leaf, so Markdown inside it never becomes markup.
  return text
    .split(/(`[^`\n]+`)/u)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`"))
        return `<code>${escapeReportHtml(part.slice(1, -1))}</code>`;
      return escapeReportHtml(part)
        .replace(/\*\*([^*\n]+)\*\*/gu, "<strong>$1</strong>")
        .replace(/\*([^*\n]+)\*/gu, "<em>$1</em>")
        .replace(/~~([^~\n]+)~~/gu, "<s>$1</s>");
    })
    .join("");
}
export function reportMarkdownHtml(text: string, photos: readonly ReportPhoto[] = []) {
  return reportMarkdownBlocks(text)
    .map((block) => {
      if (block.kind === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${block.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`;
      }
      if (block.kind === "photo") {
        const photo = photos.find((photo) => photo.id === block.id);
        if (
          !photo ||
          !/^(?:\/api\/v2\/reports\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+|data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/u.test(
            photo.url,
          )
        )
          return `<p class="report-photo-placeholder">${escapeReportHtml(block.caption || "사진")}</p>`;
        return `<figure class="report-inline-photo" data-report-photo="${escapeReportHtml(photo.id)}"><img src="${escapeReportHtml(photo.url)}" alt="${escapeReportHtml(block.caption || photo.name)}"/><figcaption>${escapeReportHtml(block.caption || photo.name)}</figcaption></figure>`;
      }
      if (block.kind === "code") return `<pre><code>${escapeReportHtml(block.text)}</code></pre>`;
      const tag = block.kind === "heading" ? "h4" : block.kind === "quote" ? "blockquote" : "p";
      return `<${tag}>${inline(block.text)}</${tag}>`;
    })
    .join("");
}
