import { expect, test } from "@playwright/test";

test("request-backed photo bytes survive reload and case/account purge preserves other owners", async ({
  page,
}) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/client/api/mock/files.ts";
    const { mockOriginalStore: store } = await import(modulePath);
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 7]);
    const blob = await new Response(bytes, { headers: { "content-type": "image/jpeg" } }).blob();
    await store("owner/case/photo", blob);
    await store("owner/other/file", new Blob(["own other case"]));
    await store("peer/case/file", new Blob(["peer remains"]));
    const saved = await store("owner/case/photo");
    return { bytes: Array.from(new Uint8Array(await saved.arrayBuffer())), type: saved.type };
  });
  expect(result).toEqual({ bytes: [0, 255, 128, 13, 10, 7], type: "image/jpeg" });
  await page.reload();
  expect(
    await page.evaluate(async () => {
      const modulePath = "/src/client/api/mock/files.ts";
      const { mockOriginalStore: store, clearMockOriginals: clear } = await import(modulePath);
      const restored = Array.from(
        new Uint8Array(await (await store("owner/case/photo")).arrayBuffer()),
      );
      await clear("owner", "case");
      const removedCase = await store("owner/case/photo");
      const otherCase = await (await store("owner/other/file")).text();
      await clear("owner");
      return {
        restored,
        removedCase,
        otherCase,
        removedOwner: await store("owner/other/file"),
        peer: await (await store("peer/case/file")).text(),
      };
    }),
  ).toEqual({
    restored: [0, 255, 128, 13, 10, 7],
    removedCase: null,
    otherCase: "own other case",
    removedOwner: null,
    peer: "peer remains",
  });
});
