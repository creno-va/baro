import { expect, test } from "bun:test";
import { createReportsClient, domainRequest } from "../src/client/api/reports";
import { type ZipSource, zipNames } from "../src/server/modules/reports/zip";
import { reportHttpFixture } from "./helpers/report-http-fixture";

test("metadata refresh cannot rebase an already displayed report draft", async () => {
  const f = await reportHttpFixture();
  const client = createReportsClient(
    domainRequest(async (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("cookie", f.cookie);
      headers.set("origin", f.env.BETTER_AUTH_URL);
      return f.app.request(path, { ...init, headers }, f.env);
    }),
  );
  const displayed = await client.get(f.workspaceId);
  const peer = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: displayed.revision,
    content: "Synthetic peer edit",
    excludedFileIds: [],
    maskIdentifiers: false,
  });
  await client.get(f.workspaceId);
  await expect(
    client.save(
      f.workspaceId,
      { content: "Synthetic old draft", excludedFileIds: [], maskIdentifiers: false },
      displayed.revision,
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect((await f.reports.get(f.actor.ownerId, f.workspaceId)).content).toBe(peer.content);
});

const names = (values: string[]) =>
  zipNames(
    values.map(
      (name, i): ZipSource => ({
        id: `source-${i}`,
        name,
        byteLength: 1,
        contentHash: "a".repeat(64),
        open: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([97]));
              controller.close();
            },
          }),
      }),
    ),
  ).map((value) => new TextDecoder().decode(value));
test("ZIP case variants and suffix-shaped names remain distinct on Windows", () => {
  expect(names(["Synthetic.txt", "synthetic.TXT", "Synthetic (2).txt"])).toEqual([
    "Synthetic.txt",
    "synthetic (2).TXT",
    "Synthetic (2) (2).txt",
  ]);
});
test("ZIP duplicate suffixes fit filesystem limits without splitting Unicode", () => {
  for (const name of [`${"s".repeat(251)}.txt`, `${"한😀".repeat(100)}.pdf`]) {
    const result = names([name, name, name]);
    expect(new Set(result.map((value) => value.toLowerCase())).size).toBe(3);
    for (const value of result) {
      expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(255);
      expect(value.length).toBeLessThanOrEqual(255);
      expect(value).not.toContain("�");
      expect(value.endsWith(name.slice(-4))).toBe(true);
    }
  }
});
test("ZIP extraction names avoid Windows device names and trailing dots", () => {
  expect(names(["CON.txt", "a.txt ", "a.txt", "bad:name.txt"])).toEqual([
    "_CON.txt",
    "a.txt",
    "a (2).txt",
    "bad_name.txt",
  ]);
});
