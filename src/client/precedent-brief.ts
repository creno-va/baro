/** An extract from the verified judgment, never a generated legal conclusion. */
export function precedentBrief(text: string): string {
  const paragraphs = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = paragraphs.findIndex((line) =>
    /^(?:\[|【)?(?:판결요지|판시사항|이유)(?:\]|】|:)?$/.test(line),
  );
  const candidates = heading >= 0 ? paragraphs.slice(heading + 1) : paragraphs;
  const source =
    candidates.find(
      (line) => line.length >= 20 && !/^(?:사건번호|선고일자|법원명|참조조문|참조판례)/.test(line),
    ) ??
    paragraphs[0] ??
    "";
  const clean = source.replace(/\s+/g, " ");
  return [...clean].length > 240 ? `${[...clean].slice(0, 240).join("")}…` : clean;
}
