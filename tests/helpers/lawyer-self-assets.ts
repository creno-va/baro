import { expect } from "bun:test";
import { createV2JobsRepository } from "../../src/server/db/v2-jobs";
import { createV2LawyersRepository } from "../../src/server/db/v2-lawyers";
import { createAssetProcessingService } from "../../src/server/modules/file-processing/assets";
import {
  createProcessorTransport,
  type ProcessingCosts,
} from "../../src/server/modules/file-processing/transport";
import { digest } from "../../src/server/modules/files/binary";
import type { PrivateBucket } from "../../src/server/modules/files/service";
import { createLawyerAssetsService } from "../../src/server/modules/lawyers/assets";
import { fixture } from "./file-processing-fixture";

/** Real SQLite, upload/service, framed AES and D1 intents. Native/paid/R2 are
 * explicit offline ports; actual codecs are proved in separate Linux CI. */
const fixed = (length: number) => {
  let size = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(b, c) {
      size += b.length;
      if (size > length) throw new Error("synthetic fixed limit");
      c.enqueue(b);
    },
    flush() {
      if (size !== length) throw new Error("synthetic incomplete fixed stream");
    },
  });
};
export async function selfAssetFixture(
  options: {
    pdf?: boolean;
    tamper?: boolean;
    advancingClock?: boolean;
    before?: (input: Parameters<ProcessingCosts["before"]>[0]) => void;
    beforeReady?: () => void;
  } = {},
) {
  const f = await fixture();
  let clockCalls = 0;
  const clock = () =>
    new Date(Date.parse(f.actor.now) + (options.advancingClock ? ++clockCalls : 0)).toISOString();
  const bucket = {
    ...f.bucket.port,
    put: async (key: string, body: ReadableStream<Uint8Array> | Uint8Array<ArrayBuffer>) =>
      f.bucket.port.put(
        key,
        body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer()),
      ),
  } as PrivateBucket;
  const lawyers = createV2LawyersRepository(f.core),
    jobs = createV2JobsRepository(f.core);
  const profileId = crypto.randomUUID();
  expect(await lawyers.createProfile(f.actor, profileId)).toBe(true);
  const original = new Uint8Array(
    await Bun.file(
      options.pdf
        ? "tests/fixtures/media/text-two-pages.pdf"
        : "tests/fixtures/media/image-markers.png",
    ).arrayBuffer(),
  );
  const output = new Uint8Array(
    await Bun.file(
      options.pdf
        ? "tests/fixtures/media/text-two-pages.pdf"
        : "tests/fixtures/media/image-markers.jpg",
    ).arrayBuffer(),
  );
  const assets = createLawyerAssetsService(f.core, {
    environment: "preview",
    bucket,
    clock,
    testOnlyUnmeteredStorage: true,
    fixedLengthStream: fixed,
  });
  const reserved = await assets.reserve(
    f.actor.ownerId,
    1,
    crypto.randomUUID(),
    {
      purpose: options.pdf ? "portfolio" : "profile_photo",
      name: options.pdf ? "synthetic.pdf" : "synthetic.png",
      byteLength: original.length,
      mediaType: options.pdf ? "application/pdf" : "image/png",
    },
    "portfolio",
  );
  await assets.upload(
    f.actor.ownerId,
    reserved.assetId,
    1,
    original.length,
    new Response(original).body,
  );
  const jobId = crypto.randomUUID();
  expect(
    await jobs.admitAsset(f.actor, { assetId: reserved.assetId, assetRevision: 2, jobId }),
  ).toBe(true);
  const granted = await jobs.acquire(
    f.actor,
    jobId,
    crypto.randomUUID(),
    new Date(Date.parse(f.actor.now) + 300000).toISOString(),
  );
  if (!granted) throw new Error("Synthetic actual lease missing");
  const params = {
    ownerId: f.actor.ownerId,
    profileId,
    assetId: reserved.assetId,
    assetRevision: 2,
    jobId,
  };
  const receipts: string[] = [];
  let nativeCalls = 0;
  const costs: ProcessingCosts = {
    before: async (input) => {
      options.before?.(input);
      return { attemptId: crypto.randomUUID(), dispatchToken: null };
    },
    after: async (_, r) => {
      receipts.push(r.transport);
    },
  };
  const processor = createProcessorTransport({
    costs,
    stop: async () => {},
    fetch: async (request) => {
      nativeCalls++;
      expect(new Uint8Array(await request.arrayBuffer())).toEqual(original);
      const manifest = {
        version: 1,
        passes: 2,
        probe: options.pdf
          ? { category: "document", format: "pdf", byteLength: original.length, pageCount: 2 }
          : {
              category: "image",
              format: "png",
              byteLength: original.length,
              width: 720,
              height: 420,
            },
        format: options.pdf ? "pdf" : "jpeg",
        byteLength: output.length,
        contentHash: await digest(output),
        chunkCount: 1,
      };
      const changed = output.slice();
      if (options.tamper) changed[0] = (changed[0] ?? 0) ^ 1;
      return new Response(
        `${[
          { type: "sanitized_manifest", value: manifest },
          {
            type: "sanitized_chunk",
            pass: 0,
            index: 0,
            data: btoa(String.fromCharCode(...output)),
          },
          {
            type: "sanitized_chunk",
            pass: 1,
            index: 0,
            data: btoa(String.fromCharCode(...changed)),
          },
          { type: "complete" },
        ]
          .map((r) => JSON.stringify(r))
          .join("\n")}\n`,
      );
    },
  });
  const processingFor = (currentJobId: string) =>
    createAssetProcessingService(
      {
        ...f.core,
        encrypt: async (...args: Parameters<typeof f.core.encrypt>) => {
          if (args[0] === "v2_assets" && args[3] === 3) options.beforeReady?.();
          return f.core.encrypt(...args);
        },
      },
      {
        environment: "preview",
        instanceId: `${currentJobId}-1`,
        bucket,
        processor,
        costs,
        clock,
        fixedLength: fixed,
        openOriginal: (input, authorized) => assets.openOriginal(input, authorized),
      },
    );
  const processing = processingFor(jobId);
  return {
    ...f,
    processingFor,
    bucketPort: bucket,
    lawyers,
    jobs,
    params,
    lease: granted.lease,
    processing,
    nativeCalls: () => nativeCalls,
    receipts,
    original,
    assets,
    output,
  };
}
