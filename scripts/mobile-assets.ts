import { createHash } from "node:crypto";

export const assetHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const invalid = () => new Error("MOBILE_FONT_INVALID");
/** Read only bounded, generated SFNT metadata; no font renderer or external IO. */
export function inspectMobileFont(bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  if (data.length > 16_000_000 || data.length < 12 || data.readUInt32BE(0) !== 0x10000)
    throw invalid();
  const count = data.readUInt16BE(4),
    tables = new Map<string, Buffer>();
  if (!count || count > 128 || 12 + count * 16 > data.length) throw invalid();
  for (let i = 0; i < count; i++) {
    const offset = 12 + i * 16,
      name = data.toString("ascii", offset, offset + 4),
      start = data.readUInt32BE(offset + 8),
      length = data.readUInt32BE(offset + 12);
    if (start < 12 + count * 16 || start + length > data.length || tables.has(name))
      throw invalid();
    tables.set(name, data.subarray(start, start + length));
  }
  const table = (name: string, minimum: number) => {
    const value = tables.get(name);
    if (!value || value.length < minimum) throw invalid();
    return value;
  };
  const name = table("name", 6),
    names = new Map<number, string>();
  const records = name.readUInt16BE(2),
    strings = name.readUInt16BE(4);
  if (6 + records * 12 > name.length || strings > name.length) throw invalid();
  for (let i = 0; i < records; i++) {
    const record = 6 + i * 12;
    // Localized instance labels share IDs. Use Windows Unicode English for canonical names.
    if (name.readUInt16BE(record) !== 3 || name.readUInt16BE(record + 4) !== 0x409) continue;
    const id = name.readUInt16BE(record + 6),
      length = name.readUInt16BE(record + 8),
      start = strings + name.readUInt16BE(record + 10);
    if (length % 2 || start + length > name.length) throw invalid();
    let value = "";
    for (let j = 0; j < length; j += 2) value += String.fromCharCode(name.readUInt16BE(start + j));
    if (names.has(id) && names.get(id) !== value) throw invalid();
    names.set(id, value);
  }
  const fvar = table("fvar", 16),
    axisStart = fvar.readUInt16BE(4),
    axisCount = fvar.readUInt16BE(8),
    axisSize = fvar.readUInt16BE(10),
    instances = fvar.readUInt16BE(12),
    instanceSize = fvar.readUInt16BE(14);
  if (
    axisCount !== 1 ||
    axisSize < 20 ||
    instanceSize < 8 ||
    axisStart + axisSize + instances * instanceSize > fvar.length ||
    fvar.toString("ascii", axisStart, axisStart + 4) !== "wght"
  )
    throw invalid();
  const weight = {
    min: fvar.readInt32BE(axisStart + 4) / 65536,
    default: fvar.readInt32BE(axisStart + 8) / 65536,
    max: fvar.readInt32BE(axisStart + 12) / 65536,
    instances: [] as number[],
  };
  for (let i = 0; i < instances; i++) {
    const offset = axisStart + axisSize + i * instanceSize;
    weight.instances.push(fvar.readInt32BE(offset + 4) / 65536);
    if (instanceSize >= 10 && !names.get(fvar.readUInt16BE(offset + 8))?.startsWith("BaroMobile"))
      throw invalid();
  }
  const cmap = table("cmap", 4),
    cmapCount = cmap.readUInt16BE(2),
    maxp = table("maxp", 6);
  if (4 + cmapCount * 8 > cmap.length) throw invalid();
  let codepoints = 0,
    hangul = 0,
    found = false;
  for (let i = 0; i < cmapCount; i++) {
    const offset = cmap.readUInt32BE(4 + i * 8 + 4);
    if (offset + 2 > cmap.length) throw invalid();
    if (cmap.readUInt16BE(offset) !== 12) continue;
    if (offset + 16 > cmap.length) throw invalid();
    const length = cmap.readUInt32BE(offset + 4),
      groups = cmap.readUInt32BE(offset + 12);
    if (length < 16 || offset + length > cmap.length || 16 + groups * 12 > length) throw invalid();
    let previous = -1;
    for (let g = 0; g < groups; g++) {
      const at = offset + 16 + g * 12,
        first = cmap.readUInt32BE(at),
        last = cmap.readUInt32BE(at + 4),
        glyph = cmap.readUInt32BE(at + 8);
      if (
        first <= previous ||
        last < first ||
        last > 0x10ffff ||
        !glyph ||
        glyph + last - first >= maxp.readUInt16BE(4)
      )
        throw invalid();
      previous = last;
      codepoints += last - first + 1;
      hangul += Math.max(0, Math.min(last, 0xd7a3) - Math.max(first, 0xac00) + 1);
    }
    found = true;
    break;
  }
  if (
    !found ||
    names.get(1) !== "BaroMobile" ||
    names.get(16) !== "BaroMobile" ||
    names.get(6) !== "BaroMobile-Regular" ||
    hangul !== 11172 ||
    ![400, 600, 700].every((value) => weight.instances.includes(value)) ||
    weight.min > 400 ||
    weight.max < 700 ||
    weight.default !== 400
  )
    throw invalid();
  return { names, weight, glyphs: maxp.readUInt16BE(4), codepoints, hangul };
}
