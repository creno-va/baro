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
    /【[^】\n]{1,100}】|^[ \t]*(?:\[(?:판시사항|판결요지|참조조문|참조판례|전문|주\s*문|이\s*유|원고|피고|신청인|피신청인|채권자|채무자|상고인|피상고인|항소인|피항소인|재항고인|상대방|참가인|보조참가인|원심판결|원심결정)[^\]\n]{0,80}\]|판시사항|판결요지|참조조문|참조판례|전문|주\s*문|이\s*유)[ \t]*$/gmu;
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

/** Display-only edge whitespace removal. Every visible span keeps its exact
 * UTF-16 coordinates in the untouched original, including comparison highlights. */
export function precedentDisplayParts(text: string): PrecedentTextPart[] {
  return precedentDocumentParts(text).flatMap((part) => {
    const visible = part.text.trim();
    if (!visible) return [];
    const start = part.start + part.text.length - part.text.trimStart().length;
    return [{ ...part, text: visible, start, end: start + visible.length }];
  });
}
