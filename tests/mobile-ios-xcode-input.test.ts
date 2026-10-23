import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { verifyPinnedXcodeCompilerInput } from "../scripts/mobile-ios-xcode-input";

const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
test("compiler reuse pins the original unaccepted observation and complete archive before any SDK operation", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "baro-xcode-pin-test-")),
    source = "a".repeat(40),
    directory = resolve(root, "input/ios-xcode-control"),
    body = Buffer.from("synthetic-not-a-simulator-archive");
  try {
    await mkdir(directory, { recursive: true });
    await mkdir(resolve(root, "tests/fixtures"), { recursive: true });
    const original = JSON.parse(
      await readFile("docs/quality/mobile-ios-host-2026-10-23/inspection-7294145.json", "utf8"),
    );
    const inspection = {
      ...original,
      sourceSha: source,
      archive: {
        name: `unaccepted-simulator-${source}.zip`,
        bytes: body.length,
        sha256: hash(body),
      },
    };
    const raw = Buffer.from(JSON.stringify(inspection)),
      fixture = {
        version: 1,
        sourceSha: source,
        workflowRunId: "1",
        artifactId: "2",
        artifactName: `mobile-ios-xcode-control-${source}`,
        inspectionSha256: hash(raw),
      };
    await writeFile(resolve(directory, "inspection.json"), raw);
    await writeFile(resolve(directory, inspection.archive.name), body);
    await writeFile(
      resolve(root, "tests/fixtures/ios-xcode-compiler-input.json"),
      JSON.stringify(fixture),
    );
    expect(
      (await verifyPinnedXcodeCompilerInput(root, resolve(root, "input"))).inspection.accepted,
    ).toBe(false);
    await writeFile(resolve(directory, inspection.archive.name), Buffer.from("modified"));
    await expect(verifyPinnedXcodeCompilerInput(root, resolve(root, "input"))).rejects.toThrow(
      "XCODE_INPUT_ARCHIVE_CHANGED",
    );
    await writeFile(resolve(directory, inspection.archive.name), body);
    await writeFile(
      resolve(directory, "inspection.json"),
      JSON.stringify({ ...inspection, accepted: true }),
    );
    await expect(verifyPinnedXcodeCompilerInput(root, resolve(root, "input"))).rejects.toThrow(
      "XCODE_INPUT_INSPECTION_CHANGED",
    );
    await writeFile(resolve(directory, "inspection.json"), raw);
    await writeFile(
      resolve(root, "tests/fixtures/ios-xcode-compiler-input.json"),
      JSON.stringify({ ...fixture, sourceSha: "b".repeat(40) }),
    );
    await expect(verifyPinnedXcodeCompilerInput(root, resolve(root, "input"))).rejects.toThrow(
      "XCODE_INPUT_IDENTITY_MISMATCH",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
