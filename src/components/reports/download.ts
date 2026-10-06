/** Conservative masking. The user still reviews names, addresses and the original files. */
export function maskReportText(text: string) {
  return text
    .replace(/\b\d{6}\s*-?\s*[1-8]\d{6}\b/g, "[주민등록번호 가림]")
    .replace(
      /(?<!\d)(?:\+82[-\s]?0?1[016789]|01[016789])[-\s]?\d{3,4}[-\s]?\d{4}(?!\d)/g,
      "[전화번호 가림]",
    )
    .replace(
      /(?<!\d)(?:\+82[-\s]?0?(?:2|[3-6]\d|70)|0(?:2|[3-6]\d|70))[-\s]?\d{3,4}[-\s]?\d{4}(?!\d)/g,
      "[전화번호 가림]",
    )
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[이메일 가림]");
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.replace(/[^\p{L}\p{N}._-]/gu, "_");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const encode = (text: string) => new TextEncoder().encode(text);
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size: number, fields: [number, number, 2 | 4][]) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  for (const [offset, value, length] of fields) {
    if (length === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  }
  return bytes;
}
/** ZIP STORE entries, UTF-8 filenames, CRC32, central directory and EOCD. No fake extensions. */
export async function createZip(entries: { name: string; blob: Blob }[]) {
  if (!entries.length || entries.length > 100) throw new Error("ZIP 자료를 1~100개 선택해 주세요.");
  if (entries.reduce((size, entry) => size + entry.blob.size, 0) > 100_000_000)
    throw new Error(
      "API 예시 ZIP은 선택 자료 전체 100MB까지 지원해요. 자료를 나눠 다운로드해 주세요.",
    );
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [index, entry] of entries.entries()) {
    const safe = entry.name
      .replace(/[\\/]/g, "_")
      .split("")
      .map((char) => (char.charCodeAt(0) < 32 ? "_" : char))
      .join("")
      .replace(/^\.+/, "_")
      .slice(0, 150);
    const name = encode(`${String(index + 1).padStart(3, "0")}-${safe || "material"}`);
    const bytes = new Uint8Array(await entry.blob.arrayBuffer());
    if (bytes.length > 100_000_000) throw new Error("합성 ZIP은 자료당 100MB까지 지원해요.");
    const crc = crc32(bytes);
    const local = header(30, [
      [0, 0x04034b50, 4],
      [4, 20, 2],
      [6, 0x800, 2],
      [12, 0x21, 2],
      [14, crc, 4],
      [18, bytes.length, 4],
      [22, bytes.length, 4],
      [26, name.length, 2],
    ]);
    locals.push(local, name, bytes);
    central.push(
      header(46, [
        [0, 0x02014b50, 4],
        [4, 20, 2],
        [6, 20, 2],
        [8, 0x800, 2],
        [14, 0x21, 2],
        [16, crc, 4],
        [20, bytes.length, 4],
        [24, bytes.length, 4],
        [28, name.length, 2],
        [42, offset, 4],
      ]),
      name,
    );
    offset += local.length + name.length + bytes.length;
  }
  const directory = join(central);
  const end = header(22, [
    [0, 0x06054b50, 4],
    [8, entries.length, 2],
    [10, entries.length, 2],
    [12, directory.length, 4],
    [16, offset, 4],
  ]);
  return new Blob([join([...locals, directory, end])], { type: "application/zip" });
}
/** Mock PDF embeds browser-rendered Korean text. Production rendering remains #66. */
export async function createSyntheticPdf(title: string, content: string, revision: number) {
  if (typeof document === "undefined") throw new Error("PDF는 브라우저에서 다운로드해 주세요.");
  await document.fonts.load('26px "Pretendard Variable"');
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF 화면을 만들지 못했어요.");
  ctx.font = '26px "Pretendard Variable", sans-serif';
  const lines: string[] = [];
  for (const paragraph of content.split("\n")) {
    let line = "";
    for (const letter of paragraph) {
      if (ctx.measureText(line + letter).width > 1060) {
        lines.push(line);
        line = letter;
      } else line += letter;
    }
    lines.push(line);
  }
  const pages: Uint8Array[] = [];
  const perPage = 35;
  for (let start = 0; start < Math.max(lines.length, 1); start += perPage) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1240, 1754);
    ctx.fillStyle = "#2159c8";
    ctx.font = 'bold 28px "Pretendard Variable", sans-serif';
    ctx.fillText("BARO · 합성 API 예시 리포트", 90, 95);
    ctx.fillStyle = "#17233b";
    ctx.font = 'bold 34px "Pretendard Variable", sans-serif';
    ctx.fillText(title.slice(0, 32), 90, 158);
    ctx.fillStyle = "#64748b";
    ctx.font = '22px "Pretendard Variable", sans-serif';
    ctx.fillText(`검토 버전 ${revision} · 법률 판단이나 원본 진정성을 보장하지 않습니다.`, 90, 205);
    ctx.fillStyle = "#17233b";
    ctx.font = '26px "Pretendard Variable", sans-serif';
    for (const [index, line] of lines.slice(start, start + perPage).entries())
      ctx.fillText(line, 90, 278 + index * 38);
    ctx.fillStyle = "#64748b";
    ctx.font = '22px "Pretendard Variable", sans-serif';
    ctx.fillText(
      "사용자가 내용을 확인하고 자료를 직접 전달합니다. 실제 외부 처리 결과가 아닙니다.",
      90,
      1665,
    );
    ctx.fillText(
      `${pages.length + 1} / ${Math.max(1, Math.ceil(lines.length / perPage))}`,
      1100,
      1710,
    );
    const data = canvas.toDataURL("image/jpeg", 0.94).split(",")[1] ?? "";
    pages.push(Uint8Array.from(atob(data), (char) => char.charCodeAt(0)));
  }
  const objects: Uint8Array[] = [];
  const pageIds = pages.map((_, index) => 3 + index * 3);
  objects.push(
    encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encode(
      `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
    ),
  );
  for (const [index, jpeg] of pages.entries()) {
    const id = pageIds[index] ?? 3;
    const stream = encode("q 595.28 0 0 841.89 0 0 cm /Im0 Do Q");
    objects.push(
      encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
      ),
      join([
        encode(
          `<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        ),
        jpeg,
        encode("\nendstream"),
      ]),
      join([encode(`<< /Length ${stream.length} >>\nstream\n`), stream, encode("\nendstream")]),
    );
  }
  const parts = [encode("%PDF-1.4\n")];
  const offsets = [0];
  let size = parts[0]?.length ?? 0;
  for (const [index, object] of objects.entries()) {
    offsets.push(size);
    const part = join([encode(`${index + 1} 0 obj\n`), object, encode("\nendobj\n")]);
    parts.push(part);
    size += part.length;
  }
  parts.push(
    encode(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`,
    ),
  );
  return new Blob([join(parts)], { type: "application/pdf" });
}
