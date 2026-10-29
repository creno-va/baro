import { expect, test } from "bun:test";
import {
  assertEmpty,
  assertFreshTarget,
  FRESH_CONFIRMATION,
  FRESH_DATABASES,
  verifyFreshState,
} from "../scripts/fresh-application-data";
import { bindingPatch, transitionFreshBinding } from "../scripts/fresh-database-binding";
import { prepareSyntheticLawyers } from "../scripts/synthetic-lawyer-seed";
import { emptySelfProfile } from "../src/contracts/v2/self-profile";
import { createV2Core } from "../src/server/db/v2-core";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { createTestDatabase } from "./helpers/d1";

test("binding-only transition preserves other settings and restores original DB when public readiness fails", async () => {
  const target = FRESH_DATABASES.preview;
  let settings = {
    bindings: [
      { name: "DB", type: "d1", id: target.original },
      { name: "CASE_DATA_KEY_V1", type: "secret_text" },
      { name: "RELEASE_SHA", type: "plain_text", text: "original-release" },
    ],
    compatibility_date: "2026-10-01",
  };
  const patch = bindingPatch(settings, target.id);
  expect(patch.bindings.find((b) => b.name === "CASE_DATA_KEY_V1")).toEqual({
    name: "CASE_DATA_KEY_V1",
    type: "inherit",
  });
  expect(patch.compatibility_date).toBe(settings.compatibility_date);
  let version = "original",
    deployed = "original";
  const switches: string[] = [];
  const mock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    let result: unknown;
    if (url.endsWith("/settings") && init?.method === "PATCH") {
      const payload = JSON.parse(String((init.body as FormData).get("settings"))) as typeof patch;
      const id = payload.bindings.find((b) => b.name === "DB")?.id;
      expect(typeof id).toBe("string");
      switches.push(String(id));
      settings = {
        ...settings,
        bindings: settings.bindings.map((b) =>
          b.name === "DB" ? { ...b, id: id as typeof target.original } : b,
        ),
      };
      version = `version-${switches.length}`;
      result = settings;
    } else if (url.endsWith("/settings")) result = settings;
    else if (url.endsWith("/versions")) result = { items: [{ id: version }] };
    else if (url.endsWith("/deployments") && init?.method === "POST") {
      deployed = version;
      result = {};
    } else if (url.endsWith("/deployments"))
      result = { deployments: [{ versions: [{ version_id: deployed, percentage: 100 }] }] };
    else if (url.endsWith("/api/health/ready"))
      return Response.json({ status: "not_ready" }, { status: 503 });
    else throw new Error("unexpected request");
    return Response.json({ success: true, result });
  }) as typeof fetch;
  await expect(transitionFreshBinding("preview", "synthetic-token", mock)).rejects.toThrow(
    "FRESH_READINESS_FAILED",
  );
  expect(switches).toEqual([target.id, target.original]);
  expect(settings.bindings.find((b) => b.name === "DB")?.id).toBe(target.original);
  expect(emptySelfProfile("synthetic").verificationStatus).toBe("self_declared");
});

import { reportFixture } from "./helpers/report-fixture";

test("fresh writer rejects either original database and any unknown target", () => {
  for (const environment of ["preview", "production"] as const) {
    expect(() => assertFreshTarget(environment, FRESH_DATABASES[environment].id)).not.toThrow();
    for (const id of [...Object.values(FRESH_DATABASES).map((v) => v.original), "unknown"])
      expect(() => assertFreshTarget(environment, id)).toThrow("FRESH_TARGET_REQUIRED");
  }
});

test("existing schema is rejected before a fresh preparation can write", async () => {
  const db = await createTestDatabase();
  try {
    await expect(assertEmpty(db.binding)).rejects.toThrow("FRESH_DATABASE_NOT_EMPTY");
  } finally {
    db.close();
  }
});

test("fresh migrated database publishes exactly ten readable synthetic profiles without cases or sessions", async () => {
  const fixture = await reportFixture();
  const db = await createTestDatabase();
  try {
    const seed = await prepareSyntheticLawyers(fixture.core.cipher, new Date().toISOString());
    db.sqlite.exec(seed.sql);
    expect((await verifyFreshState(db.binding)).users).toBe(10);
    const service = createSelfProfileService(createV2Core(db.binding, fixture.core.cipher));
    for (const item of seed.profiles) {
      const actual = await service.get(item.id);
      expect(actual.name).toBe(item.name);
      expect(actual.published).toBe(true);
      expect(actual.verificationStatus).toBe("self_declared");
      expect(actual.introduction).toContain("합성 프로필");
    }
  } finally {
    db.close();
    fixture.db.close();
  }
});

test("fresh operator requires exact main, operator, environment secrets and sequential preview success", async () => {
  const workflow = (
    await Bun.file(".github/workflows/fresh-application-data.yml").text()
  ).replaceAll("\r\n", "\n");
  expect(workflow).toContain(`inputs.confirmation == '${FRESH_CONFIRMATION}'`);
  expect(workflow.match(/github\.sha == inputs\.target_sha/g)).toHaveLength(2);
  expect(workflow.match(/github\.triggering_actor == 'hyunhomon'/g)).toHaveLength(2);
  expect(workflow).toContain("production:\n    needs: preview");
  expect(workflow).toContain("secrets.CASE_DATA_KEY_V1");
  expect(workflow).not.toMatch(/wrangler deploy|reset-application-data|secret put|path:.*\.sql/);
  expect(await Bun.file(".github/workflows/reset-application-data.yml").exists()).toBe(false);
});
