import {
  type DirectorySearch,
  directoryPageSchema,
  directorySearchSchema,
} from "@baro/contracts/v2/directory";
import { decode } from "./decode";
import { ApiError } from "./errors";
import type { JsonRequest } from "./http";

export type DirectoryFilters = {
  query?: string;
  region?: string;
  practiceArea?: string;
};
export function createDirectoryClient(request: JsonRequest) {
  return {
    async listPage(filters: DirectoryFilters = {}, cursor?: string, signal?: AbortSignal) {
      const parsed = directorySearchSchema.safeParse({
        limit: 20,
        ...(filters.query?.trim() ? { name: filters.query.trim() } : {}),
        ...(filters.region ? { region: filters.region } : {}),
        ...(filters.practiceArea ? { legalField: filters.practiceArea } : {}),
        ...(cursor ? { cursor } : {}),
      });
      if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "검색 조건을 확인해 주세요.");
      const search: DirectorySearch = parsed.data;
      const params = new URLSearchParams({ limit: String(search.limit) });
      for (const key of ["name", "region", "legalField", "cursor"] as const)
        if (search[key]) params.set(key, search[key]);
      return decode(
        directoryPageSchema,
        await request({
          path: `/api/v2/lawyers/directory?${params}`,
          ...(signal ? { signal } : {}),
        }),
      );
    },
  };
}
