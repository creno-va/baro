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
export type LawyerMockStore = { profiles: LawyerView[]; owners: Record<string, string> };
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
  const own = async () => {
    const session = await context.session();
    if (session.user?.accountType !== "lawyer")
      throw new LawyerApiError("UNAUTHENTICATED", "변호사 역할로 로그인해 주세요.");
    if (session.needsConsent)
      throw new LawyerApiError("CONSENT_REQUIRED", "필수 동의를 확인해 주세요.");
    const store = state();
    let id = store.owners[session.user.id];
    if (!id) {
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
      return clone((await own()).profile);
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
    async publishMine(published: boolean) {
      const owner = await own();
      const store = state();
      const profile = store.profiles.find((p) => p.id === owner.profile.id);
      if (!profile) throw new LawyerApiError("NOT_FOUND", "프로필을 찾을 수 없어요.");
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
    mockLawyers.publishMine(z.strictObject({ published: z.boolean() }).parse(input).published),
};
registerMockHandlers(lawyersMockHandlers);
