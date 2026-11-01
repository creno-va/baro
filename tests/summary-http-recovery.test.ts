import { expect, test } from "bun:test";
import { createJsonRequester } from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";

const path = "/api/v2/cases/synthetic_case/summary";
const workspace = (revision = 2, id = "synthetic_case") => ({
  schemaVersion: "2",
  id,
  title: "합성 사건",
  subjectContext: "individual",
  jurisdiction: "KR",
  status: "intake",
  archivedFrom: null,
  workspaceRevision: revision,
  intakeRevision: 1,
  confirmedSummaryRevision: null,
  currentJobId: null,
  legacySnapshotId: null,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
});
function unreadable(revision?: string) {
  return new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(new Error("synthetic-body-fault"));
      },
    }),
    {
      headers: revision === undefined ? {} : { "x-baro-summary-workspace-revision": revision },
    },
  );
}

for (const variant of [
  "missing-header",
  "invalid-header",
  "same-revision",
  "older-revision",
  "wrong-case",
  "invalid-workspace",
  "probe-network",
  "probe-json",
] as const) {
  test(`summary body failure remains unavailable for ${variant} without proven source advance`, async () => {
    const calls: string[] = [];
    const request = createJsonRequester({
      newKey: () => "unused",
      transport: async (url) => {
        calls.push(url);
        if (url === path)
          return unreadable(
            variant === "missing-header" ? undefined : variant === "invalid-header" ? "1e0" : "1",
          );
        if (variant === "probe-network") throw new Error("synthetic-probe-fault");
        if (variant === "probe-json") return new Response("broken-json");
        return Response.json(
          variant === "invalid-workspace"
            ? { workspaceRevision: 2 }
            : workspace(
                variant === "same-revision" ? 1 : variant === "older-revision" ? 0 : 2,
                variant === "wrong-case" ? "foreign_case" : "synthetic_case",
              ),
        );
      },
    });
    await expect(request({ path })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(calls).toHaveLength(
      variant === "missing-header" || variant === "invalid-header" ? 1 : 2,
    );
  });
}
for (const [status, code] of [
  [401, "UNAUTHENTICATED"],
  [404, "NOT_FOUND"],
  [503, "UNAVAILABLE"],
] as const) {
  test(`summary recovery preserves an actual fresh ${status} response`, async () => {
    let calls = 0;
    const request = createJsonRequester({
      newKey: () => "unused",
      transport: async () => (++calls === 1 ? unreadable("1") : Response.json({}, { status })),
    });
    await expect(request({ path })).rejects.toMatchObject({ code, httpStatus: status });
    expect(calls).toBe(2);
  });
}
for (const change of ["owner", "abort"] as const) {
  test(`summary recovery preserves ${change} cancellation and original request scope`, async () => {
    const scope = createSessionScope();
    const controller = new AbortController();
    let calls = 0;
    const request = createJsonRequester({
      scope,
      newKey: () => "unused",
      transport: async (url, init) => {
        calls++;
        expect(new Headers(init.headers).get("x-baro-expected-owner")).toBe("synthetic_owner");
        expect(init.signal).toBeDefined();
        if (url === path) return unreadable("1");
        if (change === "owner") scope.invalidate();
        else controller.abort();
        return Response.json(workspace());
      },
    });
    const error = await request({
      path,
      expectedOwner: "synthetic_owner",
      signal: controller.signal,
    }).catch((error: unknown) => error);
    if (change === "owner") expect(error).toMatchObject({ code: "UNAUTHENTICATED" });
    else expect(error).toBeInstanceOf(DOMException);
    expect(calls).toBe(2);
  });
}

test("mutation body failures never start a source probe or replay", async () => {
  let calls = 0;
  const request = createJsonRequester({
    newKey: () => "unused",
    transport: async (_url, init) => {
      calls++;
      expect(new Headers(init.headers).get("idempotency-key")).toBe("original-key");
      expect(init.body).toBe('{"expectedRevision":1}');
      return unreadable("1");
    },
  });
  await expect(
    request({ path, method: "PUT", key: "original-key", body: { expectedRevision: 1 } }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(calls).toBe(1);
});
