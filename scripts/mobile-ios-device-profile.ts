import { z } from "zod";

export const iosDeviceProfileSchema = z.enum(["iphone-16", "ipad-pro-13-m4"]);
export const iosDeviceProfileModels = {
  "iphone-16": "iPhone 16",
  "ipad-pro-13-m4": "iPad Pro 13-inch (M4)",
} as const;
export function resolveIosDeviceProfile(
  value: string | undefined,
  observation: {
    home: boolean;
    authCancel: boolean;
    publicDirectory: boolean;
    inputReference: boolean;
    koreanDirectory: boolean;
  },
) {
  const parsed = iosDeviceProfileSchema.safeParse(value ?? "iphone-16");
  if (!parsed.success) throw Error("INTERNAL_IOS_DEVICE_PROFILE_REQUIRED");
  const profile = parsed.data;
  if (
    profile !== "iphone-16" &&
    (!observation.home ||
      observation.authCancel ||
      observation.publicDirectory ||
      observation.inputReference ||
      observation.koreanDirectory)
  )
    throw Error("INTERNAL_IOS_TABLET_HOME_GUIDE_ONLY");
  return { profile, model: iosDeviceProfileModels[profile], tablet: profile !== "iphone-16" };
}
export function selectIosProfileDevice(
  types: { identifier: string; name: string }[],
  model: string,
) {
  if (!(Object.values(iosDeviceProfileModels) as string[]).includes(model))
    throw Error("INTERNAL_IOS_PROFILE_DEVICE_REQUIRED");
  const matches = types.filter((type) => type.name === model);
  if (
    matches.length !== 1 ||
    !/^com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]+$/.test(matches[0]?.identifier ?? "")
  )
    throw Error("INTERNAL_IOS_PROFILE_DEVICE_REQUIRED");
  return matches[0]!;
}
