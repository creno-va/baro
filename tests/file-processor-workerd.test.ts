import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

test("workerd accepts bounded processor and legal requests without following redirects", async () => {
  const fixture = `
import {proxyProcessorRequest} from ${JSON.stringify(resolve("src/server/modules/file-processing/container-proxy.ts"))};
import {createBoundedTransport} from ${JSON.stringify(resolve("src/server/modules/legal-retrieval/v2/transport.ts"))};
export default {
  async fetch(request) {
    let calls = 0, stopped = 0, forwarded = null;
    if (new URL(request.url).pathname === "/legal") {
      const retrieve = createBoundedTransport(async (url, init) => {
        calls++;
        const incoming = new Request(url, init);
        forwarded = {redirect: incoming.redirect, accept: incoming.headers.get("accept")};
        return Response.json({synthetic: true});
      }, {sleep: async () => {}});
      let result = null, failure = null;
      try {
        result = await retrieve(new URL("https://www.law.go.kr/DRF/lawSearch.do?target=eflaw&type=JSON"), "synthetic", {
          authorize: async () => true,
          reserveRequest: async () => true,
        });
      } catch (error) {
        failure = error.reason === "upstream_unavailable" ? "upstream_unavailable" : "other";
      }
      return Response.json({calls, forwarded, result, failure});
    }
    const response = await proxyProcessorRequest(request, {
      start: async () => {},
      stop: async () => { stopped++; },
      fetch: async (incoming) => {
        calls++;
        forwarded = {
          redirect: incoming.redirect,
          bytes: Array.from(new Uint8Array(await incoming.arrayBuffer())),
          privateHeaders: ["cookie", "authorization", "x-case-id"].some(name => incoming.headers.has(name)),
          capability: /^[a-f0-9]{64}$/.test(incoming.headers.get("x-baro-capability")),
        };
        return request.headers.get("x-synthetic-redirect") === "true"
          ? new Response("synthetic redirect", {status: 302, headers: {location: "https://external.invalid/"}})
          : new Response('{"type":"complete"}\\n', {headers: {"content-type": "application/x-ndjson"}});
      }
    });
    const body = await response.text();
    return Response.json({status: response.status, body, calls, stopped, forwarded});
  }
};`;
  const directory = await mkdtemp(join(tmpdir(), "baro-native-request-"));
  let script: string;
  try {
    const entrypoint = join(directory, "fixture.ts");
    await writeFile(entrypoint, fixture);
    const output = join(directory, "fixture.js");
    // Compile independently of the test runner's module resolution.
    const compiler = Bun.spawn(
      [process.execPath, "build", entrypoint, "--target=browser", `--outfile=${output}`],
      { stdout: "ignore", stderr: "pipe" },
    );
    await new Response(compiler.stderr).text();
    expect(await compiler.exited).toBe(0);
    script = await Bun.file(output).text();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-10-01",
      cf: false,
      unsafeRegisterWorker: false,
    }),
  );
  try {
    const legal = await fetch(new URL("/legal", await mf.ready));
    expect((await legal.json()) as Record<string, unknown>).toEqual({
      calls: 1,
      forwarded: { redirect: "manual", accept: "application/json" },
      result: '{"synthetic":true}',
      failure: null,
    });
    for (const redirect of [false, true]) {
      const result = await fetch(new URL("/sanitize", await mf.ready), {
        method: "POST",
        headers: {
          "x-baro-bytes": "3",
          "x-baro-hash": "a".repeat(64),
          cookie: "synthetic-session",
          authorization: "synthetic-auth",
          "x-case-id": "synthetic-case",
          "x-synthetic-redirect": String(redirect),
        },
        body: new Uint8Array([1, 2, 3]),
      });
      expect((await result.json()) as Record<string, unknown>).toEqual({
        status: redirect ? 503 : 200,
        body: redirect ? '{"code":"PROCESSOR_UNAVAILABLE"}' : '{"type":"complete"}\n',
        calls: 1,
        stopped: 1,
        forwarded: {
          redirect: "manual",
          bytes: [1, 2, 3],
          privateHeaders: false,
          capability: true,
        },
      });
    }
  } finally {
    await mf.dispose();
  }
});
