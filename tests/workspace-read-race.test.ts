import { afterEach, expect, test } from "bun:test";
import type { EnvelopeCipher } from "../src/server/crypto";
import { createV2Core } from "../src/server/db/v2-core";
import { createWorkspaceService } from "../src/server/modules/workspace/service";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";

const databases: Awaited<ReturnType<typeof customerWorkspaceFixture>>["db"][] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function fixture(
  change: (f: Awaited<ReturnType<typeof customerWorkspaceFixture>>, read: number) => void,
  table: "v2_workspaces" | "v2_intakes" = "v2_workspaces",
) {
  const f = await customerWorkspaceFixture();
  databases.push(f.db);
  let reads = 0;
  const cipher: EnvelopeCipher = {
    encrypt: (text, context) => f.core.cipher.encrypt(text, context),
    async decrypt(envelope, context) {
      const text = await f.core.cipher.decrypt(envelope, context);
      if (context.table === table) change(f, ++reads);
      return text;
    },
  };
  return {
    ...f,
    service: createWorkspaceService(createV2Core(f.db.binding, cipher), { clock: () => f.now }),
    reads: () => reads,
  };
}

test("a job revision change during workspace decryption returns a fresh accessible workspace", async () => {
  const f = await fixture((f, read) => {
    if (read === 1)
      f.db.sqlite
        .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
        .run(f.workspace.id);
  });
  const current = await f.service.find(f.owner.userId, f.workspace.id);
  expect(current.workspaceRevision).toBe(f.workspace.workspaceRevision + 1);
  expect(current.id).toBe(f.workspace.id);
  expect(f.reads()).toBe(2);
});

test("an intake publication during metadata decryption recovers a fresh accessible intake", async () => {
  const f = await fixture((f, read) => {
    if (read === 1)
      f.db.sqlite.query("UPDATE v2_intakes SET revision=revision+1 WHERE id=?").run(f.workspace.id);
  }, "v2_intakes");
  const current = await f.service.intake(f.owner.userId, f.workspace.id);
  expect(current.revision).toBe(2);
  expect(f.reads()).toBe(2);
});

for (const target of ["workspace", "account"] as const) {
  test(`a ${target} deletion during intake recovery still denies access`, async () => {
    const f = await fixture((f, read) => {
      if (read === 1)
        f.db.sqlite
          .query("UPDATE v2_intakes SET revision=revision+1 WHERE id=?")
          .run(f.workspace.id);
      else
        f.db.sqlite
          .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
          .run(target, target === "workspace" ? f.workspace.id : f.owner.userId, f.now);
    }, "v2_intakes");
    await expect(f.service.intake(f.owner.userId, f.workspace.id)).rejects.toThrow("NOT_FOUND");
    expect(f.reads()).toBe(2);
  });
}

test("foreign owners cannot trigger intake recovery or narrative decryption", async () => {
  const f = await fixture(() => {}, "v2_intakes");
  await expect(f.service.intake(crypto.randomUUID(), f.workspace.id)).rejects.toThrow("NOT_FOUND");
  expect(f.reads()).toBe(0);
});

test("continuous intake publication is a bounded transient failure, never a false 404", async () => {
  const f = await fixture((f) => {
    f.db.sqlite.query("UPDATE v2_intakes SET revision=revision+1 WHERE id=?").run(f.workspace.id);
  }, "v2_intakes");
  await expect(f.service.intake(f.owner.userId, f.workspace.id)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(f.reads()).toBe(3);
});

for (const target of ["workspace", "account"] as const) {
  test(`a ${target} deletion during a workspace read still denies access`, async () => {
    const f = await fixture((f, read) => {
      if (read === 1)
        f.db.sqlite
          .query("INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES(?,?,?)")
          .run(target, target === "workspace" ? f.workspace.id : f.owner.userId, f.now);
    });
    await expect(f.service.find(f.owner.userId, f.workspace.id)).rejects.toThrow("NOT_FOUND");
    expect(f.reads()).toBe(1);
  });
}

test("foreign owners cannot read or trigger decryption of a workspace", async () => {
  const f = await fixture(() => {});
  await expect(f.service.find(crypto.randomUUID(), f.workspace.id)).rejects.toThrow("NOT_FOUND");
  expect(f.reads()).toBe(0);
});

test("deletion during revision recovery never returns the earlier accessible snapshot", async () => {
  const f = await fixture((f, read) => {
    if (read === 1)
      f.db.sqlite
        .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
        .run(f.workspace.id);
    else
      f.db.sqlite
        .query(
          "INSERT INTO v2_tombstones(target_kind,target_id,deleted_at) VALUES('workspace',?,?)",
        )
        .run(f.workspace.id, f.now);
  });
  await expect(f.service.find(f.owner.userId, f.workspace.id)).rejects.toThrow("NOT_FOUND");
  expect(f.reads()).toBe(2);
});

test("continuous revision changes stop with a transient failure instead of false access denial", async () => {
  const f = await fixture((f) => {
    f.db.sqlite
      .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
      .run(f.workspace.id);
  });
  await expect(f.service.find(f.owner.userId, f.workspace.id)).rejects.toThrow(
    "DB_OPERATION_FAILED",
  );
  expect(f.reads()).toBe(3);
});
