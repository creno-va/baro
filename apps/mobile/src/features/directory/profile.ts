import { ApiError, errorMessage, type LawyerView } from "@baro/api-client";
import { opaqueIdSchema } from "@baro/contracts/common";
import { v2ExternalConsultationUrlSchema } from "@baro/contracts/v2/lawyers";

export type ProfileAction =
  | { kind: "phone" | "email" | "website" | "photo" }
  | { kind: "portfolio"; id: string };
export interface PublicProfileState {
  phase: "idle" | "loading" | "ready" | "error";
  id: string;
  profile: LawyerView | null;
  error: string | null;
  opening: boolean;
  actionError: string | null;
}
const invalidLink = () =>
  new ApiError("VALIDATION_ERROR", "공개 연락처나 자료 링크를 확인할 수 없어요.");
/** Public profile fields only. Never attach a case, message, session or credentials to an OS URL. */
export function publicProfileUrl(
  profile: LawyerView,
  action: ProfileAction,
  apiOrigin: string,
): string {
  if (action.kind === "phone") {
    if (!/^\+?[0-9][0-9 ()-]{6,29}$/.test(profile.phone)) throw invalidLink();
    return `tel:${profile.phone.replace(/[ ()-]/g, "")}`;
  }
  if (action.kind === "email") {
    // The shared profile decoder validates email; forbid URI control/delimiter injection as well.
    if (!profile.email || /[\s?&#\r\n\0]/.test(profile.email)) throw invalidLink();
    return `mailto:${encodeURIComponent(profile.email)}`;
  }
  let value: string | null | undefined;
  if (action.kind === "portfolio") {
    const id = action.id;
    value = profile.portfolio.find((item) => item.id === id)?.url;
  } else value = action.kind === "website" ? profile.website : profile.photoUrl;
  if (!value) throw invalidLink();
  if (value.startsWith("/")) {
    if (!opaqueIdSchema.safeParse(profile.id).success) throw invalidLink();
    const prefix =
      profile.verificationStatus === "verified" && !value.includes("/self-service/")
        ? `/api/v2/lawyers/${profile.id}/assets/`
        : `/api/v2/lawyers/self-service/${profile.id}/assets/`;
    if (!value.startsWith(prefix) || !opaqueIdSchema.safeParse(value.slice(prefix.length)).success)
      throw invalidLink();
    return new URL(value, apiOrigin).href;
  }
  if (action.kind === "photo" || !v2ExternalConsultationUrlSchema.safeParse(value).success)
    throw invalidLink();
  return value;
}

/** No settled authorization: every refresh and explicit external action reads public authority again. */
export function createPublicProfileModel(dependencies: {
  get(id: string, signal: AbortSignal): Promise<LawyerView>;
  apiOrigin: string;
  openUrl(url: string): Promise<unknown>;
}) {
  let state: PublicProfileState = {
    phase: "idle",
    id: "",
    profile: null,
    error: null,
    opening: false,
    actionError: null,
  };
  let generation = 0,
    controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: PublicProfileState) => {
    state = next;
    for (const notify of listeners) notify();
  };
  async function load(id: string, action?: ProfileAction) {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal,
      current = ++generation;
    const ensure = () => {
      signal.throwIfAborted();
      if (current !== generation) throw invalidLink();
    };
    publish({
      phase: "loading",
      id,
      profile: null,
      error: null,
      opening: !!action,
      actionError: null,
    });
    try {
      if (!opaqueIdSchema.safeParse(id).success) throw invalidLink();
      const profile = await dependencies.get(id, signal);
      ensure();
      if (profile.id !== id || !profile.published)
        throw new ApiError("NOT_FOUND", "공개된 프로필을 찾지 못했어요.");
      publish({ ...state, phase: "ready", profile });
      if (action) {
        try {
          const url = publicProfileUrl(profile, action, dependencies.apiOrigin);
          ensure();
          await dependencies.openUrl(url);
          ensure();
          publish({ ...state, opening: false });
        } catch (error) {
          ensure();
          publish({
            ...state,
            opening: false,
            actionError:
              error instanceof ApiError
                ? errorMessage(error)
                : "연락처나 자료를 열지 못했어요. 기기의 연결 앱을 확인해 주세요.",
          });
        }
      }
    } catch (error) {
      if (signal.aborted || current !== generation) return;
      publish({
        ...state,
        phase: "error",
        profile: null,
        opening: false,
        error: errorMessage(error),
      });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    load: (id: string) => load(id),
    open: (action: ProfileAction) =>
      state.phase === "ready" && !state.opening ? load(state.id, action) : Promise.resolve(),
    stop() {
      generation++;
      controller?.abort();
      publish({
        ...state,
        phase: "idle",
        profile: null,
        error: null,
        opening: false,
        actionError: null,
      });
    },
  };
}
