export type PrecedentTextPart = {
  kind: "heading" | "text";
  text: string;
  start: number;
  end: number;
};
/** Restore the judgment's textual hierarchy without changing verified offsets or accepting HTML. */
export function precedentDocumentParts(text: string): PrecedentTextPart[] {
  const parts: PrecedentTextPart[] = [];
  let start = 0;
  const headings =
    /【[^】\n]{1,100}】|^[ \t]*(?:\[(?:판시사항|판결요지|참조조문|참조판례|전문|주\s*문|이\s*유)\]|판시사항|판결요지|참조조문|참조판례|전문|주\s*문|이\s*유)[ \t]*$/gmu;
  for (const match of text.matchAll(headings)) {
    if (match.index > start)
      parts.push({ kind: "text", text: text.slice(start, match.index), start, end: match.index });
    parts.push({
      kind: "heading",
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
    start = match.index + match[0].length;
  }
  if (start < text.length)
    parts.push({ kind: "text", text: text.slice(start), start, end: text.length });
  return parts;
}
