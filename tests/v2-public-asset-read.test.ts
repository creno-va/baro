import { expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";
import { createDirectoryService } from "../src/server/modules/lawyers/directory";
import { readPublicAsset } from "../src/server/modules/lawyers/public-read";
import { publicationFixture } from "./helpers/lawyer-publication";

async function fixture() {
  const f = await publicationFixture();
  await f.service.copyApprovedAsset(f.owner.userId, f.profileId, 2, f.assetId);
  await f.service.finalize(f.owner.userId, f.profileId, 2);
  let reads = 0;
  const deps = {
    bucket: {
      get: async () => {
        reads++;
        return {
          size: f.bytes.length,
          checksums: { sha256: sha256(f.bytes).buffer },
          httpMetadata: { contentType: "image/png" },
          body: new ReadableStream<Uint8Array>({
            start: (c) => {
              c.enqueue(f.bytes);
              c.close();
            },
          }),
        };
      },
    } as unknown as Pick<R2Bucket, "get">,
    admitGet: async () => true,
  };
  return { ...f, deps, directory: createDirectoryService(f.core), reads: () => reads };
}

test("only current approved sanitized public copies are served with exact size and checksum", async () => {
  const f = await fixture();
  const object = await readPublicAsset(f.core, f.directory.profile, f.deps, f.profileId, f.assetId);
  expect(new Uint8Array(await new Response(object.body).arrayBuffer())).toEqual(f.bytes);
  expect(f.reads()).toBe(1);
  await expect(
    readPublicAsset(f.core, f.directory.profile, f.deps, f.profileId, f.sourceBlobId),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.reads()).toBe(1);
});

test("missing maintenance allowance and approval withdrawal prevent public GET or streaming", async () => {
  const f = await fixture();
  await expect(
    readPublicAsset(
      f.core,
      f.directory.profile,
      { ...f.deps, admitGet: async () => false },
      f.profileId,
      f.assetId,
    ),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  expect(f.reads()).toBe(0);
  const object = await readPublicAsset(f.core, f.directory.profile, f.deps, f.profileId, f.assetId);
  f.db.sqlite
    .query("DELETE FROM v2_role_bindings WHERE owner_id=? AND role='verified_lawyer'")
    .run(f.owner.userId);
  await expect(new Response(object.body).arrayBuffer()).rejects.toThrow();
  await expect(
    readPublicAsset(f.core, f.directory.profile, f.deps, f.profileId, f.assetId),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
