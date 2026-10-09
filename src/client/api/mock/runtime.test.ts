import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SessionView } from "../types";
import {
  clearMockStore,
  mockRequest,
  mockRuntime,
  readStore,
  registerMockHandlers,
  writeStore,
} from "./runtime";

beforeEach(clearMockStore);
const restoreHandlers: (() => void)[] = [];
afterEach(() => {
  for (const restore of restoreHandlers.splice(0)) restore();
});
test("aggregate updates share namespaces without dropping another domain", () => {
  writeStore("cases", { one: { id: "one" } });
  writeStore("lawyers", { profiles: [{ id: "public" }] });
  mockRuntime.update((state) => {
    state.files.one = [];
    state.reports = {};
  });
  expect(readStore("cases", {})).toEqual({ one: { id: "one" } });
  expect(readStore("lawyers", {})).toEqual({ profiles: [{ id: "public" }] });
});
test("cached private mutation cannot resurrect a deleted case or deleted account", async () => {
  const session: SessionView = {
    user: { id: "owner", name: "합성", accountType: "customer" },
    needsConsent: false,
  };
  writeStore("session", session);
  writeStore("caseOwners", { one: "owner" });
  let calls = 0;
  registerMockHandlers({ "cases.saveSummary": () => ({ id: "one", revision: ++calls }) });
  expect(
    await mockRequest<{ id: string; revision: number }>(
      "cases.saveSummary",
      { id: "one" },
      "request-one",
    ),
  ).toEqual({
    id: "one",
    revision: 1,
  });
  expect(
    await mockRequest<{ id: string; revision: number }>(
      "cases.saveSummary",
      { id: "one" },
      "request-one",
    ),
  ).toEqual({
    id: "one",
    revision: 1,
  });
  writeStore("deletedCaseIds", ["one"]);
  await expect(mockRequest("cases.saveSummary", { id: "one" }, "request-one")).rejects.toThrow(
    "삭제했거나",
  );
  writeStore("deletedCaseIds", []);
  writeStore("deletedAccountIds", ["owner"]);
  await expect(mockRequest("cases.saveSummary", { id: "one" }, "request-one")).rejects.toThrow(
    "로그인",
  );
  expect(calls).toBe(1);
});

test("lawyer private replay rechecks role while public reads stay anonymous", async () => {
  writeStore("session", {
    user: { id: "owner", name: "합성", accountType: "lawyer" },
    needsConsent: false,
  });
  let calls = 0;
  restoreHandlers.push(
    registerMockHandlers({
      "lawyers.saveMine": () => ({ id: "profile", revision: ++calls }),
      "lawyers.list": () => [],
      "lawyers.get": () => ({ id: "public" }),
      "lawyers.assetBlob": () => new Blob(["synthetic public asset"]),
    }),
  );
  await mockRequest("lawyers.saveMine", { id: "profile" }, "lawyer-replay");
  writeStore("session", {
    user: { id: "owner", name: "합성", accountType: "customer" },
    needsConsent: false,
  });
  await expect(
    mockRequest("lawyers.saveMine", { id: "profile" }, "lawyer-replay"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    mockRequest("lawyers.assetBlob", { privateRead: true }, "private-asset"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(calls).toBe(1);
  writeStore("session", { user: null, needsConsent: false });
  expect(await mockRequest<unknown[]>("lawyers.list", {}, "public-list")).toEqual([]);
  expect(
    await mockRequest<{ id: string }>("lawyers.get", { id: "public" }, "public-detail"),
  ).toEqual({
    id: "public",
  });
  expect(
    await mockRequest("lawyers.assetBlob", { privateRead: false }, "public-asset"),
  ).toBeInstanceOf(Blob);
});

test("same mock owner changing roles cannot replay private customer results", async () => {
  writeStore("session", {
    user: { id: "owner", name: "합성", accountType: "customer" },
    needsConsent: false,
  });
  writeStore("caseOwners", { one: "owner" });
  let calls = 0;
  registerMockHandlers({ "reports.save": () => ({ id: "one", revision: ++calls }) });
  await mockRequest("reports.save", { id: "one" }, "role-request");
  writeStore("session", {
    user: { id: "owner", name: "합성", accountType: "lawyer" },
    needsConsent: false,
  });
  await expect(mockRequest("reports.save", { id: "one" }, "role-request")).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(calls).toBe(1);
});

test("reconsent permits private read dispatch but denies writes and cached mutations for both roles", async () => {
  for (const role of ["customer", "lawyer"] as const) {
    const reads =
      role === "customer"
        ? ["cases.list", "cases.get", "files.review", "reports.get"]
        : ["lawyers.getMine", "lawyers.assets", "lawyers.assetBlob"];
    const writes =
      role === "customer"
        ? ["cases.create", "cases.saveSummary", "workspace.sendMessage", "reports.generate"]
        : ["lawyers.saveMine", "lawyers.publishMine", "lawyers.uploadAsset"];
    let mutated = 0;
    restoreHandlers.push(
      registerMockHandlers(
        Object.fromEntries([
          ...reads.map((name) => [name, () => "private"]),
          ...writes.map((name) => [name, () => ++mutated]),
        ]),
      ),
    );
    writeStore("session", {
      user: { id: "owner", name: "합성", accountType: role },
      needsConsent: false,
    });
    await mockRequest(writes[0] ?? "", {}, "committed");
    writeStore("session", {
      user: { id: "owner", name: "합성", accountType: role },
      needsConsent: true,
    });
    for (const read of reads)
      expect(await mockRequest<string>(read, { privateRead: true }, "read")).toBe("private");
    for (const write of writes)
      await expect(mockRequest(write, {}, "committed")).rejects.toMatchObject({
        code: "CONSENT_REQUIRED",
      });
    expect(mutated).toBe(1);
    writeStore("session", {
      user: { id: "owner", name: "합성", accountType: role === "customer" ? "lawyer" : "customer" },
      needsConsent: true,
    });
    for (const read of reads)
      await expect(mockRequest(read, { privateRead: true }, "read")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    writeStore("session", { user: null, needsConsent: false });
    for (const read of reads)
      await expect(mockRequest(read, { privateRead: true }, "read")).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
  }
});
