/** Workers-only PDF writer. Embedded static TrueType, per-glyph widths and a
 * ToUnicode CMap preserve Korean display, copying and text extraction offline.
 * No scripts, attachments, external font requests or rasterized report text.
 */
const encode = (value: string) => new TextEncoder().encode(value);
function join(parts: readonly Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}
function trueType(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, number>();
  for (let i = 0; i < data.getUint16(4); i++) {
    const start = 12 + i * 16;
    tables.set(String.fromCharCode(...bytes.subarray(start, start + 4)), data.getUint32(start + 8));
  }
  const table = (name: string) => {
    const offset = tables.get(name);
    if (!offset) throw new Error("REPORT_FONT_INVALID");
    return offset;
  };
  const upem = data.getUint16(table("head") + 18);
  const hhea = table("hhea"),
    metrics = data.getUint16(hhea + 34),
    hmtx = table("hmtx");
  const cmap = table("cmap");
  let selected = 0;
  for (let i = 0; i < data.getUint16(cmap + 2); i++) {
    const offset = cmap + data.getUint32(cmap + 4 + i * 8 + 4);
    if (data.getUint16(offset) === 12) {
      selected = offset;
      break;
    }
    if (data.getUint16(offset) === 4) selected = offset;
  }
  if (!selected) throw new Error("REPORT_FONT_INVALID");
  const glyph = (point: number): number => {
    if (data.getUint16(selected) === 12) {
      let lo = 0,
        hi = data.getUint32(selected + 12) - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1,
          base = selected + 16 + mid * 12;
        const first = data.getUint32(base),
          last = data.getUint32(base + 4);
        if (point < first) hi = mid - 1;
        else if (point > last) lo = mid + 1;
        else return data.getUint32(base + 8) + point - first;
      }
    } else if (point <= 0xffff) {
      const count = data.getUint16(selected + 6) / 2;
      const ends = selected + 14,
        starts = ends + count * 2 + 2,
        deltas = starts + count * 2,
        ranges = deltas + count * 2;
      for (let i = 0; i < count; i++) {
        if (point > data.getUint16(ends + i * 2)) continue;
        if (point < data.getUint16(starts + i * 2)) return 0;
        const delta = data.getInt16(deltas + i * 2),
          range = data.getUint16(ranges + i * 2);
        if (!range) return (point + delta) & 0xffff;
        const value = data.getUint16(
          ranges + i * 2 + range + (point - data.getUint16(starts + i * 2)) * 2,
        );
        return value ? (value + delta) & 0xffff : 0;
      }
    }
    return 0;
  };
  return {
    glyph,
    width: (gid: number) =>
      Math.round((data.getUint16(hmtx + Math.min(gid, metrics - 1) * 4) * 1000) / upem),
    ascent: Math.round((data.getInt16(hhea + 4) * 1000) / upem),
    descent: Math.round((data.getInt16(hhea + 6) * 1000) / upem),
  };
}
export function renderReportPdf(
  fontBytes: Uint8Array,
  input: {
    title: string;
    content: string;
    revision: number;
    updatedAt: string;
    basis?: { workspaceRevision: number; summaryRevision: number; generatedAt: string };
    excludedFileCount?: number;
    maskIdentifiers?: boolean;
  },
) {
  if (fontBytes.byteLength > 4_000_000 || input.content.length > 30000 || input.title.length > 500)
    throw new Error("EXPORT_TOO_LARGE");
  const font = trueType(fontBytes);
  const chars = new Map<string, { cid: number; gid: number; width: number }>();
  function character(value: string) {
    let info = chars.get(value);
    if (!info) {
      const gid = font.glyph(value.codePointAt(0) ?? 0) || font.glyph(63);
      info = { cid: chars.size + 1, gid, width: font.width(gid) };
      chars.set(value, info);
    }
    return info;
  }
  function wrap(text: string, size: number, max = 491) {
    const output: string[] = [];
    for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
      let line = "",
        width = 0;
      for (const scalar of paragraph.replace(/\t/g, "    ")) {
        const advance = (character(scalar).width * size) / 1000;
        if (width + advance > max && line) {
          output.push(line);
          line = "";
          width = 0;
        }
        line += scalar;
        width += advance;
      }
      output.push(line);
    }
    return output;
  }
  const title = wrap(input.title, 18),
    lines = wrap(input.content, 11);
  const records: Uint8Array[] = [];
  const object = (value: string | Uint8Array) => {
    records.push(typeof value === "string" ? encode(value) : value);
    return records.length;
  };
  const stream = (bytes: Uint8Array, extra = "") =>
    join([
      encode(`<< /Length ${bytes.length} ${extra} >>\nstream\n`),
      bytes,
      encode("\nendstream"),
    ]);
  const catalog = object(""),
    pages = object("");
  const fontFile = object(stream(fontBytes, `/Length1 ${fontBytes.length}`));
  const descriptor = object(
    `<< /Type /FontDescriptor /FontName /BaroReport /Flags 4 /FontBBox [-1000 -1000 3000 3000] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight 700 /StemV 80 /FontFile2 ${fontFile} 0 R >>`,
  );
  const cidToGid = object(""),
    toUnicode = object(""),
    descendant = object("");
  const fontId = object(
    `<< /Type /Font /Subtype /Type0 /BaseFont /BaroReport /Encoding /Identity-H /DescendantFonts [${descendant} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
  );
  const children: number[] = [];
  const text = (value: string, size: number, y: number, color = "0.10 0.14 0.23") => {
    const codes = [...value]
      .map((scalar) => character(scalar).cid.toString(16).padStart(4, "0"))
      .join("");
    return `${color} rg BT /F0 ${size} Tf 1 0 0 1 52 ${y} Tm <${codes}> Tj ET\n`;
  };
  // Keep every title line; paginate even unusually long titles before body.
  const all = [
    ...title.map((value) => ({ value, size: 18, gap: 26 })),
    { value: `검토 버전 ${input.revision} · ${input.updatedAt}`, size: 9, gap: 27 },
    ...(input.basis
      ? wrap(
          `생성 기준: 요약 ${input.basis.summaryRevision} · 사건 ${input.basis.workspaceRevision} · ${input.basis.generatedAt}`,
          9,
        ).map((value) => ({ value, size: 9, gap: 19 }))
      : []),
    ...wrap(
      `제외 자료: ${input.excludedFileCount ?? 0}개 · 식별정보 자동 가림: ${input.maskIdentifiers ? "켜짐" : "꺼짐"} · 생성 기준 이후 변경은 반영되지 않습니다.`,
      9,
    ).map((value) => ({ value, size: 9, gap: 19 })),
    ...lines.map((value) => ({ value, size: 11, gap: 19 })),
  ];
  let cursor = 0;
  do {
    let y = 745,
      drawing = text("BARO · 상담 준비 리포트", 12, 790, "0.13 0.35 0.78");
    while (cursor < all.length) {
      const record = all[cursor];
      if (!record || y - record.gap < 82) break;
      drawing += text(record.value, record.size, y);
      y -= record.gap;
      cursor++;
    }
    drawing += text(
      "법률 판단·원본 진정성·법적 효력을 보장하지 않습니다. 사용자가 직접 전달합니다.",
      8,
      49,
    );
    drawing += text(`${children.length + 1}`, 9, 30);
    const content = object(stream(encode(drawing)));
    children.push(
      object(
        `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F0 ${fontId} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  } while (cursor < all.length);
  const mapping = new Uint8Array((chars.size + 1) * 2),
    view = new DataView(mapping.buffer);
  const cmapLines: string[] = [];
  const widths: string[] = [];
  for (const [scalar, info] of chars) {
    view.setUint16(info.cid * 2, info.gid);
    widths.push(`${info.cid} [${info.width}]`);
    const utf16 = Array.from({ length: scalar.length }, (_, i) =>
      scalar.charCodeAt(i).toString(16).padStart(4, "0"),
    ).join("");
    cmapLines.push(`<${info.cid.toString(16).padStart(4, "0")}> <${utf16}>`);
  }
  let cmapText =
    "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /BaroUnicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n";
  for (let start = 0; start < cmapLines.length; start += 100) {
    const section = cmapLines.slice(start, start + 100);
    cmapText += `${section.length} beginbfchar\n${section.join("\n")}\nendbfchar\n`;
  }
  cmapText += "endcmap CMapName currentdict /CMap defineresource pop end end";
  records[cidToGid - 1] = stream(mapping);
  records[toUnicode - 1] = stream(encode(cmapText));
  records[descendant - 1] = encode(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /BaroReport /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap ${cidToGid} 0 R /DW 1000 /W [${widths.join(" ")}] >>`,
  );
  records[catalog - 1] = encode(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  records[pages - 1] = encode(
    `<< /Type /Pages /Count ${children.length} /Kids [${children.map((id) => `${id} 0 R`).join(" ")}] >>`,
  );
  const output = [encode("%PDF-1.7\n%BARO\n")],
    offsets = [0];
  let offset = output[0]?.length ?? 0;
  for (const [index, record] of records.entries()) {
    offsets.push(offset);
    const value = join([encode(`${index + 1} 0 obj\n`), record, encode("\nendobj\n")]);
    output.push(value);
    offset += value.length;
  }
  output.push(
    encode(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${offsets.length} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
    ),
  );
  return join(output);
}
