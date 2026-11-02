import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createNativeTestRegistry } from "./helpers/native-lifetime";
import { officialReportUrls, officialSourceReport } from "./helpers/report-official-source-fixture";

const native = createNativeTestRegistry();
afterEach(() => native.stop());
test(
  "actual Workers preview PDF links only bounded source rows and preserves Unicode, page bounds and limits",
  () =>
    native.run(async (lifetime) => {
      const dir = await mkdtemp(join(tmpdir(), "baro-source-links-"));
      let script: string;
      try {
        const entry = join(dir, "entry.ts");
        await writeFile(
          entry,
          `import {renderReportPdf} from ${JSON.stringify(resolve("src/server/modules/reports/pdf.ts"))};
export default {async fetch(request) {const font=new Uint8Array(await request.arrayBuffer()); const input=${JSON.stringify(officialSourceReport)}; try {return new Response(await renderReportPdf(font, {...input, content:new URL(request.url).pathname==='/oversize'?'x'.repeat(30001):input.content}));} catch {return new Response('bounded failure',{status:413});}}};`,
        );
        const build = await Bun.build({ entrypoints: [entry], target: "browser" });
        expect(build.success).toBe(true);
        script = await build.outputs[0]!.text();
      } finally {
        await rm(dir, { recursive: true, force: true });
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
      lifetime.own(() => mf.dispose());
      const origin = await mf.ready;
      const font = new Uint8Array(
        await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer(),
      );
      const response = await fetch(origin, { method: "POST", body: font, signal: lifetime.signal });
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(bytes.byteLength).toBeLessThan(1_300_000);
      const check = Bun.spawnSync(
        ["python3", "tests/helpers/report-pdf-links.py", JSON.stringify(officialReportUrls)],
        { stdin: bytes, stdout: "pipe", stderr: "pipe" },
      );
      expect(check.exitCode).toBe(0);
      const proof = JSON.parse(new TextDecoder().decode(check.stdout));
      expect(proof.rectanglesWithinPages).toBe(true);
      expect(proof.pages).toBeGreaterThan(1);
      const output = Bun.env.BARO_REPORT_SOURCE_ARTIFACT_DIR;
      if (output) {
        await Bun.write(`${output}/workers.pdf`, bytes);
        await Bun.write(`${output}/workers-links.json`, JSON.stringify(proof, null, 2));
      }
      const bounded = await fetch(new URL("/oversize", origin), {
        method: "POST",
        body: font,
        signal: lifetime.signal,
      });
      expect(bounded.status).toBe(413);
    }),
  30000,
);
