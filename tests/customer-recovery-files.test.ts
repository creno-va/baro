import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createFilesApi as createClient } from "../src/client/api/files";
import { createFilesApi } from "../src/server/api/v2/files";
import { createWorkspacesApi } from "../src/server/api/v2/workspaces";
import { customerWorkspaceFixture } from "./helpers/customer-workspace";

async function fixture() {
  const f = await customerWorkspaceFixture(new Date().toISOString());
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async put(key: string, value: Uint8Array) {
      objects.set(key, value.slice());
      return { key, size: value.byteLength };
    },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength, body: new Response(value.slice()).body } : null;
    },
    async head(key: string) {
      const value = objects.get(key);
      return value ? { key, size: value.byteLength } : null;
    },
    async delete(key: string) {
      objects.delete(key);
    },
  };
  const env = { ...f.owner.env, CASE_DATA_KEY_V1: btoa("w".repeat(32)).replace(/=+$/, "") };
  const app = new Hono().route("/api/v2/cases", createWorkspacesApi()).route(
    "/api/v2/cases",
    createFilesApi({
      dependencies: async () => ({
        bucket: bucket as any,
        testOnlyUnmeteredStorage: true,
        probe: async (input) => {
          const reader = input.open().getReader();
          while (!(await reader.read()).done) {}
          reader.releaseLock();
          return {
            category: "document",
            format: "txt",
            byteLength: input.byteLength,
            pageCount: 1,
          };
        },
      }),
    }),
  );
  const raw = (path: string, init?: RequestInit) =>
    app.request(
      path,
      {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          cookie: f.owner.cookie,
          origin: env.BETTER_AUTH_URL,
        },
      },
      env,
    );
  return { ...f, raw };
}

for (const useFreshClient of [false, true])
  test(`delete interrupted upload then re-add; fresh client=${useFreshClient}`, async () => {
    const f = await fixture();
    try {
      let failPart = true;
      const calls: string[] = [];
      const transport = async (path: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${path}`);
        if (failPart && init?.method === "PUT" && path.endsWith("/parts/0")) {
          failPart = false;
          throw new TypeError("Synthetic upload interruption");
        }
        return f.raw(path, init);
      };
      const client = createClient(transport),
        source = new File(["Synthetic local original"], "recovery.txt", { type: "text/plain" });
      await expect(client.upload(f.workspace.id, source)).rejects.toThrow(
        "Synthetic upload interruption",
      );
      const pending = await client.list(f.workspace.id);
      expect(pending).toHaveLength(1);
      await expect(client.original(f.workspace.id, pending[0]!.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect((await f.raw(`/api/v2/cases/${f.workspace.id}/workspace`)).status).toBe(200);
      expect(await client.remove(f.workspace.id, pending[0]!.id)).toHaveLength(0);
      const retry = useFreshClient ? createClient(transport) : client;
      {
        const uploaded = await retry.upload(f.workspace.id, source);
        expect(uploaded.status).toBe("waiting");
        expect(uploaded.id).not.toBe(pending[0]!.id);

        expect(uploaded.canStartProcessing).toBe(true);
      }
      expect(calls.filter((c) => c === `POST /api/v2/cases/${f.workspace.id}/files`)).toHaveLength(
        2,
      );
    } finally {
      f.db.close();
    }
  });
