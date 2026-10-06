import { beforeEach, expect, test } from "bun:test";
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
  expect(await mockRequest("cases.saveSummary", { id: "one" }, "request-one")).toEqual({
    id: "one",
    revision: 1,
  });
  expect(await mockRequest("cases.saveSummary", { id: "one" }, "request-one")).toEqual({
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
