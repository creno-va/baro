import { selfProfileSchema } from "../src/contracts/v2/self-profile";
import { FRESH_DATABASES } from "./fresh-application-data";

type Binding = { name: string; type: string; id?: string; text?: string; [key: string]: unknown };
type Settings = { bindings: Binding[]; [key: string]: unknown };
type Deployment = { versions: { version_id: string; percentage: number }[] };
export function bindingPatch(settings: Settings, databaseId: string): Settings {
  if (
    !Object.values(FRESH_DATABASES).some((db) => db.id === databaseId || db.original === databaseId)
  )
    throw new Error("FRESH_BINDING_TARGET_INVALID");
  if (settings.bindings.filter((b) => b.name === "DB" && b.type === "d1").length !== 1)
    throw new Error("FRESH_BINDING_MISSING");
  return {
    ...settings,
    annotations: Object.fromEntries(
      Object.entries((settings.annotations ?? {}) as Record<string, unknown>).filter(
        ([key]) => key !== "workers/triggered_by",
      ),
    ),
    bindings: settings.bindings.map((b) =>
      b.name === "DB"
        ? { name: "DB", type: "d1", id: databaseId }
        : b.type === "secret_text"
          ? { name: b.name, type: "inherit" }
          : b,
    ),
  };
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
export function assertBindingsPreserved(before: Settings, after: Settings, id: string) {
  const other = (s: Settings) =>
    s.bindings.filter((b) => b.name !== "DB").sort((a, b) => a.name.localeCompare(b.name));
  if (
    canonical(other(before)) !== canonical(other(after)) ||
    after.bindings.find((b) => b.name === "DB")?.id !== id
  )
    throw new Error("FRESH_BINDING_VERIFICATION_FAILED");
}

export async function transitionFreshBinding(
  environment: keyof typeof FRESH_DATABASES,
  token: string,
  fetcher = fetch,
) {
  const target = FRESH_DATABASES[environment];
  const base = `https://api.cloudflare.com/client/v4/accounts/9e844969d0c44b2449f3951d1f301654/workers/scripts/baro-${environment}`;
  async function api<T>(path: string, method = "GET", body?: BodyInit, json = false): Promise<T> {
    const response = await fetcher(base + path, {
      method,
      ...(body === undefined ? {} : { body }),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    const value = (await response.json()) as {
      success: boolean;
      result: T;
      errors?: { code: number }[];
    };
    if (!response.ok || !value.success)
      throw new Error(
        `FRESH_WORKER_API_FAILED_${response.status}_${
          value.errors
            ?.map((e) => e.code)
            .filter(Number.isSafeInteger)
            .join("_") ?? "UNKNOWN"
        }`,
      );
    return value.result;
  }
  const before = await api<Settings>("/settings");
  const alreadyConnected = before.bindings.find((b) => b.name === "DB")?.id === target.id;
  if (!alreadyConnected && before.bindings.find((b) => b.name === "DB")?.id !== target.original)
    throw new Error("FRESH_ORIGINAL_BINDING_REQUIRED");
  const previous = (await api<{ deployments: Deployment[] }>("/deployments")).deployments[0];
  const latest = (await api<{ items: { id: string }[] }>("/versions")).items[0]?.id;
  if (
    !latest ||
    previous?.versions.length !== 1 ||
    previous.versions[0]?.percentage !== 100 ||
    previous.versions[0]?.version_id !== latest
  )
    throw new Error("FRESH_ACTIVE_VERSION_REQUIRED");
  const runtime = (
    await api<{ resources: { script_runtime: { exports?: unknown; containers?: unknown } } }>(
      `/versions/${latest}`,
    )
  ).resources.script_runtime;
  async function apply(id: string) {
    const current = await api<Settings>("/settings");
    const form = new FormData();
    form.set(
      "settings",
      new Blob(
        [
          JSON.stringify(
            bindingPatch(
              {
                ...current,
                ...(runtime.exports ? { exports: runtime.exports } : {}),
                ...(runtime.containers ? { containers: runtime.containers } : {}),
              },
              id,
            ),
          ),
        ],
        { type: "application/json" },
      ),
      "settings",
    );
    await api("/settings", "PATCH", form);
    const version = (await api<{ items: { id: string }[] }>("/versions")).items[0]?.id;
    const deployment = (await api<{ deployments: Deployment[] }>("/deployments")).deployments[0];
    if (!version) throw new Error("FRESH_VERSION_MISSING");
    if (
      deployment?.versions.length !== 1 ||
      deployment.versions[0]?.version_id !== version ||
      deployment.versions[0]?.percentage !== 100
    )
      await api(
        "/deployments",
        "POST",
        JSON.stringify({
          strategy: "percentage",
          versions: [{ version_id: version, percentage: 100 }],
        }),
        true,
      );
    assertBindingsPreserved(before, await api<Settings>("/settings"), id);
  }
  const origin = environment === "preview" ? "https://preview.baro.site" : "https://baro.site";
  try {
    if (!alreadyConnected) await apply(target.id);
    const health = await fetcher(`${origin}/api/health/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const ready = (await health.json()) as {
      status: string;
      schemaVersion: string;
      releaseSha: string;
    };
    if (
      !health.ok ||
      ready.status !== "ready" ||
      ready.schemaVersion !== "0018_external_lookup_admission"
    )
      throw new Error("FRESH_READINESS_FAILED");
    const directory = await fetcher(`${origin}/api/v2/lawyers/self-service`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const body = (await directory.json()) as { items: { id: string }[] };
    if (
      !directory.ok ||
      body.items?.length !== 10 ||
      body.items.some((p) => !p.id.startsWith("synthetic-lawyer-"))
    )
      throw new Error("FRESH_DIRECTORY_FAILED");
    for (const item of body.items) {
      const response = await fetcher(`${origin}/api/v2/lawyers/self-service/${item.id}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      const profile = selfProfileSchema.parse(await response.json());
      if (
        !response.ok ||
        profile.id !== item.id ||
        !profile.published ||
        profile.verificationStatus !== "self_declared" ||
        !profile.introduction.includes("합성 프로필")
      )
        throw new Error("FRESH_PUBLIC_PROFILE_FAILED");
    }
    return {
      environment,
      databaseId: target.id,
      originalDatabasePreserved: true,
      publicProfiles: 10,
      previousVersion: latest,
      release: before.bindings.find((b) => b.name === "RELEASE_SHA")?.text,
      at: new Date().toISOString(),
    };
  } catch (error) {
    if (alreadyConnected) throw error;
    try {
      await apply(target.original);
    } catch {
      throw new Error("FRESH_BINDING_ROLLBACK_REQUIRED");
    }
    throw error;
  }
}
