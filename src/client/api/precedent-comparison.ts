import { createJsonRequester } from "@baro/api-client";
import { createSessionBoundClient } from "@baro/client-core";
import { opaqueIdSchema } from "../../contracts";
import { v2AcceptedOperationSchema, v2JobSchema } from "../../contracts/v2";
import {
  type V2PrecedentComparisonRequest,
  v2PrecedentComparisonRequestSchema,
  v2PrecedentComparisonStateSchema,
} from "../../contracts/v2/precedent-comparison";
import { browserSessionScope } from "./context";
import { apiRequest } from "./core";

export const precedentComparisonApi = createSessionBoundClient(browserSessionScope, () => {
  const json = createJsonRequester({
    transport: apiRequest,
    scope: browserSessionScope,
    newKey: () => crypto.randomUUID(),
  });
  const keys = new Map<string, string>();
  const base = (id: string) => `/api/v2/cases/${encodeURIComponent(opaqueIdSchema.parse(id))}`;
  return {
    async start(id: string, raw: V2PrecedentComparisonRequest, signal?: AbortSignal) {
      const body = v2PrecedentComparisonRequestSchema.parse(raw);
      const signature = JSON.stringify({ id, body });
      const key = keys.get(signature) ?? crypto.randomUUID();
      keys.set(signature, key);
      if (keys.size > 30) keys.delete(keys.keys().next().value ?? "");
      return v2AcceptedOperationSchema.parse(
        await json({
          path: `${base(id)}/precedents/compare`,
          method: "POST",
          body,
          key,
          ...(signal ? { signal } : {}),
        }),
      );
    },
    async get(id: string, jobId: string, signal?: AbortSignal) {
      return v2PrecedentComparisonStateSchema.parse(
        await json({
          path: `${base(id)}/precedents/comparisons/${encodeURIComponent(opaqueIdSchema.parse(jobId))}`,
          ...(signal ? { signal } : {}),
        }),
      );
    },
    async latest(id: string, signal?: AbortSignal) {
      return v2JobSchema
        .nullable()
        .parse(
          await json({ path: `${base(id)}/workspace-jobs/latest`, ...(signal ? { signal } : {}) }),
        );
    },
  };
});
