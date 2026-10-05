import { z } from "zod";

const base = process.argv[2];
const sha = process.argv[3];
if (
  !base ||
  !sha ||
  !/^[a-f0-9]{40}$/.test(sha) ||
  !/^https:\/\/(preview\.)?baro\.site$/.test(base)
)
  throw new Error("Known HTTPS domain and release SHA required");
for (const path of ["/api/health/live", "/api/health/ready"]) {
  let passed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = z
        .object({
          release: z.string(),
          service: z.literal("baro"),
          status: z.literal(path.endsWith("ready") ? "ready" : "ok"),
          environment: z.literal(base.includes("preview.") ? "preview" : "production"),
          ...(path.endsWith("ready") ? { schemaVersion: z.string().min(1) } : {}),
        })
        .parse(await response.json());
      if (body.release !== sha) throw new Error("Wrong release");
      if (!response.headers.get("x-request-id")) throw new Error("Missing correlation");
      passed = true;
      break;
    } catch {
      if (attempt < 2) await Bun.sleep(2_000);
    }
  }
  if (!passed) throw new Error(`Foundation smoke failed: ${path}`);
}
console.log(`Foundation smoke passed: ${base} ${sha}`);
