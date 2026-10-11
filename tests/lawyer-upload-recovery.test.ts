import { afterEach, expect, test } from "bun:test";
import { responseError } from "../src/client/api/core";
import { createLawyerUploadClient, LawyerApiError } from "../src/client/api/lawyers";
import { createV2LawyersRepository } from "../src/server/db/v2-lawyers";
import { selfAssetFixture } from "./helpers/lawyer-self-assets";

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
afterEach(() => {
  if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});
function storage() {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}
async function fixture(stage: "reservation" | "content" | "beforeContent" | "none") {
  const saved = storage(),
    f = await selfAssetFixture();
  const repository = createV2LawyersRepository(f.core);
  const ids = new Set<string>(),
    keys: string[] = [];
  let lost = false,
    puts = 0,
    profileRevision = 1;
  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (path.endsWith("/profile"))
      return Response.json({ profileId: f.params.profileId, revision: profileRevision });
    if (init.method === "POST") {
      keys.push(headers.get("idempotency-key") ?? "");
      const row = await f.assets.reserve(
        f.actor.ownerId,
        Number(headers.get("if-match")),
        keys.at(-1) ?? "",
        JSON.parse(String(init.body)),
        "portfolio",
      );
      ids.add(row.assetId);
      if (!lost && stage === "reservation") {
        lost = true;
        throw new LawyerApiError("UNAVAILABLE", "Synthetic lost reservation", true);
      }
      return Response.json(row);
    }
    if (init.method === "PUT") {
      if (!lost && stage === "beforeContent") {
        lost = true;
        throw new LawyerApiError("UNAVAILABLE", "Synthetic interrupted content", true);
      }
      puts++;
      const source = init.body as File;
      const row = await f.assets.upload(
        f.actor.ownerId,
        path.split("/").at(-2) ?? "",
        Number(headers.get("if-match")),
        source.size,
        new Response(source).body,
      );
      if (!lost && stage === "content") {
        lost = true;
        throw new LawyerApiError("UNAVAILABLE", "Synthetic lost content", true);
      }
      return Response.json(row);
    }
    const value = await repository.readAsset(f.actor, path.split("/").at(-1) ?? "");
    if (!value) throw new LawyerApiError("NOT_FOUND", "Synthetic deleted asset");
    return Response.json(value);
  };
  const source = new File([f.original], "synthetic-retry.png", { type: "image/png" });
  return {
    ...f,
    send,
    source,
    saved,
    ids,
    keys,
    puts: () => puts,
    revise: () => {
      profileRevision++;
      f.db.sqlite
        .query("UPDATE v2_profiles SET revision=? WHERE id=?")
        .run(profileRevision, f.params.profileId);
    },
  };
}
for (const stage of ["reservation", "content", "beforeContent"] as const) {
  test(`lawyer upload recovers ${stage} response loss after a client reload without duplicate storage`, async () => {
    const f = await fixture(stage);
    await expect(
      createLawyerUploadClient(f.send).upload(f.params.profileId, f.source, "portfolio"),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.saved.size).toBe(1);
    const uploaded = await createLawyerUploadClient(f.send).upload(
      f.params.profileId,
      new File([f.original], " synthetic-retry.png ", { type: "image/png" }),
      "portfolio",
    );
    expect(uploaded.status).toBe("uploaded");
    expect(f.ids.size).toBe(1);
    expect(f.puts()).toBe(1);
    expect(new Set(f.keys).size).toBe(1);
    expect(f.saved.size).toBe(0);
    const blobs = f.db.sqlite
      .query(
        "SELECT count(*) AS n FROM v2_blobs b JOIN v2_storage_reservations r ON r.id=b.reservation_id WHERE r.entity_id=?",
      )
      .get(uploaded.id) as { n: number };
    expect(blobs.n).toBe(1);
  });
}
test("reservation replay survives a profile revision change, but new stale reservations fail", async () => {
  const f = await fixture("reservation");
  const client = createLawyerUploadClient(f.send);
  await expect(client.upload(f.params.profileId, f.source, "portfolio")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  f.revise();
  expect((await client.upload(f.params.profileId, f.source, "portfolio")).status).toBe("uploaded");
  expect(f.ids.size).toBe(1);
  await expect(
    f.assets.reserve(
      f.actor.ownerId,
      1,
      crypto.randomUUID(),
      {
        purpose: "portfolio",
        name: f.source.name,
        mediaType: f.source.type,
        byteLength: f.source.size,
      },
      "portfolio",
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
});
test("same filename and size with changed bytes or purpose uses a separate attempt", async () => {
  const f = await fixture("reservation");
  const client = createLawyerUploadClient(f.send);
  await expect(client.upload(f.params.profileId, f.source, "portfolio")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  const changed = f.original.slice();
  changed[0] = (changed[0] ?? 0) ^ 1;
  await client.upload(
    f.params.profileId,
    new File([changed], f.source.name, { type: f.source.type }),
    "portfolio",
  );
  await client.upload(f.params.profileId, f.source, "profile_photo");
  await client.upload(f.params.profileId, f.source, "portfolio");
  expect(f.ids.size).toBe(3);
  expect(new Set(f.keys).size).toBe(3);
  expect(f.puts()).toBe(3);
});
test("parallel retries share one reservation and original upload", async () => {
  const f = await fixture("reservation"),
    client = createLawyerUploadClient(f.send);
  await expect(client.upload(f.params.profileId, f.source, "portfolio")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  const [a, b] = await Promise.all([
    client.upload(f.params.profileId, f.source, "portfolio"),
    client.upload(f.params.profileId, f.source, "portfolio"),
  ]);
  expect(a.id).toBe(b.id);
  expect(f.ids.size).toBe(1);
  expect(f.puts()).toBe(1);
});
test("a peer-deleted uncertain asset is reported before a fresh attempt can be made", async () => {
  const f = await fixture("content");
  await expect(
    createLawyerUploadClient(f.send).upload(f.params.profileId, f.source, "portfolio"),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  const id = [...f.ids][0] ?? "";
  await f.core
    .statement("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('asset',?,?)", [
      id,
      f.actor.now,
    ])
    .run();
  await expect(
    createLawyerUploadClient(f.send).upload(f.params.profileId, f.source, "portfolio"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(f.ids.size).toBe(1);
  expect(f.puts()).toBe(1);
  expect(f.saved.size).toBe(0);
});
test("disabled session storage still allows same-page upload recovery", async () => {
  const f = await fixture("content");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() {
      throw new Error("Synthetic disabled storage");
    },
  });
  const client = createLawyerUploadClient(f.send);
  await expect(client.upload(f.params.profileId, f.source, "portfolio")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect((await client.upload(f.params.profileId, f.source, "portfolio")).status).toBe("uploaded");
  expect(f.ids.size).toBe(1);
  expect(f.puts()).toBe(1);
});

for (const freshClient of [false, true])
  test(`explicit upload retry recovers a rejected reservation revision; fresh=${freshClient}`, async () => {
    const f = await fixture("none");
    let raced = false;
    const send = async (path: string, init: RequestInit = {}) => {
      if (init.method === "POST" && !raced) {
        raced = true;
        // Another tab saves after the client reads its profile revision.
        f.revise();
      }
      try {
        return await f.send(path, init);
      } catch (error) {
        if ((error as { code?: string }).code === "STALE_REVISION")
          throw await responseError(
            Response.json({ error: { code: "STALE_REVISION" } }, { status: 409 }),
          );
        throw error;
      }
    };
    const client = createLawyerUploadClient(send);
    await expect(client.upload(f.params.profileId, f.source, "portfolio")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(f.ids.size).toBe(0);
    expect(f.saved.size).toBe(0);
    const retry = freshClient ? createLawyerUploadClient(send) : client;
    expect((await retry.upload(f.params.profileId, f.source, "portfolio")).status).toBe("uploaded");
    expect(f.ids.size).toBe(1);
    expect(f.puts()).toBe(1);
    expect(new Set(f.keys).size).toBe(2);
    expect(f.saved.size).toBe(0);
  });
