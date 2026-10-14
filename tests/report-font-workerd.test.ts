import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { createNativeTestRegistry } from "./helpers/native-lifetime";
import { reportFontInput } from "./helpers/report-font";

const native = createNativeTestRegistry();
afterEach(() => native.stop());

test("workerd PDF embeds the unchanged TrueType font with lossless FlateDecode", () =>
  native.run(async (lifetime) => {
    const directory = await mkdtemp(join(tmpdir(), "baro-native-pdf-font-"));
    let script: string;
    try {
      const entrypoint = join(directory, "fixture.ts"),
        output = join(directory, "fixture.js");
      await writeFile(
        entrypoint,
        `import { renderReportPdf } from ${JSON.stringify(resolve("src/server/modules/reports/pdf.ts"))};
export default { async fetch(request) {
  const font = new Uint8Array(await request.arrayBuffer());
  const input = ${JSON.stringify(reportFontInput)};
  const path = new URL(request.url).pathname;
  const original = globalThis.CompressionStream;
  if (path === "/compression-error") globalThis.CompressionStream = class { constructor() { throw new Error("synthetic compression failure"); } };
  try {
    const bytes = await renderReportPdf(path === "/oversize" ? new Uint8Array(4000001) : font, input);
    return new Response(bytes, { headers: { "content-type": "application/pdf" } });
  } catch { return Response.json({ status: "failed" }, { status: 500 }); }
  finally { globalThis.CompressionStream = original; }
}};`,
      );
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
    lifetime.check();
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
    const url = await mf.ready;
    const font = new Uint8Array(
      await Bun.file("public/fonts/BaroReport-Regular.ttf").arrayBuffer(),
    );
    const response = await fetch(url, { method: "POST", body: font, signal: lifetime.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // FontFile2 is the third object. Byte offsets, not decoded-string offsets,
    // locate this binary stream; the font may contain arbitrary byte values.
    const prefix = new TextDecoder().decode(bytes.subarray(0, 1024));
    const match =
      /3 0 obj\n<< \/Length (\d+) \/Filter \/FlateDecode \/Length1 (\d+) >>\nstream\n/.exec(prefix);
    expect(match).not.toBeNull();
    if (!match) throw new Error("Missing compressed synthetic font");
    const start = new TextEncoder().encode(prefix.slice(0, match.index + match[0].length)).length;
    const length = Number(match[1]);
    expect(Number(match[2])).toBe(font.length);
    expect(length).toBeLessThan(font.length / 2);
    const decoded = new Uint8Array(
      await new Response(
        new Blob([bytes.slice(start, start + length)])
          .stream()
          .pipeThrough(new DecompressionStream("deflate")),
      ).arrayBuffer(),
    );
    expect(decoded).toEqual(font);
    expect(new TextDecoder().decode(bytes.slice(start + length, start + length + 10))).toBe(
      "\nendstream",
    );
    expect(bytes.length).toBeLessThan(1_300_000);
    const raw = new TextDecoder().decode(bytes);
    expect(raw).toContain("/FontFile2 3 0 R");
    expect(raw).toContain("/ToUnicode");
    expect(raw).toContain("/CIDToGIDMap");
    expect(raw).toContain("/Count 2");
    if (process.env.BARO_REPORT_EVIDENCE)
      await Bun.write(`${process.env.BARO_REPORT_EVIDENCE}/compressed-font-report.pdf`, bytes);
    for (const path of ["/oversize", "/compression-error"]) {
      const failed = await fetch(new URL(path, url), {
        method: "POST",
        body: font,
        signal: lifetime.signal,
      });
      expect(failed.status).toBe(500);
      expect((await failed.json()) as { status: string }).toEqual({ status: "failed" });
    }
  }));
