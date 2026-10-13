import { z } from "zod";
import { isolatedDrillResourceSchema } from "./deletion-journal";
import { remoteBudgetD1 } from "./remote-budget-d1";

export const DRILL_ACCOUNT = "9e844969d0c44b2449f3951d1f301654";
export const DRILL_WORK_MS = 6 * 60_000;
export const DRILL_CLEANUP_MS = 90_000;
export const drillPlanSchema = z.strictObject({
  candidateSha: z.string().regex(/^[a-f0-9]{40}$/),
  runId: z.string().regex(/^[1-9][0-9]{0,19}$/),
  runAttempt: z.literal("1"),
  repository: z.literal("creno-va/baro"),
  ref: z.literal("refs/heads/main"),
  event: z.literal("workflow_dispatch"),
  confirmation: z.literal("CREATE_AND_RESTORE_SYNTHETIC_D1"),
});
export type DrillPlan = z.infer<typeof drillPlanSchema>;
export type DrillResource = z.infer<typeof isolatedDrillResourceSchema>;
export type ProtectedDatabases = { ids: Set<string>; names: Set<string> };

/** Include every configured environment, not just the historical hard-coded ID denylist. */
export function configuredDatabases(config: unknown): ProtectedDatabases {
  const ids = new Set<string>(),
    names = new Set<string>();
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "d1_databases") {
        for (const db of z
          .array(z.object({ database_id: z.uuid(), database_name: z.string().min(1) }))
          .parse(item)) {
          ids.add(db.database_id.toLowerCase());
          names.add(db.database_name.toLowerCase());
        }
      } else visit(item);
    }
  }
  visit(config);
  if (!ids.size || !names.size) throw new Error("DRILL_PROTECTED_DATABASES_MISSING");
  return { ids, names };
}

const metadataSchema = z.object({
  uuid: z.uuid(),
  name: z.string(),
  version: z.literal("production"),
});
const bookmarkSchema = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{32}$/);
const envelope = z.object({ success: z.literal(true), result: z.unknown() });

/** No caller-supplied DB ID, name, account, endpoint, restore bookmark or reuse mode. */
export class IsolatedD1 {
  readonly name: string;
  readonly #base = `https://api.cloudflare.com/client/v4/accounts/${DRILL_ACCOUNT}/d1/database`;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #protected: ProtectedDatabases;
  readonly #clock: () => number;
  readonly #workDeadline: number;
  #cleanupDeadline: number | undefined;
  #created: DrillResource | undefined;
  #createAttempted = false;
  #restoreAttempted = false;
  #deleteAttempted = false;
  #bookmark: string | undefined;
  constructor(
    plan: DrillPlan,
    token: string,
    protectedDatabases: ProtectedDatabases,
    fetcher = fetch,
    clock = () => performance.now(),
  ) {
    drillPlanSchema.parse(plan);
    if (!token) throw new Error("DRILL_TOKEN_MISSING");
    this.name = `baro-drill-d1-${plan.runId}`;
    this.#token = token;
    this.#fetch = fetcher;
    this.#clock = clock;
    this.#workDeadline = clock() + DRILL_WORK_MS;
    this.#protected = {
      ids: new Set(protectedDatabases.ids),
      names: new Set(protectedDatabases.names),
    };
    if (!this.#protected.ids.size || this.#protected.names.has(this.name))
      throw new Error("DRILL_PROTECTED_RESOURCE");
  }
  get resource() {
    return this.#created ? { ...this.#created } : undefined;
  }
  get creationAttempted() {
    return this.#createAttempted;
  }
  #signal(cleanup = false) {
    const remaining = (cleanup ? (this.#cleanupDeadline ?? 0) : this.#workDeadline) - this.#clock();
    if (remaining < 1)
      throw new Error(cleanup ? "DRILL_CLEANUP_DEADLINE_EXCEEDED" : "DRILL_WORK_DEADLINE_EXCEEDED");
    return AbortSignal.timeout(Math.min(30_000, Math.floor(remaining)));
  }
  async #request(path: string, method = "GET", body?: unknown, cleanup = false) {
    const signal = this.#signal(cleanup);
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}${path}`, {
        method,
        redirect: "error",
        signal,
        headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error("DRILL_API_OUTCOME_UNKNOWN");
    }
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "DRILL_API_PERMISSION_DENIED"
          : "DRILL_API_REQUEST_FAILED",
      );
    try {
      return envelope.parse(await response.json()).result;
    } catch {
      throw new Error("DRILL_API_RESPONSE_INVALID");
    }
  }
  #safeMetadata(input: unknown) {
    const db = metadataSchema.parse(input);
    const resource = isolatedDrillResourceSchema.parse({
      environment: "isolated-test",
      syntheticOnly: true,
      databaseId: db.uuid,
      databaseName: db.name,
      // Reserved identity fields required by the existing journal contract; no runtime is deployed.
      workerName: this.name,
      workflowName: this.name,
    });
    if (
      resource.databaseName !== this.name ||
      this.#protected.ids.has(resource.databaseId) ||
      this.#protected.names.has(db.name.toLowerCase())
    )
      throw new Error("DRILL_PROTECTED_RESOURCE");
    return resource;
  }
  async create() {
    if (this.#createAttempted) throw new Error("DRILL_CREATE_ALREADY_ATTEMPTED");
    // Fail even for a previous drill's same-name DB. Never adopt a resource found by name.
    const existing = z
      .array(z.unknown())
      .parse(await this.#request(`?name=${this.name}&per_page=100`));
    if (existing.length) throw new Error("DRILL_DATABASE_ALREADY_EXISTS");
    this.#createAttempted = true;
    this.#created = this.#safeMetadata(await this.#request("", "POST", { name: this.name }));
    await this.assertIdentity();
    return { ...this.#created };
  }
  async assertIdentity(cleanup = false) {
    if (!this.#created || this.#deleteAttempted) throw new Error("DRILL_RESOURCE_NOT_AVAILABLE");
    const actual = this.#safeMetadata(
      await this.#request(`/${this.#created.databaseId}`, "GET", undefined, cleanup),
    );
    if (actual.databaseId !== this.#created.databaseId)
      throw new Error("DRILL_RESOURCE_IDENTITY_CHANGED");
  }
  database(): D1Database {
    if (!this.#created) throw new Error("DRILL_RESOURCE_NOT_AVAILABLE");
    const id = this.#created.databaseId;
    const guardedFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) !== `${this.#base}/${id}/query` || init?.method !== "POST")
        throw new Error("DRILL_QUERY_SCOPE_INVALID");
      await this.assertIdentity();
      // The reused D1 adapter decodes only successful per-statement receipts and never logs SQL.
      return this.#fetch(url, { ...init, redirect: "error", signal: this.#signal() });
    }) as typeof fetch;
    return remoteBudgetD1(this.#token, DRILL_ACCOUNT, id, guardedFetch);
  }
  async captureBookmark() {
    if (this.#bookmark) throw new Error("DRILL_BOOKMARK_ALREADY_CAPTURED");
    await this.assertIdentity();
    const result = z
      .object({ bookmark: bookmarkSchema })
      .parse(await this.#request(`/${this.#created?.databaseId}/time_travel/bookmark`));
    this.#bookmark = result.bookmark;
    return result.bookmark;
  }
  async restore() {
    if (!this.#bookmark || this.#restoreAttempted) throw new Error("DRILL_RESTORE_NOT_ALLOWED");
    await this.assertIdentity();
    this.#restoreAttempted = true;
    const result = z
      .object({ bookmark: bookmarkSchema, previous_bookmark: bookmarkSchema })
      .parse(
        await this.#request(
          `/${this.#created?.databaseId}/time_travel/restore?bookmark=${this.#bookmark}`,
          "POST",
        ),
      );
    if (result.bookmark !== this.#bookmark) throw new Error("DRILL_RESTORE_BOOKMARK_MISMATCH");
  }
  async destroy() {
    // Reserve a separate bounded cleanup window; work cannot consume it.
    this.#cleanupDeadline ??= this.#clock() + DRILL_CLEANUP_MS;
    await this.assertIdentity(true);
    this.#deleteAttempted = true;
    await this.#request(`/${this.#created?.databaseId}`, "DELETE", undefined, true);
    // A 404/transport failure alone cannot establish absence; a successful name search must be empty.
    const remaining = z
      .array(z.unknown())
      .parse(await this.#request(`?name=${this.name}&per_page=100`, "GET", undefined, true));
    if (remaining.length) throw new Error("DRILL_CLEANUP_UNCONFIRMED");
  }
}
