import { type CreateCaseRequest, createCaseResponseSchema } from "../../../contracts";
import { createCaseDataCipher } from "../../crypto";
import { createDomainRepository } from "../../db/repository";

export async function requestHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function domainRepository(env: Env) {
  return createDomainRepository(env.DB, await createCaseDataCipher(env));
}
export async function verifyTurnstile(env: Env, token: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    return (
      response.ok &&
      data.success === true &&
      data.hostname === new URL(env.BETTER_AUTH_URL).hostname &&
      data.action === "case_create"
    );
  } catch {
    return false;
  }
}
export async function admitCase(
  env: Env,
  ownerId: string,
  key: string,
  input: CreateCaseRequest,
  now: string,
  verify = verifyTurnstile,
) {
  const repo = await domainRepository(env);
  const hash = await requestHash({ narrative: input.narrative });
  const replay = async () => {
    const record = await repo.findCreateIdempotency(ownerId, key, now);
    return record
      ? record.requestHash === hash
        ? {
            kind: "created" as const,
            response: createCaseResponseSchema.parse(JSON.parse(record.responseJson)),
          }
        : { kind: "conflict" as const }
      : null;
  };
  const existing = await replay();
  if (existing) return existing;
  if (!(await verify(env, input.turnstileToken))) return { kind: "challenge" as const };
  try {
    const committed = await repo.commitInitialCase({
      ownerId,
      caseId: crypto.randomUUID(),
      analysisId: crypto.randomUUID(),
      outboxId: crypto.randomUUID(),
      idempotencyKey: key,
      requestHash: hash,
      input: JSON.stringify({ narrative: input.narrative }),
      now,
    });
    if (committed.created) return { kind: "created" as const, response: committed.response };
    return (await replay()) ?? { kind: "quota" as const };
  } catch (error) {
    const winner = await replay();
    if (winner) return winner;
    throw error;
  }
}
