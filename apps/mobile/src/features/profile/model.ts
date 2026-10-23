import {
  ApiError,
  type createLawyerAssetsClient,
  type createLawyersClient,
  errorMessage,
  type LawyerAssetView,
  validateLawyerUpload,
} from "@baro/api-client";
import { v2LegalFieldSchema, v2RegionSchema } from "@baro/contracts/v2";
import {
  isDuplicateProfileSave,
  profileReady,
  type SelfProfile,
  selfAssetUrl,
  selfProfileSchema,
} from "@baro/contracts/v2/self-profile";
import type { PrivateDownload } from "../../platform/files/download";
import type { NativeUploadSource } from "../../platform/files/upload-reader";
import type { SessionModel } from "../session/model";

export interface ProfilePorts {
  profile: Pick<ReturnType<typeof createLawyersClient>, "getMine" | "saveMine" | "publishMine">;
  assets: ReturnType<typeof createLawyerAssetsClient<NativeUploadSource, PrivateDownload>>;
}
type Purpose = "profile_photo" | "portfolio";
type Intent =
  | { kind: "save"; profile: SelfProfile }
  | { kind: "publish"; profile: SelfProfile; published: boolean }
  | { kind: "remove"; profile: SelfProfile; asset: LawyerAssetView };
export type ProfileField =
  | "name"
  | "introduction"
  | "officeName"
  | "address"
  | "phone"
  | "email"
  | "website";
export interface ProfileState {
  gate: "checking" | "login" | "role" | "ready" | "error";
  canWrite: boolean;
  profile: SelfProfile | null;
  draft: SelfProfile | null;
  assets: LawyerAssetView[];
  selected: { name: string; size: number; purpose: Purpose } | null;
  download: { value: PrivateDownload; name: string; mimeType: string } | null;
  busy: "load" | "save" | "publish" | "select" | "upload" | "preview" | "present" | "remove" | null;
  uncertain: Intent["kind"] | null;
  conflict: boolean;
  confirm:
    | { kind: "reload" }
    | { kind: "publish"; published: boolean }
    | { kind: "remove"; assetId: string; revision: number }
    | null;
  publicationConsent: boolean;
  confirmation: string;
  error: string | null;
  notice: string | null;
}
const empty = (): ProfileState => ({
  gate: "checking",
  canWrite: false,
  profile: null,
  draft: null,
  assets: [],
  selected: null,
  download: null,
  busy: null,
  uncertain: null,
  conflict: false,
  confirm: null,
  publicationConsent: false,
  confirmation: "",
  error: null,
  notice: null,
});
const clone = <T>(value: T): T => structuredClone(value);
export function profileDirty(state: ProfileState) {
  return (
    !!state.profile &&
    !!state.draft &&
    JSON.stringify(state.profile) !== JSON.stringify(state.draft)
  );
}
export function assetReferenced(profile: SelfProfile | null, id: string) {
  return profile?.photoAssetId === id || !!profile?.portfolio.some((item) => item.assetId === id);
}
export function createProfileModel(dependencies: {
  session: Pick<SessionModel, "getSnapshot" | "subscribe" | "refresh">;
  createClient(signal: AbortSignal, ownerId: string): ProfilePorts;
  select(signal: AbortSignal): Promise<NativeUploadSource | null>;
  release(source: NativeUploadSource): Promise<void>;
  discard(value: PrivateDownload): Promise<void>;
  present(
    value: PrivateDownload,
    mode: "open" | "share",
    input: { name: string; mimeType: string },
    ensure: () => void,
  ): Promise<void>;
  newId(): string;
}) {
  let state = empty(),
    active = false,
    owner: string | undefined,
    version = 0;
  let controller: AbortController | undefined,
    picker: AbortController | undefined,
    client: ProfilePorts | undefined;
  let source: NativeUploadSource | undefined, intent: Intent | undefined;
  let pickerOwner: string | undefined;
  let memory: { owner: string; draft: SelfProfile; intent?: Intent } | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ProfileState) => {
    state = next;
    for (const notify of listeners) notify();
  };
  const current = (captured: number) =>
    active && version === captured && !controller?.signal.aborted && state.gate === "ready";
  const keep = () => {
    if (owner && state.draft)
      memory = { owner, draft: clone(state.draft), ...(intent ? { intent: clone(intent) } : {}) };
  };
  const dropSource = () => {
    const old = source;
    source = undefined;
    if (old) void dependencies.release(old).catch(() => {});
  };
  const dropDownload = () => {
    const old = state.download?.value;
    if (old) void dependencies.discard(old).catch(() => {});
  };
  const retire = () => {
    version++;
    controller?.abort();
    client = undefined;
    dropSource();
    dropDownload();
  };
  const retirePicker = () => {
    picker?.abort();
    picker = undefined;
    pickerOwner = undefined;
  };
  const editable = () =>
    active && state.gate === "ready" && state.canWrite && !!state.draft && !state.busy && !intent;
  function fail(error: unknown) {
    // The shared error adapter intentionally maps server ROLE_REQUIRED to NOT_FOUND.
    // Hide private input until a fresh session authorizes this owner again.
    if (error instanceof ApiError && ["UNAUTHENTICATED", "NOT_FOUND"].includes(error.code)) {
      retirePicker();
      retire();
      memory = undefined;
      owner = undefined;
      intent = undefined;
      publish(empty());
      void dependencies.session.refresh();
      return;
    }
    const consent = error instanceof ApiError && error.code === "CONSENT_REQUIRED";
    publish({
      ...state,
      busy: null,
      confirm: null,
      confirmation: "",
      publicationConsent: false,
      uncertain: intent?.kind ?? null,
      conflict: state.conflict || (error instanceof ApiError && error.code === "CONFLICT"),
      error: errorMessage(error),
      canWrite: consent ? false : state.canWrite,
    });
    if (consent) void dependencies.session.refresh();
  }
  const receipt = (profile: SelfProfile, assets: LawyerAssetView[]) => {
    if (!intent) return false;
    if (intent.profile.id !== profile.id) return false;
    if (intent.kind === "save") return isDuplicateProfileSave(profile, intent.profile);
    if (intent.kind === "publish")
      return (
        profile.revision === intent.profile.revision + 1 && profile.published === intent.published
      );
    const id = intent.asset.id;
    return !assets.some((asset) => asset.id === id);
  };
  async function refresh() {
    if (!active || state.gate !== "ready" || !client || (state.busy && state.busy !== "load"))
      return;
    keep();
    const api = client,
      captured = ++version;
    dropDownload();
    publish({
      ...state,
      profile: null,
      assets: [],
      download: null,
      busy: "load",
      confirm: null,
      error: null,
    });
    try {
      const [raw, assets] = await Promise.all([api.profile.getMine(), api.assets.list()]);
      if (!current(captured)) return;
      const profile = selfProfileSchema.parse(raw);
      const remembered =
        memory && memory.owner === owner && memory.draft.id === profile.id ? memory : undefined;
      intent = remembered?.intent;
      const confirmed = receipt(profile, assets);
      const confirmedKind = confirmed ? intent?.kind : undefined;
      const draft =
        remembered && (!confirmed || confirmedKind === "remove")
          ? clone(remembered.draft)
          : clone(profile);
      if (confirmed) intent = undefined;
      publish({
        ...state,
        profile,
        draft,
        assets,
        busy: picker ? "select" : null,
        uncertain: intent?.kind ?? null,
        conflict: draft.revision !== profile.revision,
        notice: confirmed
          ? confirmedKind === "remove"
            ? "자료 삭제 접수 상태를 확인했어요. 원격 정리는 별도로 진행돼요."
            : "서버에서 이전 요청의 현재 저장 상태를 확인했어요."
          : state.notice,
      });
      keep();
    } catch (error) {
      if (current(captured)) fail(error);
    }
  }
  function observe() {
    if (!active) return;
    const session = dependencies.session.getSnapshot(),
      user = session.session?.user;
    if (session.phase === "checking") {
      keep();
      retire();
      owner = undefined;
      publish(empty());
      return;
    }
    if (!user || !["ready", "consent"].includes(session.phase) || user.accountType !== "lawyer") {
      retirePicker();
      retire();
      owner = undefined;
      memory = undefined;
      intent = undefined;
      publish({
        ...empty(),
        gate:
          session.phase === "anonymous"
            ? "login"
            : session.phase === "error"
              ? "error"
              : user
                ? "role"
                : "checking",
      });
      return;
    }
    const canWrite = !session.session?.needsConsent && session.phase === "ready";
    if (picker && (pickerOwner !== user.id || !canWrite)) retirePicker();
    if (owner === user.id && client && state.canWrite === canWrite) return;
    if (owner === user.id) keep();
    retire();
    owner = user.id;
    if (memory?.owner !== owner) {
      memory = undefined;
      intent = undefined;
    }
    controller = new AbortController();
    publish({ ...empty(), gate: "ready", canWrite });
    try {
      client = dependencies.createClient(controller.signal, owner);
      void refresh();
    } catch {
      fail(new ApiError("UNAVAILABLE", "앱의 프로필 설정을 확인하지 못했어요.", true));
    }
  }
  async function waitForOwner(expected: string, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let unsubscribe = () => {};
      const done = (error?: unknown) => {
        unsubscribe();
        signal.removeEventListener("abort", cancelled);
        error ? reject(error) : resolve();
      };
      const cancelled = () => done(new ApiError("UNAUTHENTICATED", "파일 선택을 중단했어요."));
      const inspect = () => {
        if (!active || signal.aborted) return cancelled();
        const session = dependencies.session.getSnapshot();
        if (session.phase === "ready")
          return session.session?.user?.id === expected &&
            session.session.user.accountType === "lawyer" &&
            !session.session.needsConsent
            ? done()
            : cancelled();
        if (session.phase !== "checking") cancelled();
      };
      unsubscribe = dependencies.session.subscribe(inspect);
      signal.addEventListener("abort", cancelled, { once: true });
      inspect();
    });
  }
  async function execute(action: Intent) {
    if (!current(version) || !state.canWrite || !client || state.busy) return;
    const api = client,
      captured = version;
    intent = clone(action);
    keep();
    publish({
      ...state,
      busy: action.kind,
      confirm: null,
      confirmation: "",
      publicationConsent: false,
      error: null,
      uncertain: action.kind,
    });
    try {
      let profile: SelfProfile;
      if (action.kind === "save")
        profile = selfProfileSchema.parse(await api.profile.saveMine(clone(action.profile)));
      else if (action.kind === "publish")
        profile = selfProfileSchema.parse(
          await api.profile.publishMine(action.published, action.profile),
        );
      else {
        await api.assets.remove(action.asset.id, action.asset.revision);
        if (!current(captured)) return;
        publish({ ...state, busy: null });
        await refresh();
        return;
      }
      if (!current(captured)) return;
      if (
        profile.id !== action.profile.id ||
        profile.revision !== action.profile.revision + 1 ||
        (action.kind === "save"
          ? !isDuplicateProfileSave(profile, action.profile)
          : profile.published !== action.published)
      )
        throw new ApiError(
          "CONFLICT",
          "프로필 상태가 바뀌었어요. 현재 저장 상태를 다시 확인해 주세요.",
        );
      intent = undefined;
      memory = undefined;
      publish({
        ...state,
        profile,
        draft: clone(profile),
        busy: null,
        uncertain: null,
        conflict: false,
        notice:
          action.kind === "save"
            ? "프로필을 저장했어요."
            : action.published
              ? "프로필을 공개했어요."
              : "프로필 공개를 철회했어요.",
      });
      keep();
    } catch (error) {
      if (current(captured)) fail(error);
    }
  }
  const model = {
    getSnapshot: () => state,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    start() {
      active = true;
      const unsubscribe = dependencies.session.subscribe(observe);
      observe();
      return () => {
        active = false;
        unsubscribe();
        retirePicker();
        retire();
        owner = undefined;
        memory = undefined;
        intent = undefined;
        publish(empty());
      };
    },
    refresh,
    field(name: ProfileField, value: string) {
      if (
        ["name", "introduction", "officeName", "address", "phone", "email", "website"].includes(
          name,
        ) &&
        editable() &&
        state.draft
      )
        publish({ ...state, draft: { ...state.draft, [name]: value }, error: null });
    },
    region(value: string) {
      if (editable() && state.draft && (value === "" || v2RegionSchema.safeParse(value).success))
        publish({ ...state, draft: { ...state.draft, region: value as SelfProfile["region"] } });
    },
    practice(value: string) {
      const parsed = v2LegalFieldSchema.safeParse(value);
      if (!editable() || !state.draft || !parsed.success) return;
      const fields = state.draft.practiceAreas.includes(parsed.data)
        ? state.draft.practiceAreas.filter((item) => item !== parsed.data)
        : [...state.draft.practiceAreas, parsed.data];
      publish({ ...state, draft: { ...state.draft, practiceAreas: fields } });
    },
    removePhoto() {
      if (editable() && state.draft)
        publish({ ...state, draft: { ...state.draft, photoAssetId: null, photoUrl: null } });
    },
    addPortfolio() {
      if (!editable() || !state.draft || state.draft.portfolio.length >= 30) return;
      publish({
        ...state,
        draft: {
          ...state.draft,
          portfolio: [
            ...state.draft.portfolio,
            { id: dependencies.newId(), title: "새 소개 자료", text: "", url: null },
          ],
        },
      });
    },
    portfolio(id: string, field: "title" | "text" | "url", value: string) {
      if (!editable() || !state.draft) return;
      publish({
        ...state,
        draft: {
          ...state.draft,
          portfolio: state.draft.portfolio.map((item) =>
            item.id !== id || (field === "url" && item.assetId)
              ? item
              : { ...item, [field]: value || (field === "url" ? null : "") },
          ),
        },
      });
    },
    removePortfolio(id: string) {
      if (editable() && state.draft)
        publish({
          ...state,
          draft: {
            ...state.draft,
            portfolio: state.draft.portfolio.filter((item) => item.id !== id),
          },
        });
    },
    attach(id: string) {
      if (!editable() || !state.draft) return;
      const asset = state.assets.find((item) => item.id === id && item.status === "ready");
      if (!asset) return;
      const draft = clone(state.draft),
        url = selfAssetUrl(draft.id, id);
      if (asset.purpose === "profile_photo") {
        draft.photoAssetId = id;
        draft.photoUrl = url;
      } else if (
        asset.purpose === "portfolio" &&
        draft.portfolio.length < 30 &&
        !draft.portfolio.some((item) => item.assetId === id)
      )
        draft.portfolio.push({
          id: dependencies.newId(),
          title: "포트폴리오 자료",
          assetId: id,
          url,
        });
      else return;
      publish({ ...state, draft, notice: "자료를 선택했어요. 프로필을 저장해야 적용돼요." });
    },
    async save() {
      if (!editable() || !state.draft || state.conflict || !profileDirty(state)) return;
      const parsed = selfProfileSchema.safeParse(state.draft);
      if (!parsed.success) {
        publish({
          ...state,
          error: "프로필 입력을 확인해 주세요. 연락처·분야·소개 자료의 형식을 확인해 주세요.",
        });
        return;
      }
      await execute({ kind: "save", profile: parsed.data });
    },
    requestPublication(published: boolean) {
      if (
        !editable() ||
        !state.profile ||
        profileDirty(state) ||
        state.profile.published === published
      )
        return;
      if (published && !profileReady(state.profile)) {
        publish({
          ...state,
          error: "이름·소개·사무소·주소·지역·분야와 연락처를 먼저 완성해 저장해 주세요.",
        });
        return;
      }
      publish({ ...state, confirm: { kind: "publish", published }, publicationConsent: false });
    },
    requestReload() {
      if (active && !state.busy) publish({ ...state, confirm: { kind: "reload" } });
    },
    requestRemove(id: string) {
      const asset = state.assets.find((item) => item.id === id);
      if (
        !editable() ||
        !asset ||
        !state.profile ||
        assetReferenced(state.profile, id) ||
        assetReferenced(state.draft, id)
      )
        return;
      publish({
        ...state,
        confirm: { kind: "remove", assetId: id, revision: asset.revision },
        confirmation: "",
      });
    },
    publicationConsent(value: boolean) {
      if (!state.busy) publish({ ...state, publicationConsent: value });
    },
    confirmation(value: string) {
      if (!state.busy) publish({ ...state, confirmation: value.slice(0, 6) });
    },
    cancelConfirm() {
      if (!state.busy)
        publish({ ...state, confirm: null, confirmation: "", publicationConsent: false });
    },
    async confirmAction() {
      if (state.busy || !state.confirm) return;
      const action = state.confirm;
      if (action.kind === "reload") {
        intent = undefined;
        memory = undefined;
        dropSource();
        publish({
          ...state,
          draft: null,
          selected: null,
          confirm: null,
          uncertain: null,
          conflict: false,
        });
        await refresh();
        return;
      }
      if (!state.profile) return;
      if (action.kind === "publish") {
        if (action.published && !state.publicationConsent) return;
        await execute({
          kind: "publish",
          profile: clone(state.profile),
          published: action.published,
        });
      } else if (state.confirmation === "DELETE") {
        const asset = state.assets.find(
          (item) => item.id === action.assetId && item.revision === action.revision,
        );
        if (
          asset &&
          !assetReferenced(state.profile, asset.id) &&
          !assetReferenced(state.draft, asset.id)
        )
          await execute({ kind: "remove", profile: clone(state.profile), asset: clone(asset) });
      }
    },
    async retryUnconfirmed() {
      if (intent && !state.busy && state.profile?.id === intent.profile.id)
        await execute(clone(intent));
    },
    async select(purpose: Purpose) {
      if (!editable() || !owner) return;
      const expected = owner,
        selection = new AbortController();
      picker = selection;
      pickerOwner = expected;
      dropSource();
      publish({ ...state, selected: null, busy: "select", error: null });
      let selected: NativeUploadSource | null = null;
      try {
        selected = await dependencies.select(selection.signal);
        selection.signal.throwIfAborted();
        if (!active || picker !== selection) throw new Error("PICK_RETIRED");
        await waitForOwner(expected, selection.signal);
        if (!active || picker !== selection || owner !== expected) throw new Error("PICK_RETIRED");
        if (selected) validateLawyerUpload(selected, purpose);
        source = selected ?? undefined;
        publish({
          ...state,
          selected: selected ? { name: selected.name, size: selected.size, purpose } : null,
          busy: state.busy === "load" ? "load" : null,
        });
        selected = null;
      } catch (error) {
        if (selected) await dependencies.release(selected).catch(() => {});
        if (active && picker === selection && owner === expected && state.gate === "ready")
          fail(error);
      } finally {
        if (picker === selection) {
          picker = undefined;
          pickerOwner = undefined;
          if (state.busy === "select") publish({ ...state, busy: null });
        }
      }
    },
    clearSelection() {
      if (!state.busy) {
        dropSource();
        publish({ ...state, selected: null });
      }
    },
    async upload() {
      if (!editable() || !source || !state.selected || !state.profile || !client) return;
      const selected = source,
        purpose = state.selected.purpose,
        api = client,
        captured = version;
      publish({ ...state, busy: "upload", error: null });
      try {
        await api.assets.upload(state.profile.id, selected, purpose);
        if (!current(captured)) return;
        source = undefined;
        await dependencies.release(selected).catch(() => {});
        if (!current(captured)) return;
        publish({ ...state, selected: null });
        const assets = await api.assets.list();
        if (!current(captured)) return;
        publish({
          ...state,
          selected: null,
          assets,
          busy: null,
          notice: "업로드 상태를 확인했어요. 처리가 완료된 자료를 프로필에 선택해 주세요.",
        });
      } catch (error) {
        if (current(captured)) fail(error);
      }
    },
    async preview(id: string) {
      if (!active || state.gate !== "ready" || state.busy || !client || !state.profile) return;
      const asset = state.assets.find((item) => item.id === id && item.status === "ready");
      if (!asset) return;
      const api = client,
        captured = version;
      dropDownload();
      publish({ ...state, download: null, busy: "preview", error: null });
      let value: PrivateDownload | undefined;
      try {
        value = await api.assets.blob(state.profile.id, id, true);
        if (!current(captured)) {
          await dependencies.discard(value);
          return;
        }
        if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(value.mimeType))
          throw new ApiError("UNAVAILABLE", "지원하는 자료 형식을 확인하지 못했어요.");
        publish({
          ...state,
          download: {
            value,
            mimeType: value.mimeType,
            name:
              value.mimeType === "application/pdf"
                ? "프로필 자료.pdf"
                : `프로필 사진.${value.mimeType.split("/")[1]}`,
          },
          busy: null,
        });
      } catch (error) {
        if (value) await dependencies.discard(value).catch(() => {});
        if (current(captured)) fail(error);
      }
    },
    async present(mode: "open" | "share") {
      if (!state.download || state.busy || !active) return;
      const download = state.download,
        captured = version;
      publish({ ...state, busy: "present", error: null });
      const ensure = () => {
        if (!current(captured)) throw new ApiError("UNAUTHENTICATED", "이용 상태가 변경됐어요.");
      };
      try {
        ensure();
        await dependencies.present(download.value, mode, download, ensure);
        if (current(captured)) publish({ ...state, download: null, busy: null });
      } catch (error) {
        if (current(captured)) fail(error);
      } finally {
        await dependencies.discard(download.value).catch(() => {});
        if (current(captured)) publish({ ...state, download: null });
      }
    },
    cancel() {
      if (!active) return;
      keep();
      retirePicker();
      retire();
      owner = undefined;
      publish({
        ...empty(),
        notice: "요청 확인을 중단했어요. 서버에서 처리됐을 수 있어 현재 상태를 다시 확인해요.",
      });
      observe();
    },
  };
  return model;
}
export type ProfileModel = ReturnType<typeof createProfileModel>;
