import {
  type V2LookupToolId,
  v2LookupRequestSchema,
  v2LookupToolIdSchema,
} from "../../../contracts/v2";
import type { V2Core } from "../../db/v2-core";
import { createV2LookupRepository, type LookupPermit } from "../../db/v2-lookup";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import type { JobLease } from "../../db/v2-workspace";
import type { StoredUserMessage } from "../workspace/stored-message";
import type { LookupConfiguration } from "./catalog";
import { createExternalTools } from "./service";
import type { LookupFetch } from "./transport";

/** Only the encrypted latest operation can supply a target. Model tool IDs do
 * not authorize transmission, and an unknown claim is never replayed. */
export function createWorkspaceLookupRound(
  core: V2Core,
  configuration: LookupConfiguration,
  binding: {
    ownerId: string;
    lease: JobLease;
    latest: StoredUserMessage | null | undefined;
    authorize: () => Promise<boolean>;
    clock?: () => string;
  },
  options: { fetch?: LookupFetch } = {},
) {
  const clock = binding.clock ?? (() => new Date().toISOString());
  const repository = createV2LookupRepository(core, clock);
  return async (tools: V2LookupToolId[]) => {
    if (
      tools.length > 2 ||
      new Set(tools).size !== tools.length ||
      tools.some((tool) => !v2LookupToolIdSchema.safeParse(tool).success)
    )
      throw new Error("LOOKUP_INVALID_TOOL_ROUND");
    const service = createExternalTools(configuration, { ...options, clock });
    const results = [];
    for (const tool of tools) {
      const raw = binding.latest?.lookupRequests?.find((request) => request.tool === tool);
      const selected = raw ? v2LookupRequestSchema.parse(raw) : undefined;
      let permit: LookupPermit | null = null;
      results.push(
        await service.execute(tool, selected?.target ?? null, {
          authorize: async () => (permit ? repository.authorize(permit) : binding.authorize()),
          reserve: async () => {
            const issued = await repository.claim(
              { ownerId: binding.ownerId, now: clock() },
              binding.lease,
              tool,
            );
            if (!issued) return false;
            permit = issued;
            if (
              !selected ||
              (await runtimeDigest(selected)) !== (await runtimeDigest(issued.request))
            ) {
              await repository.observe(issued, "not_sent");
              return false;
            }
            return true;
          },
          observeTransport: async (transport) => {
            if (permit && !(await repository.observe(permit, transport)))
              throw new Error("LOOKUP_OBSERVATION_CONFLICT");
          },
          signal: new AbortController().signal,
        }),
      );
    }
    return results;
  };
}
