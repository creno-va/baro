import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { processorManifestSchema } from "../src/server/modules/file-processing/protocol";

export const videoSamples = [
  {
    name: "video-orange.jpg",
    variable: "READINESS_VIDEO_ORANGE_SHA256",
    timestampSeconds: 1.4,
    frameIndex: 14,
  },
  {
    name: "video-green.jpg",
    variable: "READINESS_VIDEO_GREEN_SHA256",
    timestampSeconds: 3.2,
    frameIndex: 32,
  },
  { name: "video-speech.wav", variable: "READINESS_VIDEO_AUDIO_SHA256" },
] as const;

/** Validate real native artifacts before copying any bytes into the isolated assets. */
export async function prepareVideoAssets(root: string, destination: string) {
  if (Bun.file(`${root}/manifest.json`).size > 128 * 1024)
    throw new Error("SYNTHETIC_VIDEO_ARTIFACT_INVALID");
  const raw = z
    .object({
      artifacts: z
        .array(z.object({ path: z.string().regex(/^artifact-\d{6}\.(?:jpg|wav)$/) }).passthrough())
        .length(11),
    })
    .passthrough()
    .parse(await Bun.file(`${root}/manifest.json`).json());
  const manifest = processorManifestSchema.parse({
    ...raw,
    artifacts: raw.artifacts.map(({ path: _, ...artifact }) => artifact),
  });
  if (
    manifest.probe.category !== "video" ||
    manifest.coverage.category !== "video" ||
    manifest.probe.durationSeconds !== 8 ||
    !manifest.probe.hasAudio ||
    manifest.probe.byteLength !== 66723 ||
    manifest.unit !== 0 ||
    manifest.totalUnits !== 1 ||
    manifest.frameOffset !== 0 ||
    manifest.decodedFrameCount !== 80 ||
    manifest.coverage.sceneFrameCount !== 2 ||
    manifest.coverage.frames.length !== 10
  )
    throw new Error("SYNTHETIC_VIDEO_COVERAGE_INVALID");
  const hashes: Record<string, string> = {};
  for (const artifact of manifest.artifacts) {
    const path = raw.artifacts[artifact.index]?.path;
    const extension = artifact.kind === "audio" ? "wav" : "jpg";
    if (path !== `artifact-${String(artifact.index).padStart(6, "0")}.${extension}`)
      throw new Error("SYNTHETIC_VIDEO_ARTIFACT_INVALID");
    const file = Bun.file(`${root}/${path}`);
    if (file.size !== artifact.byteLength) throw new Error("SYNTHETIC_VIDEO_ARTIFACT_INVALID");
    const bytes = await file.arrayBuffer();
    const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== artifact.byteLength || hash !== artifact.contentHash)
      throw new Error("SYNTHETIC_VIDEO_ARTIFACT_INVALID");
    const selected = videoSamples.find((sample) =>
      "timestampSeconds" in sample
        ? artifact.position.kind === "video" &&
          artifact.position.sampling === "scene_change" &&
          artifact.position.timestampSeconds === sample.timestampSeconds &&
          artifact.position.frameIndex === sample.frameIndex
        : artifact.kind === "audio" &&
          artifact.position.kind === "audio" &&
          artifact.position.startSeconds === 0 &&
          artifact.position.endSeconds === 8,
    );
    if (selected) {
      if (hashes[selected.variable]) throw new Error("SYNTHETIC_VIDEO_ARTIFACT_INVALID");
      await Bun.write(`${destination}/${selected.name}`, bytes);
      hashes[selected.variable] = hash;
    }
  }
  if (Object.keys(hashes).length !== 3) throw new Error("SYNTHETIC_VIDEO_ARTIFACT_INVALID");
  return hashes;
}

if (import.meta.main) {
  let stage = "prepare_input";
  try {
    const root = resolve(".wrangler/goal/ai-native-video");
    await mkdir(root, { recursive: true });
    await Bun.write(
      `${root}/input`,
      await Bun.file("tests/fixtures/media/scenes-speech.mp4").arrayBuffer(),
    );
    const run = async (args: string[]) => {
      const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      const [, , exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exit !== 0) throw new Error("SYNTHETIC_VIDEO_NATIVE_FAILED");
    };
    stage = "build_image";
    await run([
      "docker",
      "build",
      "--platform",
      "linux/amd64",
      "-f",
      "services/file-processor/Dockerfile",
      "-t",
      "baro-ai-video-readiness",
      ".",
    ]);
    stage = "process_video";
    await run([
      "docker",
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--network=none",
      "--read-only",
      "--cpus=2",
      "--memory=1g",
      "--pids-limit=128",
      "--user",
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m",
      "--mount",
      `type=bind,source=${root},target=/work`,
      "--entrypoint",
      "python3",
      "baro-ai-video-readiness",
      "/app/processor.py",
      "/work",
      "process",
      "0",
    ]);
    stage = "verify_artifacts";
    await prepareVideoAssets(root, resolve(".wrangler/goal/ai-probe-fixtures"));
    console.log(
      JSON.stringify({
        check: "synthetic-native-video",
        status: "passed",
        decodedFrames: 80,
        oneSecondFrames: 8,
        sceneFrames: 2,
        selectedFrames: 2,
        audioSeconds: 8,
      }),
    );
  } catch {
    console.error(JSON.stringify({ check: "synthetic-native-video", status: "failed", stage }));
    process.exitCode = 1;
  }
}
