import type { z } from "zod";
import { ApiError } from "./errors";

export function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError("UNAVAILABLE", "서버 응답을 확인하지 못했어요. 다시 시도해 주세요.", true);
  return result.data;
}
