/** Escaped vocabulary shared by preview and PDF. Owned photos and bounded
 * official-source navigation only; no raw HTML, scripts or remote resources. */
export const escapeReportHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
export type ReportPhoto = { id: string; name: string; url: string };
export const isReportSourceSection = (title: string) =>
  title === "출처와 분석 기준" || title === "공식 출처";

/** Navigation only: this never establishes citation verification or fetches a
 * resource. Preserve the original spelling after rejecting URL normalization,
 * credentials, redirects and every parameter outside the canonical source IDs. */
export function reportOfficialSourceUrl(line: string): string | undefined {
  const match = /^공식 원문 · (https:\/\/[A-Za-z0-9./?=&_-]+)$/u.exec(line);
  const raw = match?.[1];
  if (!raw || match?.[0] !== line) return;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  const keys =
    url.origin === "https://law.go.kr" && url.pathname === "/LSW/lsInfoP.do"
      ? ["lsiSeq"]
      : url.origin === "https://www.law.go.kr" && url.pathname === "/LSW/precInfoP.do"
        ? ["precSeq"]
        : url.origin === "https://www.easylaw.go.kr" && url.pathname === "/CSP/CnpClsMain.laf"
          ? ["csmSeq", "ccfNo", "cciNo", "cnpClsNo"]
          : [];
  // Checking the literal query as well as URL components prevents percent,
  // dot-segment, default-port and delimiter normalization from admitting input.
  const originAndPath = `${url.origin}${url.pathname}`;
  if (!keys.length || !raw.startsWith(`${originAndPath}?`)) return;
  const pairs = raw.slice(originAndPath.length + 1).split("&");
  if (
    pairs.length !== keys.length ||
    pairs.some((pair) => !/^[A-Za-z]+=[0-9]{1,12}$/u.test(pair)) ||
    keys.some((key) => url.searchParams.getAll(key).length !== 1) ||
    [...url.searchParams.keys()].some((key) => !keys.includes(key))
  )
    return;
  return raw;
}
export type MarkdownBlock =
  | { kind: "paragraph" | "heading" | "quote" | "source_quote" | "code"; text: string }
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
    if (/^> \[원문\] /u.test(line)) {
      blocks.push({ kind: "source_quote", text: line.slice(7) });
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
export function reportMarkdownHtml(
  text: string,
  photos: readonly ReportPhoto[] = [],
  sourceSection = false,
) {
  const sourceOrInline = (value: string) => {
    const url = sourceSection ? reportOfficialSourceUrl(value) : undefined;
    return url
      ? `공식 원문 · <a class="report-official-source" href="${escapeReportHtml(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${escapeReportHtml(url)}</a>`
      : inline(value);
  };
  return reportMarkdownBlocks(text)
    .map((block) => {
      if (block.kind === "list") {
        const tag = block.ordered ? "ol" : "ul";
        return `<${tag}>${block.items.map((item) => `<li>${sourceOrInline(item)}</li>`).join("")}</${tag}>`;
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
      if (block.kind === "source_quote")
        return `<blockquote class="report-source-quote">${escapeReportHtml(block.text)}</blockquote>`;
      const tag = block.kind === "heading" ? "h4" : block.kind === "quote" ? "blockquote" : "p";
      return `<${tag}>${block.kind === "paragraph" ? sourceOrInline(block.text) : inline(block.text)}</${tag}>`;
    })
    .join("");
}
