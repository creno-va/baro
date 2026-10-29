/** Recover only source whitespace, never paraphrases, changed digits or joined observations. */
export function exactMaterialQuote(text: string, sources: readonly string[]): string | null {
  if (sources.some((source) => source.includes(text))) return text;
  const needle = text.replace(/\s/gu, "");
  if (needle.length < 2) return null;
  for (const source of sources) {
    let compact = "";
    const positions: { start: number; end: number }[] = [];
    for (const match of source.matchAll(/\S/gu)) {
      const part = match[0],
        start = match.index;
      compact += part;
      for (let i = 0; i < part.length; i++) positions.push({ start, end: start + part.length });
    }
    const index = compact.indexOf(needle);
    if (index < 0) continue;
    const start = positions[index]?.start,
      end = positions[index + needle.length - 1]?.end;
    if (start !== undefined && end !== undefined) return source.slice(start, end);
  }
  return null;
}
