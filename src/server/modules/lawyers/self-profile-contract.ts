import { z } from "zod";
import {
  v2ExternalConsultationUrlSchema,
  v2LegalFieldSchema,
  v2RegionSchema,
} from "../../../contracts/v2/lawyers";

export const selfAssetUrl = (profileId: string, assetId: string) =>
  `/api/v2/lawyers/self-service/${encodeURIComponent(profileId)}/assets/${encodeURIComponent(assetId)}`;
const assetPath = z
  .string()
  .regex(/^\/api\/v2\/lawyers\/self-service\/[A-Za-z0-9_-]+\/assets\/[A-Za-z0-9_-]+$/);
const publicLink = z.literal("").or(z.url().pipe(v2ExternalConsultationUrlSchema));
export const selfProfileSchema = z
  .strictObject({
    id: z.string().min(1).max(128),
    revision: z.number().int().positive(),
    name: z.string().trim().max(100),
    introduction: z.string().trim().max(5000),
    officeName: z.string().trim().max(200),
    address: z.string().trim().max(500),
    region: v2RegionSchema.or(z.literal("")),
    practiceAreas: z.array(v2LegalFieldSchema).max(11),
    phone: z
      .string()
      .trim()
      .max(30)
      .refine((v) => v === "" || /^\+?[0-9][0-9 ()-]{6,29}$/.test(v)),
    email: z.email().max(254).or(z.literal("")),
    website: publicLink,
    photoAssetId: z.string().min(1).max(128).nullable().optional(),
    photoUrl: z
      .string()
      .max(44000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/)
      .or(assetPath)
      .nullable(),
    portfolio: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(128),
          title: z.string().trim().min(1).max(300),
          // Optional for existing title/link-only encrypted snapshots.
          text: z.string().trim().max(5000).optional(),
          url: publicLink.or(assetPath).nullable(),
          assetId: z.string().min(1).max(128).optional(),
        }),
      )
      .max(30),
    published: z.boolean(),
    verificationStatus: z.enum(["self_declared", "verified"]),
  })
  .refine(
    (p) =>
      (p.photoAssetId
        ? p.photoUrl === selfAssetUrl(p.id, p.photoAssetId)
        : !p.photoUrl?.startsWith("/")) &&
      p.portfolio.every((item) =>
        item.assetId ? item.url === selfAssetUrl(p.id, item.assetId) : !item.url?.startsWith("/"),
      ),
    "Asset links must match this profile",
  )
  .refine(
    (p) =>
      new Set(p.practiceAreas).size === p.practiceAreas.length &&
      new Set(p.portfolio.map((i) => i.id)).size === p.portfolio.length,
  )
  .refine(
    (p) => new TextEncoder().encode(JSON.stringify(p)).byteLength <= 60000,
    "Profile is too large",
  );
export type SelfProfile = z.infer<typeof selfProfileSchema>;
export const selfDirectoryPageSchema = z.strictObject({
  items: selfProfileSchema.array().max(50),
  nextCursor: z.string().min(1).max(128).nullable(),
});
export function isDuplicateProfileSave(current: SelfProfile, incoming: SelfProfile) {
  return (
    current.revision === incoming.revision + 1 &&
    JSON.stringify(current) ===
      JSON.stringify({
        ...incoming,
        revision: current.revision,
        verificationStatus: "self_declared",
      })
  );
}
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
export function emptySelfProfile(id: string, name = ""): SelfProfile {
  return {
    id,
    revision: 1,
    name,
    introduction: "",
    officeName: "",
    address: "",
    region: "",
    practiceAreas: [],
    phone: "",
    email: "",
    website: "",
    photoUrl: null,
    portfolio: [],
    published: false,
    verificationStatus: "self_declared",
  };
}
export function profileReady(profile: SelfProfile) {
  return !!(
    profile.name &&
    profile.introduction &&
    profile.officeName &&
    profile.address &&
    profile.region &&
    profile.practiceAreas.length &&
    (profile.phone || profile.email || profile.website)
  );
}
