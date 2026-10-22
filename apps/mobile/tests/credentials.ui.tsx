import { createSessionScope } from "@baro/client-core";
import { getCookie, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import { createNativeCredentials } from "../src/platform/auth/credentials";

test("the pinned Expo cookie/storage codecs round-trip chunks, expiry and credential reset", async () => {
  const disk = new Map<string, string>();
  const credentials = createNativeCredentials({
    scope: createSessionScope(),
    namespace: "baro_preview_auth",
    storage: {
      getItemAsync: async (key) => disk.get(key) ?? null,
      setItemAsync: async (key, value) => {
        disk.set(key, value);
      },
    },
    manageStorage: storageAdapter,
    codec: { header: getCookie, merge: getSetCookie },
  });
  const frame = credentials.capture();
  const token = "synthetic".repeat(600);
  await frame.accept(
    `__Secure-better-auth.session_token=${token}; Path=/; Secure; HttpOnly; Max-Age=3600`,
  );
  expect(await frame.cookie()).toBe(`__Secure-better-auth.session_token=${token}`);
  expect(
    [...disk.values()].every((value) => new TextEncoder().encode(value).byteLength <= 1800),
  ).toBe(true);
  expect(disk.size).toBeGreaterThan(1);
  await frame.accept("better-auth.oauth_state=synthetic-state; Path=/; Max-Age=600");
  expect(await frame.cookie()).toContain("better-auth.oauth_state=synthetic-state");
  await frame.accept("__Secure-better-auth.session_token=; Path=/; Max-Age=0");
  expect(await frame.cookie()).toBe("better-auth.oauth_state=synthetic-state");
  await credentials.reset();
  expect(await credentials.capture().cookie()).toBe("");
  expect([...disk.values()].join("")).not.toContain(token);
  await expect(frame.cookie()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});

test("retiring an actual SDK chunk write cannot leave an accessible old cookie or orphan credential", async () => {
  const disk = new Map<string, string>();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((done) => {
    entered = done;
  });
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let pause = true;
  const credentials = createNativeCredentials({
    scope: createSessionScope(),
    namespace: "baro_preview_auth",
    storage: {
      getItemAsync: async (key) => disk.get(key) ?? null,
      setItemAsync: async (key, value) => {
        if (pause) {
          pause = false;
          entered();
          await gate;
        }
        disk.set(key, value);
      },
    },
    manageStorage: storageAdapter,
    codec: { header: getCookie, merge: getSetCookie },
  });
  const errors = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const pending = credentials
      .capture()
      .accept(`better-auth.session_token=${"synthetic-private".repeat(400)}; Max-Age=3600`);
    void pending.catch(() => {});
    await ready;
    const reset = credentials.reset();
    release();
    await expect(pending).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await reset;
    expect(await credentials.capture().cookie()).toBe("");
    expect([...disk.values()].join("")).not.toContain("synthetic-private");
    expect(errors.mock.calls.flat().map(String).join(" ")).not.toContain("synthetic-private");
  } finally {
    release();
    errors.mockRestore();
  }
});
