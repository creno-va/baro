import { expect, test } from "bun:test";
import {
  checkBuiltDeployment,
  checkDeploymentConfig,
  checkDeploymentInputs,
  type DeploymentEnvironment,
  oauthSecretNames,
} from "../scripts/check-deployment";

const configuration = await Bun.file("wrangler.jsonc").json();
function inputs(): Record<string, string | undefined> {
  return {
    PUBLIC_API_MODE: "real",
    PUBLIC_TURNSTILE_SITE_KEY: "synthetic-non-dummy-sitekey",
    ...Object.fromEntries(oauthSecretNames.map((name) => [name, `fixture-${name}`])),
  };
}
function generated(environment: DeploymentEnvironment) {
  const config = structuredClone(configuration);
  const built = { ...config, ...config.env[environment] };
  delete built.env;
  built.main = "entry.mjs";
  built.assets.directory = "../client";
  built.configPath = "/synthetic/project/wrangler.jsonc";
  built.targetEnvironment = environment;
  built.definedEnvironments = ["preview", "production"];
  for (const db of built.d1_databases) db.migrations_dir = "../../drizzle";
  for (const container of built.containers) {
    container.image = "/synthetic/project/services/file-processor/Dockerfile";
    container.image_build_context = "/synthetic/project";
  }
  return built;
}

test("current deployment configs share behavior while isolating resource identities", () => {
  expect(() => checkDeploymentConfig(configuration)).not.toThrow();
  const changed = structuredClone(configuration);
  changed.env.production.d1_databases[0].database_id = "another-production-database";
  changed.env.production.kv_namespaces[0].id = "another-production-session-store";
  changed.env.production.workflows[0].name = "another-production-analysis";
  expect(() => checkDeploymentConfig(changed)).not.toThrow();
});

test("missing bindings and different runtime behavior fail parity", () => {
  const changes = [
    (config: typeof configuration) => {
      config.env.production.workflows.pop();
    },
    (config: typeof configuration) => {
      config.env.production.containers[0].instance_type = "standard-1";
    },
    (config: typeof configuration) => {
      config.env.production.vars.MONTHLY_BUDGET_CAP_ENABLED = "true";
    },
    (config: typeof configuration) => {
      config.env.production.workflows[0].binding = "ANOTHER_BINDING";
    },
  ];
  for (const change of changes) {
    const config = structuredClone(configuration);
    change(config);
    expect(() => checkDeploymentConfig(config)).toThrow("DEPLOYMENT_CONFIG_PARITY_MISMATCH");
  }
});

test("sharing a database across environments fails instead of hiding behind normalization", () => {
  const config = structuredClone(configuration);
  config.env.production.d1_databases[0].database_id =
    config.env.preview.d1_databases[0].database_id;
  expect(() => checkDeploymentConfig(config)).toThrow("DEPLOYMENT_RESOURCE_NOT_ISOLATED");
});

test("configured routes cannot point at the wrong origin", () => {
  const config = structuredClone(configuration);
  config.env.production.routes[0].pattern = "unrelated.example.com";
  expect(() => checkDeploymentConfig(config)).toThrow("DEPLOYMENT_ENVIRONMENT_IDENTITY_MISMATCH");
});

test("both live environments require real API, a sitekey and every environment OAuth credential", () => {
  expect(() => checkDeploymentInputs(inputs())).not.toThrow();
  for (const name of ["PUBLIC_TURNSTILE_SITE_KEY", ...oauthSecretNames]) {
    const environment = inputs();
    environment[name] = "  ";
    expect(() => checkDeploymentInputs(environment)).toThrow(`DEPLOYMENT_INPUT_MISSING_${name}`);
  }
  for (const mode of [undefined, "mock", ""]) {
    const environment = inputs();
    environment.PUBLIC_API_MODE = mode;
    expect(() => checkDeploymentInputs(environment)).toThrow("DEPLOYMENT_REAL_API_MODE_REQUIRED");
  }
});

test("official Turnstile test keys cannot enter either deployed build", () => {
  for (const key of [
    "1x00000000000000000000AA",
    "2x00000000000000000000AB",
    "1x00000000000000000000BB",
    "2x00000000000000000000BB",
    "3x00000000000000000000FF",
  ])
    expect(() => checkDeploymentInputs({ ...inputs(), PUBLIC_TURNSTILE_SITE_KEY: key })).toThrow(
      "DEPLOYMENT_TURNSTILE_TEST_KEY_FORBIDDEN",
    );
});

test("built runtime keeps the selected environment despite Astro path rewrites", () => {
  for (const environment of ["preview", "production"] as const)
    expect(() =>
      checkBuiltDeployment(configuration, generated(environment), environment),
    ).not.toThrow();
});

test("wrong build target, auth origin and environment are rejected before migrations", () => {
  expect(() => checkBuiltDeployment(configuration, generated("preview"), "production")).toThrow(
    "DEPLOYMENT_ENVIRONMENT_IDENTITY_MISMATCH",
  );
  for (const field of ["APP_ENV", "BETTER_AUTH_URL"]) {
    const built = generated("production");
    built.vars[field] = generated("preview").vars[field];
    expect(() => checkBuiltDeployment(configuration, built, "production")).toThrow(
      "DEPLOYMENT_ENVIRONMENT_IDENTITY_MISMATCH",
    );
  }
  const wrongTarget = generated("production");
  wrongTarget.targetEnvironment = "preview";
  expect(() => checkBuiltDeployment(configuration, wrongTarget, "production")).toThrow(
    "DEPLOYMENT_ENVIRONMENT_IDENTITY_MISMATCH",
  );
});

test("right worker with missing or cross-environment bindings also fails", () => {
  const built = generated("production");
  built.workflows.pop();
  expect(() => checkBuiltDeployment(configuration, built, "production")).toThrow(
    "DEPLOYMENT_BUILT_RUNTIME_MISMATCH",
  );
  const wrongDatabase = generated("production");
  wrongDatabase.d1_databases = generated("preview").d1_databases;
  expect(() => checkBuiltDeployment(configuration, wrongDatabase, "production")).toThrow(
    "DEPLOYMENT_BUILT_RUNTIME_MISMATCH",
  );
});
