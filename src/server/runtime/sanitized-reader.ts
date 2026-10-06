import type { V2Core } from "../db/v2-core";
import { createAssetProcessingService } from "../modules/file-processing/assets";
import { ProcessingError } from "../modules/file-processing/protocol";
import { authorize, type ProcessingCosts } from "../modules/file-processing/transport";
import type { PrivateBucket } from "../modules/files/service";
import {
  authorizePublicationRead,
  type OpenPublicationSanitizedAsset,
  type PublicationSanitizedInput,
} from "../modules/lawyers/publication";
import type { OpenSanitizedAsset } from "../modules/lawyers/sanitized";

/** Read-only composition. Publication's issued capability owns the aggregate
 * GET/PUT hold; moderator reads require a separate server maintenance port.
 * Neither path creates a processing job or calls a native/model processor. */
export function createSanitizedReaders(
  core: V2Core,
  options: {
    environment: "preview" | "production";
    bucket: PrivateBucket;
    clock?: () => string;
    maintenanceCosts?: ProcessingCosts;
  },
): { publication: OpenPublicationSanitizedAsset; moderation: OpenSanitizedAsset } {
  const decoder = (costs: ProcessingCosts) =>
    createAssetProcessingService(core, {
      environment: options.environment,
      instanceId: "ready-sanitized-reader",
      bucket: options.bucket,
      costs,
      ...(options.clock ? { clock: options.clock } : {}),
    });
  const publication: OpenPublicationSanitizedAsset = async (rawInput) => {
    // Preserve the canonical permit identity while freezing the exact scope.
    const input: PublicationSanitizedInput = Object.freeze({ ...rawInput });
    const permitted = () => authorizePublicationRead(input);
    if (!(await permitted()) || !input.approvedReadPermit)
      throw new ProcessingError("BUDGET_UNAVAILABLE");
    const held = input.approvedReadPermit;
    const costs: ProcessingCosts = {
      async before(request, access) {
        if (
          request.service !== "requests" ||
          request.action !== "r2_get" ||
          !(await permitted()) ||
          !(await authorize(access)) ||
          !(await permitted())
        )
          return null;
        return held;
      },
      // The publication service owns transport aggregation and settlement.
      async after() {},
    };
    const decoded = await decoder(costs).openSanitized(input);
    if (!(await permitted())) {
      await decoded.body.cancel().catch(() => {});
      throw new ProcessingError("STALE_REVISION");
    }
    const reader = decoded.body.getReader();
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          let bytes: Uint8Array | undefined;
          try {
            if (!(await permitted())) throw new ProcessingError("STALE_REVISION");
            const chunk = await reader.read();
            bytes = chunk.value;
            if (!(await permitted())) throw new ProcessingError("STALE_REVISION");
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
          } catch (error) {
            bytes?.fill(0);
            await reader.cancel().catch(() => {});
            controller.error(
              error instanceof ProcessingError ? error : new ProcessingError("FILE_REJECTED"),
            );
          }
        },
        cancel: () => reader.cancel(),
      },
      { highWaterMark: 0 },
    );
    return { byteLength: decoded.byteLength, contentHash: decoded.contentHash, body };
  };
  const moderation: OpenSanitizedAsset = (input) =>
    decoder(
      options.maintenanceCosts ?? {
        before: async () => null,
        after: async () => {},
      },
    ).openSanitized(input);
  return { publication, moderation };
}
