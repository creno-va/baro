import type { BetterAuthPlugin } from "better-auth";
import { z } from "zod";

export const APPLE_CALLBACK_BODY_BYTES = 16384;
const stateSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const nameSchema = z.object({
  name: z
    .strictObject({
      firstName: z.string().max(128).optional(),
      lastName: z.string().max(128).optional(),
    })
    .optional(),
});
export function isAppleFormCallback(request?: Request) {
  if (request?.method !== "POST") return false;
  const url = new URL(request.url);
  return (
    url.pathname === "/api/auth/callback/apple" &&
    request.headers.get("origin") === "https://appleid.apple.com"
  );
}
/** Bound and normalize Apple's form before the SDK's state-checked POST -> same-origin GET relay. */
export function createAppleCallbackBoundary(): BetterAuthPlugin {
  return {
    id: "baro-apple-callback",
    async onRequest(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/api/auth/callback/apple" || request.method !== "POST") return;
      const reject = (status: 400 | 413) => ({
        response: Response.json(
          { error: { code: "INVALID_APPLE_CALLBACK", message: "로그인을 다시 시작해 주세요." } },
          {
            status,
            headers: {
              "cache-control": "private, no-store",
              "referrer-policy": "no-referrer",
              "x-content-type-options": "nosniff",
            },
          },
        ),
      });
      if (
        !isAppleFormCallback(request) ||
        url.search ||
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
          "application/x-www-form-urlencoded"
      )
        return reject(400);
      const reader = request.body?.getReader();
      if (!reader) return reject(400);
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > APPLE_CALLBACK_BODY_BYTES) {
            void reader.cancel().catch(() => {});
            return reject(413);
          }
          chunks.push(value);
        }
      } catch {
        return reject(400);
      } finally {
        reader.releaseLock();
      }
      try {
        const buffer = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const form = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
        for (const key of new Set(form.keys()))
          if (form.getAll(key).length !== 1) return reject(400);
        const state = stateSchema.parse(form.get("state")),
          code = form.get("code"),
          error = form.get("error");
        if (Boolean(code) === Boolean(error)) return reject(400);
        const normalized = new URLSearchParams({ state });
        if (error) normalized.set("error", "access_denied");
        else {
          normalized.set(
            "code",
            z
              .string()
              .min(1)
              .max(2048)
              .regex(/^[\x21-\x7E]+$/)
              .parse(code),
          );
          const user = form.get("user");
          if (user) normalized.set("user", JSON.stringify(nameSchema.parse(JSON.parse(user))));
        }
        const headers = new Headers(request.headers);
        headers.delete("content-length");
        headers.set("content-type", "application/x-www-form-urlencoded");
        return {
          request: new Request(url, { method: "POST", headers, body: normalized.toString() }),
        };
      } catch {
        return reject(400);
      }
    },
  };
}
