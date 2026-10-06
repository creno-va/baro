import { z } from "zod";
import {
  type V2PublicLawyer,
  v2DirectorySnapshotSchema,
  v2PortfolioAssetSchema,
  v2PublicLawyerSchema,
} from "../../contracts/v2";
import {
  type SelfProfile,
  selfDirectoryPageSchema,
  selfProfileSchema,
} from "../../server/modules/lawyers/self-profile-contract";
import {
  apiMode,
  apiRequest,
  ApiError as LawyerApiError,
  responseError,
  request as sharedRequest,
} from "./core";

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
    const own: SelfProfile[] = [];
    do {
      const page = selfDirectoryPageSchema.parse(
        await request(`/api/v2/lawyers/self-service?${params}`),
      );
      own.push(...page.items);
      cursor = page.nextCursor;
      if (cursor) params.set("cursor", cursor);
    } while (cursor);
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
    return profile;
  },
  async saveMine(profile: LawyerView): Promise<LawyerView> {
    const saved = selfProfileSchema.parse(
      await request("/api/v2/me/lawyer/self-profile", "PUT", { profile }),
    );
    return saved;
  },
  async publishMine(
    published: boolean,
    current?: Pick<LawyerView, "id" | "revision">,
  ): Promise<LawyerView> {
    const mine = current ?? (await real.getMine());
    const expectedRevision = mine.revision;
    const profile = selfProfileSchema.parse(
      await request("/api/v2/me/lawyer/self-profile/publication", "POST", {
        published,
        expectedRevision,
        profileId: mine.id,
        consent: published,
      }),
    );
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
  async publishMine(published: boolean, current?: Pick<LawyerView, "id" | "revision">) {
    const mine = current ?? (await sharedRequest<LawyerView>("lawyers.getMine"));
    return sharedRequest<LawyerView>("lawyers.publishMine", {
      published,
      profileId: mine.id,
      expectedRevision: mine.revision,
    });
  },
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
  async publishMine(published: boolean, current?: Pick<LawyerView, "id" | "revision">) {
    return (await adapter()).publishMine(published, current);
  },
};
export type LawyerAssetView = {
  id: string;
  revision: number;
  status: string;
  purpose?: string;
  kind: "image" | "pdf";
};
const assetEnvelope = z.object({
  assetId: z.string(),
  revision: z.number(),
  value: z.union([
    v2PortfolioAssetSchema,
    z.object({ request: z.object({ mediaType: z.string() }) }),
  ]),
});
function assetView(raw: unknown): LawyerAssetView {
  const row = assetEnvelope.parse(raw);
  return {
    id: row.assetId,
    revision: row.revision,
    status: "status" in row.value ? row.value.status : "reserved",
    kind:
      "kind" in row.value
        ? row.value.kind
        : row.value.request.mediaType === "application/pdf"
          ? "pdf"
          : "image",
  };
}
async function checkedAssetRequest(path: string, init: RequestInit = {}) {
  const response = await apiRequest(path, init);
  if (!response.ok) throw await responseError(response);
  return response;
}
export const lawyerAssets = {
  async list(): Promise<LawyerAssetView[]> {
    if (apiMode === "mock") {
      await import("./mock/lawyers");
      return sharedRequest("lawyers.assets");
    }
    const response = await checkedAssetRequest("/api/v2/me/lawyer/self-profile/assets");
    const page = z
      .object({
        items: z.array(
          z.object({
            id: z.string(),
            revision: z.number(),
            status: z.string(),
            purpose: z.string(),
          }),
        ),
      })
      .parse(await response.json());
    return page.items.map((item) => ({ ...item, kind: "image" as const }));
  },
  async upload(
    profileId: string,
    file: File,
    purpose: "profile_photo" | "portfolio",
  ): Promise<LawyerAssetView> {
    if (
      !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) ||
      !file.size ||
      file.size > 100_000_000 ||
      (purpose === "profile_photo" && file.type === "application/pdf")
    )
      throw new LawyerApiError(
        "VALIDATION_ERROR",
        "사진은 JPEG·PNG·WebP, 자료는 이미지·PDF 100MB 이하로 선택해 주세요.",
      );
    if (apiMode === "mock") {
      await import("./mock/lawyers");
      return sharedRequest("lawyers.uploadAsset", { profileId, file, purpose });
    }
    const mine = z
      .object({ profileId: z.string(), revision: z.number() })
      .parse(await request("/api/v2/me/lawyer/profile"));
    if (mine.profileId !== profileId)
      throw new LawyerApiError("NOT_FOUND", "본인 프로필만 변경할 수 있어요.");
    const reserved = assetView(
      await (
        await checkedAssetRequest("/api/v2/me/lawyer/portfolio-assets", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "if-match": String(mine.revision),
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            purpose,
            name: file.name,
            byteLength: file.size,
            mediaType: file.type,
          }),
        })
      ).json(),
    );
    return {
      ...assetView(
        await (
          await checkedAssetRequest(
            `/api/v2/me/lawyer/assets/${encodeURIComponent(reserved.id)}/content`,
            {
              method: "PUT",
              headers: {
                "content-type": "application/octet-stream",
                "if-match": String(reserved.revision),
              },
              body: file,
            },
          )
        ).json(),
      ),
      purpose,
    };
  },
  async remove(assetId: string, revision: number): Promise<void> {
    if (apiMode === "mock") {
      await import("./mock/lawyers");
      await sharedRequest("lawyers.removeAsset", { assetId, revision });
      return;
    }
    await checkedAssetRequest(`/api/v2/me/lawyer/portfolio-assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision }),
    });
  },
  async blob(profileId: string, assetId: string, privateRead = false): Promise<Blob> {
    if (apiMode === "mock") {
      await import("./mock/lawyers");
      const data = await sharedRequest<{ data: string; type: string }>("lawyers.assetBlob", {
        profileId,
        assetId,
        privateRead,
      });
      return new Blob([Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))], {
        type: data.type,
      });
    }
    const path = privateRead
      ? `/api/v2/me/lawyer/self-profile/assets/${encodeURIComponent(assetId)}/content`
      : `/api/v2/lawyers/self-service/${encodeURIComponent(profileId)}/assets/${encodeURIComponent(assetId)}`;
    return (await checkedAssetRequest(path)).blob();
  },
};
// Domain facade; A's shared index re-exports this instance without a second UI implementation.
export const api = { lawyers };
