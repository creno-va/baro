import { FIELD_LABELS, REGION_LABELS } from "./labels";

/** Carry only the public directory's applied filters across a profile visit. */
export function directoryReturnHref(search: string): string {
  const source = new URLSearchParams(search);
  const filters = new URLSearchParams();
  const name = (source.get("name") ?? "").trim().slice(0, 100);
  const region = source.get("region") ?? "";
  const legalField = source.get("legalField") ?? "";
  if (name) filters.set("name", name);
  if (Object.hasOwn(REGION_LABELS, region)) filters.set("region", region);
  if (Object.hasOwn(FIELD_LABELS, legalField)) filters.set("legalField", legalField);
  return `/lawyers${filters.size ? `?${filters}` : ""}`;
}

export function lawyerProfileHref(id: string, search: string): string {
  return `/lawyers/${encodeURIComponent(id)}${directoryReturnHref(search).slice("/lawyers".length)}`;
}
