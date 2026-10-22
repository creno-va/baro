import type { SessionScope } from "@baro/client-core";
import { type V2PublicLawyer, v2PublicLawyerSchema } from "@baro/contracts/v2";
import { type SelfProfile, selfProfileSchema } from "@baro/contracts/v2/self-profile";
import { decode } from "./decode";
import { createDirectoryClient, type DirectoryFilters } from "./directory";
import { ApiError } from "./errors";
import type { DomainRequest, DomainRequestInit } from "./reports";

export type LawyerView = Omit<SelfProfile, "region" | "practiceAreas"> & {
  region: string;
  practiceAreas: string[];
};
export function lawyerErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === "CONFLICT")
    return "다른 화면에서 변경됐어요. 최신 프로필을 불러온 후 다시 저장해 주세요.";
  return error instanceof ApiError
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

/** No settled profile cache or ambient-cookie promise sharing. Each caller checks live server authority. */
export function createLawyersClient(dependencies: {
  request: DomainRequest;
  publicRequest?: DomainRequest;
  scope: SessionScope;
}) {
  const generation = dependencies.scope.snapshot(),
    signal = dependencies.scope.signal();
  const ensure = () => {
    if (!dependencies.scope.isCurrent(generation))
      throw new ApiError("UNAUTHENTICATED", "이용 계정이 변경됐어요. 다시 확인해 주세요.");
    signal.throwIfAborted();
  };
  const request: DomainRequest = async <T>(path: string, init: DomainRequestInit = {}) => {
    ensure();
    try {
      const result = await dependencies.request<T>(path, {
        ...init,
        signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
      });
      ensure();
      return result;
    } catch (error) {
      ensure();
      throw error;
    }
  };
  const publicRequest: DomainRequest = async <T>(path: string, init: DomainRequestInit = {}) => {
    init.signal?.throwIfAborted();
    try {
      const result = await (dependencies.publicRequest ?? dependencies.request)<T>(path, init);
      init.signal?.throwIfAborted();
      return result;
    } catch (error) {
      init.signal?.throwIfAborted();
      throw error;
    }
  };
  const directory = createDirectoryClient((options) =>
    publicRequest(options.path, {
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );
  const client = {
    listPage: (filters: DirectoryFilters = {}, cursor?: string, signal?: AbortSignal) =>
      directory.listPage(filters, cursor, signal),
    async list(filters: DirectoryFilters = {}, signal?: AbortSignal) {
      return (await directory.listPage(filters, undefined, signal)).items;
    },
    async get(id: string, signal?: AbortSignal): Promise<LawyerView> {
      const init = signal ? { signal } : {};
      signal?.throwIfAborted();
      try {
        const value = await publicRequest(
          `/api/v2/lawyers/self-service/${encodeURIComponent(id)}`,
          init,
        );
        signal?.throwIfAborted();
        return decode(selfProfileSchema, value);
      } catch (error) {
        signal?.throwIfAborted();
        if (!(error instanceof ApiError) || error.code !== "NOT_FOUND") throw error;
        const value = await publicRequest(`/api/v2/lawyers/${encodeURIComponent(id)}`, init);
        signal?.throwIfAborted();
        return fromVerified(decode(v2PublicLawyerSchema, value));
      }
    },
    async getMine(): Promise<LawyerView> {
      return decode(selfProfileSchema, await request("/api/v2/me/lawyer/self-profile"));
    },
    async saveMine(profile: LawyerView): Promise<LawyerView> {
      const parsed = selfProfileSchema.safeParse(profile);
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "프로필 입력을 확인해 주세요.");
      return decode(
        selfProfileSchema,
        await request("/api/v2/me/lawyer/self-profile", {
          method: "PUT",
          body: { profile: parsed.data },
        }),
      );
    },
    async publishMine(
      published: boolean,
      current?: Pick<LawyerView, "id" | "revision">,
    ): Promise<LawyerView> {
      const mine = current ?? (await client.getMine());
      return decode(
        selfProfileSchema,
        await request("/api/v2/me/lawyer/self-profile/publication", {
          method: "POST",
          body: {
            published,
            profileId: mine.id,
            expectedRevision: mine.revision,
            consent: published,
          },
        }),
      );
    },
  };
  return client;
}
