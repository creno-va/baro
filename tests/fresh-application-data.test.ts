import { expect, test } from "bun:test";
import {
  assertEmpty,
  assertFreshTarget,
  existingSyntheticSeed,
  FRESH_CONFIRMATION,
  FRESH_DATABASES,
  verifyFreshState,
} from "../scripts/fresh-application-data";
import {
  bindingPatch,
  freshTargetIsConnected,
  transitionFreshBinding,
} from "../scripts/fresh-database-binding";
import { prepareSyntheticLawyers } from "../scripts/synthetic-lawyer-seed";
import { emptySelfProfile } from "../src/contracts/v2/self-profile";
import { createV2Core } from "../src/server/db/v2-core";
import { createSelfProfileService } from "../src/server/modules/lawyers/self-profile";
import { createTestDatabase } from "./helpers/d1";

for (const mode of ["success", "failure", "already-connected"])
  test(`binding transition preserves settings and ${mode}`, async () => {
    const fail = mode === "failure";
    const target = FRESH_DATABASES.preview;
    let settings: {
      bindings: { name: string; type: string; id?: string; text?: string }[];
      compatibility_date: string;
    } = {
      bindings: [
        { name: "DB", type: "d1", id: mode === "already-connected" ? target.id : target.original },
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
        expect(((init.body as FormData).get("settings") as File).type.split(";")[0]).toBe(
          "application/json",
        );
        const payload = JSON.parse(
          await ((init.body as FormData).get("settings") as File).text(),
        ) as typeof patch;
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
      else if (url.includes("/versions/"))
        result = {
          resources: {
            script_runtime: {
              exports: { FileProcessorContainer: { type: "durable-object", storage: "sqlite" } },
              containers: [
                { name: "baro-file-processor-preview", class_name: "FileProcessorContainer" },
              ],
            },
          },
        };
      else if (url.endsWith("/versions")) result = { items: [{ id: version }] };
      else if (url.endsWith("/deployments") && init?.method === "POST") {
        deployed = version;
        result = {};
      } else if (url.endsWith("/deployments"))
        result = { deployments: [{ versions: [{ version_id: deployed, percentage: 100 }] }] };
      else if (url.endsWith("/api/health/ready"))
        return fail
          ? Response.json({ status: "not_ready" }, { status: 503 })
          : Response.json({ status: "ready", schemaVersion: "0018_external_lookup_admission" });
      else if (url.endsWith("/api/v2/lawyers/self-service"))
        return Response.json({
          items: [
            ...Array.from({ length: 10 }, (_, i) => ({ id: `synthetic-lawyer-${i}` })),
            ...(mode === "already-connected" ? [{ id: "new-real-public-profile" }] : []),
          ],
        });
      else if (url.includes("/api/v2/lawyers/self-service/")) {
        const id = url.split("/").at(-1) ?? "";
        return Response.json({
          ...emptySelfProfile(id),
          published: true,
          introduction: "합성 프로필",
        });
      } else throw new Error("unexpected request");
      return Response.json({ success: true, result });
    }) as typeof fetch;
    if (fail) {
      await expect(transitionFreshBinding("preview", "synthetic-token", mock)).rejects.toThrow(
        "FRESH_READINESS_FAILED",
      );
      expect(switches).toEqual([target.id, target.original]);
      expect(settings.bindings.find((b) => b.name === "DB")?.id).toBe(target.original);
    } else {
      expect(
        (await transitionFreshBinding("preview", "synthetic-token", mock)).publicProfiles,
      ).toBe(10);
      expect(switches).toEqual(mode === "already-connected" ? [] : [target.id]);
    }
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
    expect((await existingSyntheticSeed(db.binding))?.profiles).toHaveLength(10);
    db.sqlite.exec(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES('new-live-user','합성 신규 사용자','live@example.invalid',0,0,0)",
    );
    await expect(existingSyntheticSeed(db.binding)).rejects.toThrow("FRESH_STATE_INVALID");
    expect((await existingSyntheticSeed(db.binding, true))?.profiles).toHaveLength(10);
    expect(db.sqlite.query("SELECT count(*) AS n FROM user").get()).toEqual({ n: 11 });
    db.sqlite.exec("DELETE FROM app_metadata WHERE key LIKE 'synthetic-seed:%'");
    await expect(existingSyntheticSeed(db.binding, true)).rejects.toThrow(
      "FRESH_RESUME_NOT_SYNTHETIC",
    );
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

test("live-activity resume is derived from the actual allowlisted Worker binding", async () => {
  for (const id of [FRESH_DATABASES.preview.id, FRESH_DATABASES.preview.original, "unexpected"]) {
    const mock = (async (_input: RequestInfo | URL) =>
      Response.json({ success: true, result: { bindings: [{ name: "DB", id }] } })) as typeof fetch;
    if (id === "unexpected")
      await expect(freshTargetIsConnected("preview", "synthetic", mock)).rejects.toThrow(
        "FRESH_BINDING_STATE_INVALID",
      );
    else
      expect(await freshTargetIsConnected("preview", "synthetic", mock)).toBe(
        id === FRESH_DATABASES.preview.id,
      );
  }
});
