import { expect, test } from "bun:test";
import { ApiError, type LawyerAssetView } from "@baro/api-client";
import { emptySelfProfile, type SelfProfile } from "@baro/contracts/v2/self-profile";
import {
  createProfileModel,
  type ProfileField,
  profileDirty,
} from "../apps/mobile/src/features/profile/model";
import type { SessionState } from "../apps/mobile/src/features/session/model";

const session = (id = "owner_a"): SessionState => ({
  phase: "ready",
  busy: false,
  role: "lawyer",
  error: null,
  consent: null,
  session: { user: { id, name: "합성 변호사", accountType: "lawyer" }, needsConsent: false },
});
const profile = (id = "profile_a"): SelfProfile => ({
  ...emptySelfProfile(id, "합성 변호사"),
  introduction: "합성 소개",
  officeName: "합성 사무소",
  address: "합성 주소",
  region: "seoul",
  practiceAreas: ["civil"],
  email: "synthetic@example.invalid",
});
const asset = (status = "ready"): LawyerAssetView => ({
  id: "asset_a",
  revision: 2,
  status,
  purpose: "profile_photo",
  kind: "image",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value: T) => resolve(value),
  };
}
async function until(ready: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise((done) => setTimeout(done, 1));
  }
  throw new Error("SYNTHETIC_PROFILE_DID_NOT_ADVANCE");
}
function fixture() {
  let currentSession = session(),
    mode = "",
    picks: Promise<{ name: string; size: number; type: string } | null> | undefined,
    saveWait: Promise<void> | undefined;
  const profiles = new Map([
      ["owner_a", profile()],
      ["owner_b", profile("profile_b")],
    ]),
    assets = [asset()];
  const listeners = new Set<() => void>(),
    calls: { owner: string; kind: string; body?: unknown }[] = [],
    signals: AbortSignal[] = [];
  let releases = 0,
    discarded = 0,
    presented = 0,
    sessionReads = 0;
  const selected = Object.freeze({ name: "합성 사진.png", type: "image/png", size: 3 });
  const model = createProfileModel({
    session: {
      getSnapshot: () => currentSession,
      subscribe: (notify) => {
        listeners.add(notify);
        return () => {
          listeners.delete(notify);
        };
      },
      refresh: async () => {
        sessionReads++;
      },
    },
    createClient: (signal, owner) => {
      signals.push(signal);
      const read = () => structuredClone(profiles.get(owner) ?? profile("profile_unknown"));
      const log = (kind: string, body?: unknown) => {
        calls.push({ owner, kind, ...(body === undefined ? {} : { body: structuredClone(body) }) });
      };
      return {
        profile: {
          getMine: async () => {
            log("read");
            if (mode === "read-error") throw new ApiError("UNAVAILABLE", "합성 읽기 실패", true);
            return read();
          },
          saveMine: async (incoming) => {
            log("save", incoming);
            await saveWait;
            if (mode === "before-save") throw new ApiError("UNAVAILABLE", "합성 응답 유실", true);
            const current = read();
            if (incoming.id !== current.id || incoming.revision !== current.revision)
              throw new ApiError("CONFLICT", "합성 충돌");
            const next = {
              ...structuredClone(incoming),
              revision: incoming.revision + 1,
              published: current.published,
              verificationStatus: "self_declared" as const,
            } as SelfProfile;
            profiles.set(owner, next);
            if (mode === "drop-save") throw new ApiError("UNAVAILABLE", "합성 ACK 유실", true);
            return next;
          },
          publishMine: async (published, basis) => {
            log("publish", { published, basis });
            const current = read();
            if (basis?.revision !== current.revision) throw new ApiError("CONFLICT", "합성 충돌");
            const next = { ...current, published, revision: current.revision + 1 };
            profiles.set(owner, next);
            if (mode === "drop-publish") throw new ApiError("UNAVAILABLE", "합성 ACK 유실", true);
            return next;
          },
        },
        assets: {
          list: async () => {
            log("assets");
            return owner === "owner_a" ? structuredClone(assets) : [];
          },
          upload: async (_id, source, purpose) => {
            log("upload", { source, purpose });
            assets.splice(0, assets.length, asset("uploaded"));
            return asset("uploaded");
          },
          remove: async (id, revision) => {
            log("remove", { id, revision });
            const i = assets.findIndex((item) => item.id === id);
            if (i >= 0) assets.splice(i, 1);
            if (mode === "drop-remove") throw new ApiError("UNAVAILABLE", "합성 ACK 유실", true);
          },
          blob: async () => {
            log("blob");
            return {
              size: 5,
              sha256: "a".repeat(64),
              mimeType: mode === "mime" ? "text/html" : "image/png",
            };
          },
        },
      };
    },
    select: async () => (picks ? await picks : selected),
    release: async () => {
      releases++;
    },
    discard: async () => {
      discarded++;
    },
    present: async (_value, _mode, _input, ensure) => {
      ensure();
      presented++;
    },
    newId: () => crypto.randomUUID(),
  });
  return {
    model,
    calls,
    signals,
    assets,
    profiles,
    selected,
    stop: model.start(),
    setSession: (next: SessionState) => {
      currentSession = next;
      for (const notify of listeners) notify();
    },
    mode: (value: string) => {
      mode = value;
    },
    picks: (value: typeof picks) => {
      picks = value;
    },
    saveWait: (value: Promise<void>) => {
      saveWait = value;
    },
    counts: () => ({ releases, discarded, presented, sessionReads }),
  };
}
const loaded = (f: ReturnType<typeof fixture>) =>
  until(() => f.model.getSnapshot().busy === null && !!f.model.getSnapshot().profile);

test("native own profile retains original revision, validates editable fields and saves without changing identity/verification", async () => {
  const f = fixture();
  await loaded(f);
  expect(f.calls.some((call) => call.kind === "save")).toBe(false);
  f.model.field("revision" as ProfileField, "99");
  f.model.field("name", "수정된 합성 이름");
  await f.model.save();
  expect(f.model.getSnapshot().profile).toMatchObject({
    id: "profile_a",
    revision: 2,
    name: "수정된 합성 이름",
    verificationStatus: "self_declared",
  });
  expect(f.calls.find((call) => call.kind === "save")?.body).toMatchObject({ revision: 1 });
  expect(profileDirty(f.model.getSnapshot())).toBe(false);
  f.stop();
});
test("publication requires clean saved profile plus explicit disclosure consent; withdrawal uses its original revision", async () => {
  const f = fixture();
  await loaded(f);
  f.model.field("officeName", "수정");
  f.model.requestPublication(true);
  expect(f.model.getSnapshot().confirm).toBeNull();
  await f.model.save();
  f.model.requestPublication(true);
  await f.model.confirmAction();
  expect(f.calls.some((call) => call.kind === "publish")).toBe(false);
  f.model.publicationConsent(true);
  await f.model.confirmAction();
  expect(f.model.getSnapshot().profile?.published).toBe(true);
  f.model.requestPublication(false);
  await f.model.confirmAction();
  expect(f.model.getSnapshot().profile?.published).toBe(false);
  expect(
    f.calls
      .filter((call) => call.kind === "publish")
      .map((call) => (call.body as { basis: { revision: number } }).basis.revision),
  ).toEqual([2, 3]);
  f.stop();
});
test("lost save/publication ACK freezes a copy and fresh reads resolve committed state without an automatic second mutation", async () => {
  for (const kind of ["save", "publish"] as const) {
    const f = fixture();
    await loaded(f);
    f.mode(`drop-${kind}`);
    if (kind === "save") {
      f.model.field("name", "유실 응답 합성 이름");
      await f.model.save();
    } else {
      f.model.requestPublication(true);
      f.model.publicationConsent(true);
      await f.model.confirmAction();
    }
    expect(f.model.getSnapshot().uncertain).toBe(kind);
    f.model.field("name", "덮어쓰면 안 됨");
    await f.model.refresh();
    expect(f.model.getSnapshot().uncertain).toBeNull();
    expect(f.calls.filter((call) => call.kind === kind)).toHaveLength(1);
    f.stop();
  }
});
test("explicit save retry preserves the exact old body; unrelated newer server revision keeps draft and requires discard confirmation", async () => {
  const f = fixture();
  await loaded(f);
  f.mode("before-save");
  f.model.field("name", "보관할 합성 입력");
  await f.model.save();
  f.mode("");
  await f.model.retryUnconfirmed();
  const writes = f.calls.filter((call) => call.kind === "save");
  expect(writes[0]?.body).toEqual(writes[1]?.body);
  f.model.field("name", "다음 입력");
  const server = f.profiles.get("owner_a");
  if (!server) throw new Error("MISSING_FIXTURE");
  f.profiles.set("owner_a", { ...server, revision: 3, name: "다른 화면 입력" });
  await f.model.refresh();
  expect(f.model.getSnapshot()).toMatchObject({
    conflict: true,
    draft: { revision: 2, name: "다음 입력" },
    profile: { revision: 3 },
  });
  await f.model.save();
  expect(f.calls.filter((call) => call.kind === "save")).toHaveLength(2);
  f.model.requestReload();
  await f.model.confirmAction();
  expect(f.model.getSnapshot().draft?.name).toBe("다른 화면 입력");
  expect(f.model.getSnapshot().conflict).toBe(false);
  f.stop();
});
test("background checking hides private fields then restores same-owner input; a peer never inherits input or pending intent", async () => {
  const f = fixture();
  await loaded(f);
  f.model.field("name", "비공개 임시 이름");
  f.setSession({ ...session(), phase: "checking", session: null });
  expect(f.model.getSnapshot()).toMatchObject({ gate: "checking", profile: null, draft: null });
  expect(f.signals[0]?.aborted).toBe(true);
  f.setSession(session());
  await loaded(f);
  expect(f.model.getSnapshot().draft?.name).toBe("비공개 임시 이름");
  f.setSession(session("owner_b"));
  await loaded(f);
  expect(f.model.getSnapshot().draft).toMatchObject({ id: "profile_b", name: "합성 변호사" });
  expect(f.model.getSnapshot().assets).toEqual([]);
  f.stop();
});
test("renewed consent preserves reads/ready private preview but cannot save, publish, pick or delete", async () => {
  const f = fixture();
  await loaded(f);
  f.setSession({
    ...session(),
    phase: "consent",
    session: { user: session().session?.user ?? null, needsConsent: true },
  });
  await loaded(f);
  f.model.field("name", "불가");
  await f.model.save();
  await f.model.select("profile_photo");
  f.model.requestRemove("asset_a");
  f.model.requestPublication(true);
  await f.model.preview("asset_a");
  expect(f.calls.some((call) => ["save", "publish", "remove", "upload"].includes(call.kind))).toBe(
    false,
  );
  expect(f.model.getSnapshot().download?.mimeType).toBe("image/png");
  f.stop();
});
test("native picker can cross background only for a fresh same-owner lawyer session and never uploads automatically", async () => {
  const f = fixture(),
    pick = deferred<typeof f.selected | null>();
  await loaded(f);
  f.picks(pick.promise);
  const selected = f.model.select("profile_photo");
  f.setSession({ ...session(), phase: "checking", session: null });
  pick.resolve(f.selected);
  for (let i = 0; i < 15; i++) await Promise.resolve();
  expect(f.model.getSnapshot().selected).toBeNull();
  f.setSession(session());
  await selected;
  await loaded(f);
  expect(f.model.getSnapshot().selected?.name).toBe(f.selected.name);
  expect(f.calls.some((call) => call.kind === "upload")).toBe(false);
  await f.model.upload();
  expect(f.calls.filter((call) => call.kind === "upload")).toHaveLength(1);
  f.stop();
});
test("a picker returning after a peer login is released without publishing metadata or uploading", async () => {
  const f = fixture(),
    pick = deferred<typeof f.selected | null>();
  await loaded(f);
  f.picks(pick.promise);
  const selected = f.model.select("portfolio");
  f.setSession(session("owner_b"));
  pick.resolve(f.selected);
  await selected;
  await loaded(f);
  expect(f.model.getSnapshot().selected).toBeNull();
  expect(f.counts().releases).toBe(1);
  expect(f.calls.some((call) => call.kind === "upload")).toBe(false);
  f.stop();
});
test("only ready assets attach; references must be detached and saved before literal delete, preserving unrelated unsaved edits", async () => {
  const f = fixture();
  await loaded(f);
  await f.model.select("profile_photo");
  await f.model.upload();
  f.model.attach("asset_a");
  expect(f.model.getSnapshot().draft?.photoAssetId).toBeUndefined();
  f.assets[0] = asset();
  await f.model.refresh();
  f.model.attach("asset_a");
  await f.model.save();
  f.model.requestRemove("asset_a");
  expect(f.model.getSnapshot().confirm).toBeNull();
  f.model.removePhoto();
  await f.model.save();
  f.model.field("officeName", "삭제해도 보관할 입력");
  f.model.requestRemove("asset_a");
  f.model.confirmation("delete");
  await f.model.confirmAction();
  expect(f.calls.some((call) => call.kind === "remove")).toBe(false);
  f.model.confirmation("DELETE");
  await f.model.confirmAction();
  expect(f.model.getSnapshot().assets).toEqual([]);
  expect(f.model.getSnapshot().draft?.officeName).toBe("삭제해도 보관할 입력");
  f.stop();
});
test("lost asset-delete ACK is resolved by authoritative absence without another delete", async () => {
  const f = fixture();
  await loaded(f);
  f.mode("drop-remove");
  f.model.requestRemove("asset_a");
  f.model.confirmation("DELETE");
  await f.model.confirmAction();
  expect(f.model.getSnapshot().uncertain).toBe("remove");
  await f.model.refresh();
  expect(f.model.getSnapshot().uncertain).toBeNull();
  expect(f.calls.filter((call) => call.kind === "remove")).toHaveLength(1);
  f.stop();
});
test("native private preview rejects unsupported MIME and presentation retires the opaque handle", async () => {
  const f = fixture();
  await loaded(f);
  f.mode("mime");
  await f.model.preview("asset_a");
  expect(f.model.getSnapshot().download).toBeNull();
  expect(f.counts().discarded).toBe(1);
  f.mode("");
  await f.model.preview("asset_a");
  await f.model.present("open");
  expect(f.counts().presented).toBe(1);
  expect(f.model.getSnapshot().download).toBeNull();
  f.stop();
});
test("late saved response cannot replace a peer's fresh profile", async () => {
  const f = fixture(),
    wait = deferred<void>();
  await loaded(f);
  f.saveWait(wait.promise);
  f.model.field("name", "이전 계정 입력");
  const saving = f.model.save();
  f.setSession(session("owner_b"));
  await loaded(f);
  wait.resolve();
  await saving;
  expect(f.model.getSnapshot().profile?.id).toBe("profile_b");
  expect(f.model.getSnapshot().uncertain).toBeNull();
  f.stop();
});
