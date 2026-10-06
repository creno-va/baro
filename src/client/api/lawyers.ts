import {
  type V2PublicLawyer,
  v2DirectorySnapshotSchema,
  v2PublicLawyerSchema,
} from "../../contracts/v2";
import {
  type SelfProfile,
  selfProfileSchema,
} from "../../server/modules/lawyers/self-profile-contract";
import { apiMode, ApiError as LawyerApiError, request as sharedRequest } from "./core";

export { ApiError as LawyerApiError } from "./core";

export type LawyerView = Omit<SelfProfile, "region" | "practiceAreas"> & {
  region: string;
  practiceAreas: string[];
};
export type LawyerFilters = { region?: string; practiceArea?: string; query?: string };
export function lawyerErrorMessage(error: unknown) {
  if (error instanceof LawyerApiError && error.code === "CONFLICT")
    return "다른 화면에서 변경됐어요. 최신 프로필을 불러온 후 다시 저장해 주세요.";
  return error instanceof LawyerApiError
    ? error.message
    : "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
export function rotateLawyers(items: LawyerView[]) {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  if (!sorted.length) return sorted;
  const day = Math.floor((Date.now() + 9 * 60 * 60 * 1000) / 86400000);
  const offset = day % sorted.length;
  return [...sorted.slice(offset), ...sorted.slice(0, offset)];
}
async function request(path: string, method = "GET", body?: unknown): Promise<unknown> {
  return sharedRequest("lawyers.http", undefined, {
    path,
    method,
    ...(body === undefined ? {} : { body }),
  });
}
export function fromVerified(p: V2PublicLawyer): LawyerView {
  return {
    id: p.id,
    revision: p.approvedRevision,
    name: p.content.name,
    introduction: p.content.introduction,
    officeName: p.content.office.name,
    address: [p.content.office.address, p.content.office.addressDetail].filter(Boolean).join(" "),
    region: p.content.office.region,
    practiceAreas: p.content.legalFields,
    phone: p.content.contact.phone ?? "",
    email: p.content.contact.email ?? "",
    website: p.content.contact.consultationUrl ?? "",
    photoUrl: `/api/v2/lawyers/${encodeURIComponent(p.id)}/assets/${encodeURIComponent(p.content.photoAssetId)}`,
    portfolio: p.content.portfolio.map((i) => ({
      id: i.id,
      title: i.title,
      url:
        i.kind === "text"
          ? null
          : `/api/v2/lawyers/${encodeURIComponent(p.id)}/assets/${encodeURIComponent(i.assetId)}`,
      ...(i.kind === "text" ? { text: i.text } : {}),
    })),
    published: true,
    verificationStatus: "verified",
  };
}
let mineRevision: number | null = null;
const real = {
  async list(filters: LawyerFilters = {}): Promise<LawyerView[]> {
    const params = new URLSearchParams();
    if (filters.query?.trim()) params.set("name", filters.query.trim());
    if (filters.region) params.set("region", filters.region);
    if (filters.practiceArea) params.set("legalField", filters.practiceArea);
    const first = v2DirectorySnapshotSchema.parse(await request(`/api/v2/lawyers?${params}`));
    const items = first.items.map(fromVerified);
    let cursor = first.nextCursor;
    while (cursor) {
      params.set("cursor", cursor);
      const page = v2DirectorySnapshotSchema.parse(await request(`/api/v2/lawyers?${params}`));
      items.push(...page.items.map(fromVerified));
      cursor = page.nextCursor;
    }
    params.delete("cursor");
    const own = selfProfileSchema
      .array()
      .parse(await request(`/api/v2/lawyers/self-service?${params}`));
    return rotateLawyers([...own, ...items.filter((p) => !own.some((s) => s.id === p.id))]);
  },
  async get(id: string): Promise<LawyerView> {
    try {
      return selfProfileSchema.parse(
        await request(`/api/v2/lawyers/self-service/${encodeURIComponent(id)}`),
      );
    } catch (error) {
      if (!(error instanceof LawyerApiError) || error.code !== "NOT_FOUND") throw error;
      return fromVerified(
        v2PublicLawyerSchema.parse(await request(`/api/v2/lawyers/${encodeURIComponent(id)}`)),
      );
    }
  },
  async getMine(): Promise<LawyerView> {
    const profile = selfProfileSchema.parse(await request("/api/v2/me/lawyer/self-profile"));
    mineRevision = profile.revision;
    return profile;
  },
  async saveMine(profile: LawyerView): Promise<LawyerView> {
    const saved = selfProfileSchema.parse(
      await request("/api/v2/me/lawyer/self-profile", "PUT", { profile }),
    );
    mineRevision = saved.revision;
    return saved;
  },
  async publishMine(published: boolean): Promise<LawyerView> {
    const expectedRevision = mineRevision ?? (await real.getMine()).revision;
    const profile = selfProfileSchema.parse(
      await request("/api/v2/me/lawyer/self-profile/publication", "POST", {
        published,
        expectedRevision,
        consent: published,
      }),
    );
    mineRevision = profile.revision;
    return profile;
  },
};
async function adapter() {
  if (apiMode === "mock") {
    await import("./mock/lawyers");
    return mockTransport;
  }
  return real;
}
const mockTransport = {
  list: (filters: LawyerFilters = {}) => sharedRequest<LawyerView[]>("lawyers.list", filters),
  get: (id: string) => sharedRequest<LawyerView>("lawyers.get", { id }),
  getMine: () => sharedRequest<LawyerView>("lawyers.getMine"),
  saveMine: (profile: LawyerView) => sharedRequest<LawyerView>("lawyers.saveMine", profile),
  publishMine: (published: boolean) =>
    sharedRequest<LawyerView>("lawyers.publishMine", { published }),
};
export const lawyers = {
  async list(filters: LawyerFilters = {}) {
    return (await adapter()).list(filters);
  },
  async get(id: string) {
    return (await adapter()).get(id);
  },
  async getMine() {
    return (await adapter()).getMine();
  },
  async saveMine(profile: LawyerView) {
    return (await adapter()).saveMine(profile);
  },
  async publishMine(published: boolean) {
    return (await adapter()).publishMine(published);
  },
};
// Domain facade; A's shared index re-exports this instance without a second UI implementation.
export const api = { lawyers };
