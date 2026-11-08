import { expect, test } from "bun:test";
import { emptySelfProfile } from "@baro/contracts/v2/self-profile";
import { createMockLawyers, type LawyerMockStore } from "../src/client/api/mock/lawyers";
import {
  mockRequest,
  readStore,
  registerMockHandlers,
  writeStore,
} from "../src/client/api/mock/runtime";

function fixture(withAsset = true) {
  let ownerId = "synthetic-owner";
  let writes = 0;
  const profile = emptySelfProfile("synthetic-profile", "합성 기존 이용자");
  profile.photoAssetId = "owned-asset";
  let store: LawyerMockStore = {
    profiles: withAsset ? [profile] : [],
    owners: withAsset ? { [ownerId]: profile.id } : {},
    assets: withAsset
      ? {
          "owned-asset": {
            ownerId,
            profileId: profile.id,
            type: "image/png",
            data: btoa("synthetic-original"),
            purpose: "profile_photo",
            revision: 3,
          },
        }
      : {},
  };
  const api = createMockLawyers({
    read: () => structuredClone(store),
    write: (value) => {
      writes++;
      store = value;
    },
    session: async () => ({
      user: { id: ownerId, name: "합성 사용자", accountType: "lawyer" },
      needsConsent: true,
    }),
  });
  return {
    api,
    store: () => store,
    writes: () => writes,
    switchOwner: () => {
      ownerId = "foreign";
    },
  };
}

test("archive listing and private reads never create a missing profile", async () => {
  const f = fixture(false);
  expect(await f.api.assets()).toEqual([]);
  await expect(
    f.api.assetBlob({ profileId: "", assetId: "missing", privateRead: true }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.writes()).toBe(0);
  expect(f.store().profiles).toEqual([]);
});

test("private archive reads use the authenticated owner and retain renewal access without profile writes", async () => {
  const f = fixture();
  expect(await f.api.assets()).toMatchObject([{ id: "owned-asset", revision: 3 }]);
  expect(
    await f.api.assetBlob({ profileId: "", assetId: "owned-asset", privateRead: true }),
  ).toEqual({ data: btoa("synthetic-original"), type: "image/png" });
  expect(f.writes()).toBe(0);
  f.switchOwner();
  expect(await f.api.assets()).toEqual([]);
  await expect(
    f.api.assetBlob({ profileId: "synthetic-profile", assetId: "owned-asset", privateRead: true }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.writes()).toBe(0);
});

test("archive deletion keeps owner and revision CAS while allowing the existing renewal deletion right", async () => {
  const f = fixture();
  await expect(f.api.removeAsset({ assetId: "owned-asset", revision: 2 })).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(f.writes()).toBe(0);
  await f.api.removeAsset({ assetId: "owned-asset", revision: 3 });
  expect(f.store().assets?.["owned-asset"]).toBeUndefined();
  expect(f.writes()).toBe(1);
  // Deleting a linked asset never silently edits or republishes the profile.
  expect(f.store().profiles[0]?.photoAssetId).toBe("owned-asset");
  const foreign = fixture();
  foreign.switchOwner();
  await expect(
    foreign.api.removeAsset({ assetId: "owned-asset", revision: 3 }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(foreign.writes()).toBe(0);
});

test("the mock transport retains asset deletion during renewal while registration remains blocked", async () => {
  const previous = readStore("session", { user: null, needsConsent: false });
  let deletions = 0;
  const restore = registerMockHandlers({
    "lawyers.removeAsset": () => {
      deletions++;
    },
    "lawyers.uploadAsset": () => {
      throw new Error("Upload must stay gated");
    },
  });
  try {
    writeStore("session", {
      user: { id: "archive-renewal-owner", name: "합성", accountType: "lawyer" },
      needsConsent: true,
    });
    await mockRequest(
      "lawyers.removeAsset",
      { assetId: "owned", revision: 1 },
      crypto.randomUUID(),
    );
    expect(deletions).toBe(1);
    await expect(mockRequest("lawyers.uploadAsset", {}, crypto.randomUUID())).rejects.toMatchObject(
      { code: "CONSENT_REQUIRED" },
    );
  } finally {
    restore();
    writeStore("session", previous);
  }
});
