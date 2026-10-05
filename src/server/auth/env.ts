import { z } from "zod";

const authEnvironmentSchema = z.object({
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  NAVER_CLIENT_ID: z.string().min(1),
  NAVER_CLIENT_SECRET: z.string().min(1),
  KAKAO_CLIENT_ID: z.string().min(1),
  KAKAO_CLIENT_SECRET: z.string().min(1),
});

export type AuthEnvironment = z.infer<typeof authEnvironmentSchema>;

export function parseAuthEnvironment(env: Env): AuthEnvironment {
  const result = authEnvironmentSchema.safeParse(env);

  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`AUTH_CONFIGURATION_INVALID:${missing}`);
  }

  return result.data;
}
