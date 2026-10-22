export {
  emptySelfProfile,
  isDuplicateProfileSave,
  profileReady,
  type SelfProfile,
  selfAssetUrl,
  selfDirectoryPageSchema,
  selfProfileSchema,
} from "../../../contracts/v2/self-profile";

export function stripSelfPhotoMetadata(data: string) {
  const bytes = Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) => c.charCodeAt(0));
  const result: number[] = [0xff, 0xd8];
  const view = new DataView(bytes.buffer);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = bytes[offset + 1] ?? 0;
    const length = view.getUint16(offset + 2);
    if (bytes[offset] !== 0xff || length < 2 || offset + 2 + length > bytes.length)
      throw new Error("Invalid JPEG");
    if (marker === 0xda) {
      result.push(...bytes.subarray(offset));
      break;
    }
    if (!((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe))
      result.push(...bytes.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  return `data:image/jpeg;base64,${btoa(String.fromCharCode(...result))}`;
}
