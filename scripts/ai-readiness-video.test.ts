import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareVideoAssets } from "./ai-readiness-video";

test("synthetic inventory cannot substitute altered bytes, paths or frame positions for native video artifacts", async () => {
  // Only a protocol/tamper fixture. This is not decoder, native or model evidence.
  const root = await mkdtemp(join(tmpdir(), "baro-video-inventory-"));
  try {
    const frames = [
      ...Array.from({ length: 8 }, (_, i) => ({
        kind: "video",
        timestampSeconds: i,
        frameIndex: i * 10,
        sampling: "one_second",
      })),
      { kind: "video", timestampSeconds: 1.4, frameIndex: 14, sampling: "scene_change" },
      { kind: "video", timestampSeconds: 3.2, frameIndex: 32, sampling: "scene_change" },
    ];
    const positions = [{ kind: "audio", startSeconds: 0, endSeconds: 8 }, ...frames];
    const artifacts = await Promise.all(
      positions.map(async (position, index) => {
        const bytes = new Uint8Array([index, 1, 2]);
        const path = `artifact-${String(index).padStart(6, "0")}.${index === 0 ? "wav" : "jpg"}`;
        await Bun.write(`${root}/${path}`, bytes);
        return {
          index,
          kind: index === 0 ? "audio" : "frame",
          path,
          position,
          byteLength: bytes.length,
          contentHash: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        };
      }),
    );
    const manifest = {
      version: 1,
      unit: 0,
      totalUnits: 1,
      frameOffset: 0,
      decodedFrameCount: 80,
      probe: {
        category: "video",
        format: "mp4",
        byteLength: 66723,
        durationSeconds: 8,
        hasAudio: true,
      },
      coverage: {
        category: "video",
        durationSeconds: 8,
        status: "partial",
        hasAudio: true,
        audio: {
          durationSeconds: 8,
          status: "partial",
          intervals: [{ startSeconds: 0, endSeconds: 8, status: "missing" }],
        },
        frames: frames.map((f, i) => ({
          id: `frame-${String(i + 1).padStart(6, "0")}`,
          timestampSeconds: f.timestampSeconds,
          frameIndex: f.frameIndex,
          sampling: f.sampling,
          status: "missing",
        })),
        sceneDetection: "complete",
        sceneFrameCount: 2,
      },
      artifacts,
      outputBytes: artifacts.length * 3,
    };
    await Bun.write(`${root}/manifest.json`, JSON.stringify(manifest));
    const output = `${root}/assets`;
    expect(Object.keys(await prepareVideoAssets(root, output))).toHaveLength(3);
    for (const mutate of [
      (m: typeof manifest) => {
        if (m.artifacts[1]) m.artifacts[1].path = "../outside.jpg";
      },
      (m: typeof manifest) => {
        if (m.artifacts[1]) m.artifacts[1].contentHash = "0".repeat(64);
      },
      (m: typeof manifest) => {
        const position = m.artifacts[9]?.position;
        if (position && "frameIndex" in position) position.frameIndex = 13;
      },
    ]) {
      const changed = structuredClone(manifest);
      mutate(changed);
      await Bun.write(`${root}/manifest.json`, JSON.stringify(changed));
      await expect(prepareVideoAssets(root, output)).rejects.toThrow();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
