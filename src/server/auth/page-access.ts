import { getSessionCookie } from "better-auth/cookies";
import { drizzle } from "drizzle-orm/d1";
import type { Context, MiddlewareHandler } from "hono";
import { renderUnavailableDocument } from "../../components/ui/unavailable-document";
import type { ApiEnvironment } from "../api/errors";
import * as schema from "../db/schema";
import { hasCurrentConsent } from "../modules/consent/service";
import { getSession } from "./session";

function isPage(path: string, page: "/app" | "/login"): boolean {
  try {
    // Match aliases before Astro decodes/renders them, including encoded or repeated slashes.
    const decoded = decodeURIComponent(path).replaceAll("\\", "/").replace(/\/+/g, "/");
    const canonical = new URL(decoded, "https://baro.invalid").pathname;
    return canonical === page || canonical === `${page}/`;
  } catch {
    return false;
  }
}

function unavailable(context: Context<ApiEnvironment>, betaClosed = false) {
  context.header("retry-after", "30");
  return context.html(renderUnavailableDocument(betaClosed), 503);
}

async function activeSession(context: Context<ApiEnvironment>) {
  // Cookie presence is not authentication. Anonymous visitors need no configured provider.
  if (!getSessionCookie(context.req.raw)) return null;
  const session = await getSession(context);
  if (!session) return null;
  const deleted = await context.env.DB.prepare(
    "SELECT target_id FROM v2_tombstones WHERE target_kind='account' AND target_id=?",
  )
    .bind(session.user.id)
    .first();
  return deleted ? null : session;
}

async function loginEntry(context: Context<ApiEnvironment>) {
  try {
    if (await activeSession(context)) return context.redirect("/app", 302);
  } catch {
    return unavailable(context);
  }
  return undefined;
}

async function appEntry(context: Context<ApiEnvironment>, syntheticFixture: boolean, path: string) {
  if (context.env.APP_ENV === "production" && context.env.PUBLIC_BETA_ENABLED !== "true")
    return unavailable(context, true);
  if (!(syntheticFixture && context.env.APP_ENV === "local")) {
    try {
      const session = await activeSession(context);
      if (!session) return context.redirect("/login", 302);
      if (!(await hasCurrentConsent(drizzle(context.env.DB, { schema }), session.user.id)))
        return context.redirect("/consent", 302);
    } catch {
      // Dependency failures are not anonymous sessions: never start an OAuth redirect loop.
      return unavailable(context);
    }
  }
  if (path !== "/app" && path !== "/app/") return context.redirect("/app", 302);
  return undefined;
}

/** Only a build-time fixture may opt in; request headers, query and cookies never bypass auth. */
export function createPageAccess({
  syntheticFixture = false,
}: {
  syntheticFixture?: boolean;
} = {}): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const path = new URL(context.req.url).pathname;
    const loginPage = isPage(path, "/login");
    if (!loginPage && !isPage(path, "/app")) {
      await next();
      return;
    }
    try {
      if (!["GET", "HEAD"].includes(context.req.method)) {
        context.header("allow", "GET, HEAD");
        context.res = context.text("Method Not Allowed", 405);
        return;
      }
      const response = loginPage
        ? await loginEntry(context)
        : await appEntry(context, syntheticFixture, path);
      if (response) {
        context.res = response;
        return;
      }
      await next();
      return;
    } finally {
      // Apply after session refresh and SSR so neither cookies nor private HTML can be cached.
      context.header("cache-control", "private, no-store, no-transform");
      context.header("x-content-type-options", "nosniff");
    }
  };
}
