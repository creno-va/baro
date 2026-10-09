import { z } from "zod";
import {
  emptySelfProfile,
  isDuplicateProfileSave,
  profileReady,
  selfProfileSchema,
} from "../../../server/modules/lawyers/self-profile-contract";
import { LawyerApiError, type LawyerFilters, type LawyerView, rotateLawyers } from "../lawyers";
import { readStore, registerMockHandlers, requireSession, writeStore } from "./runtime";

export const lawyersFixture: LawyerView[] = [
  {
    ...emptySelfProfile("example-lawyer-seoul", "김예시"),
    introduction:
      "민사와 부동산 사건의 사실관계를 차근차근 정리합니다. API 시연용 합성 프로필입니다.",
    officeName: "예시 법률사무소",
    address: "서울특별시 서초구 서초대로 1",
    region: "seoul",
    practiceAreas: ["civil", "real_estate"],
    email: "seoul@example.invalid",
    website: "https://example.com",
    published: true,
  },
  {
    ...emptySelfProfile("example-lawyer-busan", "박합성"),
    introduction: "노동과 기업 분야를 다룹니다. API 시연용 합성 프로필입니다.",
    officeName: "합성 법률사무소",
    address: "부산광역시 연제구 법원로 1",
    region: "busan",
    practiceAreas: ["labor", "company"],
    email: "busan@example.invalid",
    published: true,
  },
];
export type LawyerMockStore = {
  profiles: LawyerView[];
  owners: Record<string, string>;
  assets?: Record<
    string,
    { ownerId: string; profileId: string; type: string; data: string; purpose: string }
  >;
};
export type LawyerMockContext = {
  read(): LawyerMockStore | null;
  write(state: LawyerMockStore): void;
  session(): Promise<{
    user: null | { id: string; name: string; accountType: string };
    needsConsent: boolean;
  }>;
};
export function createMockLawyers(context: LawyerMockContext) {
  function state() {
    return context.read() ?? { profiles: structuredClone(lawyersFixture), owners: {} };
  }
  const clone = <T>(value: T): T => structuredClone(value);
  const own = async (mutation = true) => {
    const session = await context.session();
    if (session.user?.accountType !== "lawyer")
      throw new LawyerApiError("UNAUTHENTICATED", "변호사 역할로 로그인해 주세요.");
    if (mutation && session.needsConsent)
      throw new LawyerApiError("CONSENT_REQUIRED", "필수 동의를 확인해 주세요.");
    const store = state();
    let id = store.owners[session.user.id];
    if (!id) {
      if (session.needsConsent)
        throw new LawyerApiError(
          "CONSENT_REQUIRED",
          "새 프로필 작성 전 필수 동의를 확인해 주세요.",
        );
      id = crypto.randomUUID();
      store.owners[session.user.id] = id;
      store.profiles.push(emptySelfProfile(id, session.user.name));
      context.write(store);
    }
    const profile = store.profiles.find((p) => p.id === id);
    if (!profile) throw new LawyerApiError("NOT_FOUND", "프로필을 찾을 수 없어요.");
    return { store, profile };
  };
  return {
    async assets() {
      const owner = await own(false);
      return Object.entries(state().assets ?? {})
        .filter(([, a]) => a.profileId === owner.profile.id)
        .map(([id, a]) => ({
          id,
          revision: 1,
          status: "ready",
          purpose: a.purpose,
          kind: a.type === "application/pdf" ? "pdf" : "image",
        }));
    },
    async uploadAsset(input: {
      profileId: string;
      file: File;
      purpose: "profile_photo" | "portfolio";
    }) {
      const owner = await own();
      if (owner.profile.id !== input.profileId)
        throw new LawyerApiError("NOT_FOUND", "본인 프로필만 변경할 수 있어요.");
      if (input.file.size > 1_000_000)
        throw new LawyerApiError("QUOTA_EXCEEDED", "예시 저장소는 파일당 1MB까지 보관해요.");
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      const data = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
      const checked = await own();
      if (checked.profile.id !== input.profileId)
        throw new LawyerApiError("NOT_FOUND", "계정이 변경됐어요.");
      const store = state(),
        id = crypto.randomUUID();
      store.assets ??= {};
      store.assets[id] = {
        ownerId: (await context.session()).user?.id ?? "",
        profileId: input.profileId,
        type: input.file.type,
        data: btoa(data),
        purpose: input.purpose,
      };
      context.write(store);
      return {
        id,
        revision: 1,
        status: "ready",
        purpose: input.purpose,
        kind: input.file.type === "application/pdf" ? "pdf" : "image",
      };
    },
    async removeAsset(input: { assetId: string }) {
      const owner = await own();
      const store = state();
      if (store.assets?.[input.assetId]?.profileId !== owner.profile.id)
        throw new LawyerApiError("NOT_FOUND", "본인 자료만 삭제할 수 있어요.");
      delete store.assets[input.assetId];
      context.write(store);
    },
    async assetBlob(input: { profileId: string; assetId: string; privateRead: boolean }) {
      const store = state(),
        asset = store.assets?.[input.assetId];
      const profile = store.profiles.find((p) => p.id === input.profileId);
      if (
        !profile ||
        !asset ||
        asset.profileId !== profile.id ||
        (!input.privateRead &&
          !(
            profile.photoAssetId === input.assetId ||
            profile.portfolio.some((p) => p.assetId === input.assetId)
          ))
      )
        throw new LawyerApiError("NOT_FOUND", "공개 자료를 찾지 못했어요.");
      if (input.privateRead) {
        if ((await own(false)).profile.id !== profile.id)
          throw new LawyerApiError("NOT_FOUND", "본인 자료만 볼 수 있어요.");
      } else if (!profile.published)
        throw new LawyerApiError("NOT_FOUND", "공개 자료를 찾지 못했어요.");
      return { data: asset.data, type: asset.type };
    },
    async list(filters: LawyerFilters = {}) {
      return clone(
        rotateLawyers(
          state().profiles.filter(
            (p) =>
              p.published &&
              (!filters.region || p.region === filters.region) &&
              (!filters.practiceArea || p.practiceAreas.includes(filters.practiceArea)) &&
              (!filters.query?.trim() ||
                `${p.name} ${p.officeName}`.includes(filters.query.trim())),
          ),
        ),
      );
    },
    async get(id: string) {
      const p = state().profiles.find((p) => p.id === id && p.published);
      if (!p) throw new LawyerApiError("NOT_FOUND", "공개된 프로필을 찾을 수 없어요.");
      return clone(p);
    },
    async getMine() {
      return clone((await own(false)).profile);
    },
    async saveMine(input: LawyerView) {
      const owner = await own();
      const store = state();
      const profile = store.profiles.find((p) => p.id === owner.profile.id);
      if (!profile) throw new LawyerApiError("NOT_FOUND", "프로필을 찾을 수 없어요.");
      if (profile.id !== input.id)
        throw new LawyerApiError("NOT_FOUND", "본인 프로필만 변경할 수 있어요.");
      const parsed = selfProfileSchema.safeParse(input);
      if (!parsed.success)
        throw new LawyerApiError("VALIDATION_ERROR", "입력 내용을 확인해 주세요.");
      if (isDuplicateProfileSave(selfProfileSchema.parse(profile), parsed.data))
        return clone(profile);
      if (profile.revision !== input.revision)
        throw new LawyerApiError(
          "CONFLICT",
          "다른 화면에서 변경됐어요. 최신 프로필을 불러온 후 다시 저장해 주세요.",
        );
      const references = [
        ...(input.photoAssetId ? [{ id: input.photoAssetId, purpose: "profile_photo" }] : []),
        ...input.portfolio.flatMap((p) =>
          p.assetId ? [{ id: p.assetId, purpose: "portfolio" }] : [],
        ),
      ];
      for (const ref of references) {
        const asset = store.assets?.[ref.id];
        if (!asset || asset.profileId !== profile.id || asset.purpose !== ref.purpose)
          throw new LawyerApiError("NOT_FOUND", "본인 자료만 연결할 수 있어요.");
      }
      const result = selfProfileSchema.safeParse({
        ...input,
        revision: profile.revision + 1,
        published: profile.published,
        verificationStatus: "self_declared",
      });
      if (!result.success || (profile.published && !profileReady(result.data)))
        throw new LawyerApiError(
          "VALIDATION_ERROR",
          "입력 내용을 확인해 주세요. 공개 프로필의 필수 정보는 지울 수 없어요.",
        );
      store.profiles = store.profiles.map((p) => (p.id === profile.id ? result.data : p));
      context.write(store);
      return clone(result.data);
    },
    async publishMine(
      published: boolean,
      current: { profileId: string; expectedRevision: number },
    ) {
      const owner = await own();
      const store = state();
      const profile = store.profiles.find((p) => p.id === owner.profile.id);
      if (!profile) throw new LawyerApiError("NOT_FOUND", "프로필을 찾을 수 없어요.");
      if (!current || profile.id !== current.profileId)
        throw new LawyerApiError("NOT_FOUND", "본인 프로필만 변경할 수 있어요.");
      if (
        profile.revision !== current.expectedRevision &&
        !(profile.revision === current.expectedRevision + 1 && profile.published === published)
      )
        throw new LawyerApiError("CONFLICT", "다른 화면에서 변경됐어요.");
      if (profile.published === published) return clone(profile);
      if (published && !profileReady(selfProfileSchema.parse(profile)))
        throw new LawyerApiError(
          "VALIDATION_ERROR",
          "이름·소개·분야·사무실·지역·주소·연락처를 저장한 뒤 공개해 주세요.",
        );
      const next = {
        ...profile,
        published,
        revision: profile.revision + 1,
        verificationStatus: "self_declared" as const,
      };
      store.profiles = store.profiles.map((p) => (p.id === profile.id ? next : p));
      context.write(store);
      return clone(next);
    },
  };
}
export const mockLawyers = createMockLawyers({
  read() {
    return readStore<LawyerMockStore>("lawyers", {
      profiles: structuredClone(lawyersFixture),
      owners: {},
    });
  },
  write(state) {
    writeStore("lawyers", state);
  },
  async session() {
    return requireSession();
  },
});
export const lawyersMockHandlers = {
  "lawyers.removeAsset": (input: { assetId: string }) => mockLawyers.removeAsset(input),
  "lawyers.assets": () => mockLawyers.assets(),
  "lawyers.uploadAsset": (input: {
    profileId: string;
    file: File;
    purpose: "profile_photo" | "portfolio";
  }) => mockLawyers.uploadAsset(input),
  "lawyers.assetBlob": (input: { profileId: string; assetId: string; privateRead: boolean }) =>
    mockLawyers.assetBlob(input),
  "lawyers.list": (input: unknown) =>
    mockLawyers.list(
      z
        .strictObject({
          region: z.string().optional(),
          practiceArea: z.string().optional(),
          query: z.string().optional(),
        })
        .parse(input ?? {}) as LawyerFilters,
    ),
  "lawyers.get": (input: unknown) =>
    mockLawyers.get(z.strictObject({ id: z.string().min(1).max(128) }).parse(input).id),
  "lawyers.getMine": () => mockLawyers.getMine(),
  "lawyers.saveMine": (input: unknown) => mockLawyers.saveMine(selfProfileSchema.parse(input)),
  "lawyers.publishMine": (input: unknown) =>
    (() => {
      const parsed = z
        .strictObject({
          published: z.boolean(),
          profileId: z.string().min(1),
          expectedRevision: z.number().int().positive(),
        })
        .parse(input);
      return mockLawyers.publishMine(parsed.published, {
        profileId: parsed.profileId,
        expectedRevision: parsed.expectedRevision,
      });
    })(),
};
registerMockHandlers(lawyersMockHandlers);
