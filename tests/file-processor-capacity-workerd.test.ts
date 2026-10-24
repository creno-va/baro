import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

test("actual processor class coordinates distinct DOs through persisted RPC before dispatch", async () => {
  const directory = await mkdtemp(join(tmpdir(), "baro-native-capacity-"));
  let mf: Miniflare | undefined;
  try {
    const entry = join(directory, "fixture.ts");
    await writeFile(
      entry,
      `
      import {DurableObject} from "cloudflare:workers";
      import {FileProcessorContainer} from ${JSON.stringify(resolve("src/workflows/file-processor-container.ts"))};
      import {namedProcessorPort} from ${JSON.stringify(resolve("src/server/modules/file-processing/native-identity.ts"))};
      export class TestProcessor extends FileProcessorContainer {
        async releaseNative() { await this.ctx.storage.put("test-released", true); }
        async ageCapacity() {
          const previous = await this.ctx.storage.get("baro-native-capacity-holder-v1");
          await this.ctx.storage.put("baro-native-capacity-holder-v1", {...previous, since: 0});
        }
      }
      export class NativeStats extends DurableObject {
        async update(delta) {
          return this.ctx.storage.transaction(async storage => {
            const previous = await storage.get("stats") ?? {running: 0, maximum: 0, starts: 0};
            previous.running += delta;
            previous.maximum = Math.max(previous.maximum, previous.running);
            if (delta > 0) previous.starts++;
            await storage.put("stats", previous);
            return previous;
          });
        }
        async read() { return await this.ctx.storage.get("stats"); }
      }
      export default {async fetch(request, env) {
        const url = new URL(request.url), name = url.searchParams.get("name");
        if (url.pathname === "/stats") return Response.json(await env.NATIVE_STATS.getByName("stats").read());
        if (url.pathname === "/age") {
          await env.FILE_PROCESSOR.getByName("baro-native-capacity-v1").ageCapacity();
          return new Response("aged synthetic slot");
        }
        const native = env.FILE_PROCESSOR.get(env.FILE_PROCESSOR.idFromName(name));
        if (url.pathname === "/release") {
          await native.releaseNative();
          return new Response("released");
        }
        if (url.pathname === "/stale-stop") {
          await native.stopCapacityHolder("stale-synthetic-token");
          return new Response("stale stop ignored");
        }
        const port = namedProcessorPort(env.FILE_PROCESSOR, name);
        await port.prepare({authorize: async () => true, signal: AbortSignal.timeout(5000)});
        return port.fetch(new Request("http://internal/ready"));
      }};
    `,
    );
    // Only the platform-native process is synthetic. The shipped subclass,
    // capacity RPC, SQLite DO transactions, namespace identities and streaming
    // lifecycle run unchanged in workerd. This is not a real Container receipt.
    const result = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      external: ["cloudflare:workers"],
      plugins: [
        {
          name: "synthetic-native-container",
          setup(build) {
            build.onResolve({ filter: /^@cloudflare\/containers$/ }, () => ({
              path: "synthetic-container",
              namespace: "synthetic-container",
            }));
            build.onLoad({ filter: /.*/, namespace: "synthetic-container" }, () => ({
              loader: "js",
              contents: `
              import {DurableObject} from "cloudflare:workers";
              export class Container extends DurableObject {
                constructor(ctx, env) {
                  super(ctx, env);
                  this.env = env;
                  this.ctx = {storage: ctx.storage, id: ctx.id, container: {getTcpPort: () => ({fetch: async () => {
                    if (!(await ctx.storage.get("test-running"))) throw new Error("synthetic native stopped");
                    let sent = false;
                    return new Response(new ReadableStream({async pull(controller) {
                      if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode("synthetic")); return; }
                      while (!(await ctx.storage.get("test-released"))) await new Promise(resolve => setTimeout(resolve, 10));
                      controller.close();
                    }}), {headers: {"content-type": "application/json"}});
                  }})}};
                }
                renewActivityTimeout() {}
                async destroy() {
                  if (await this.ctx.storage.get("test-running")) {
                    await this.ctx.storage.put("test-running", false);
                    await this.ctx.storage.put("test-released", true);
                    await this.env.NATIVE_STATS.getByName("stats").update(-1);
                  }
                }
                async startAndWaitForPorts() {
                  await this.ctx.storage.put("test-running", true);
                  const stats = await this.env.NATIVE_STATS.getByName("stats").update(1);
                  if (stats.running > 1) throw new Error("synthetic physical capacity exceeded");
                }
              }
            `,
            }));
          },
        },
      ],
    });
    expect(result.success).toBe(true);
    const output = result.outputs[0];
    if (!output) throw new Error("missing synthetic worker");
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: await output.text(),
        compatibilityDate: "2026-10-01",
        cf: false,
        unsafeRegisterWorker: false,
        durableObjects: {
          FILE_PROCESSOR: { className: "TestProcessor", useSQLite: true },
          NATIVE_STATS: { className: "NativeStats", useSQLite: true },
        },
      }),
    );
    const origin = await mf.ready;
    const readStats = async () =>
      (await (await fetch(new URL("/stats", origin))).json()) as {
        running: number;
        maximum: number;
        starts: number;
      };
    const first = await fetch(new URL("/start?name=synthetic-probe", origin));
    expect(first.status).toBe(200);
    await (await fetch(new URL("/stale-stop?name=synthetic-probe", origin))).text();
    const second = fetch(new URL("/start?name=synthetic-extract", origin));
    expect(await readStats()).toEqual({
      running: 1,
      maximum: 1,
      starts: 1,
    });
    await (await fetch(new URL("/release?name=synthetic-probe", origin))).text();
    expect(await first.text()).toBe("synthetic");
    const next = await second;
    expect(next.status).toBe(200);
    expect(await readStats()).toEqual({
      running: 1,
      maximum: 1,
      starts: 2,
    });
    await (await fetch(new URL("/release?name=synthetic-extract", origin))).text();
    expect(await next.text()).toBe("synthetic");
    expect(await readStats()).toEqual({
      running: 0,
      maximum: 1,
      starts: 2,
    });
    // Exercise the real coordinator -> abandoned DO -> coordinator cleanup RPC
    // cycle. Expiry requests a confirmed stop; it does not erase the slot.
    const abandoned = await fetch(new URL("/start?name=synthetic-abandoned", origin));
    await (await fetch(new URL("/age", origin))).text();
    const recovered = await fetch(new URL("/start?name=synthetic-recovered", origin));
    expect(recovered.status).toBe(200);
    await abandoned.text().catch(() => {});
    expect(await readStats()).toEqual({
      running: 1,
      maximum: 1,
      starts: 4,
    });
    await (await fetch(new URL("/release?name=synthetic-recovered", origin))).text();
    await recovered.text();
  } finally {
    await mf?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
