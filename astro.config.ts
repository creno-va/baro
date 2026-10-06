import { readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

if (process.env.CLOUDFLARE_ENV === "production" && process.env.PUBLIC_API_MODE === "mock") {
  throw new Error("Production builds cannot use API mock responses.");
}

let buildArtifactDirectory: URL | undefined;

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "passthrough",
    remoteBindings: false,
    // Browser tests use intercepted synthetic APIs and never execute native/AI work.
    // Actual native codecs remain mandatory in the independent Linux CI job.
    ...(process.env.BARO_UI_TEST_FIXTURE === "true" ? { configPath: "./wrangler.ui.jsonc" } : {}),
  }),
  integrations: [
    react(),
    {
      name: "baro-no-local-secrets-in-build",
      hooks: {
        "astro:config:done": ({ config }) => {
          buildArtifactDirectory = config.outDir;
        },
        "astro:build:done": async () => {
          // Cloudflare emits local preview bindings as dotenv files. Keep the
          // source for dev, but never preserve them in release artifacts.
          if (!buildArtifactDirectory) throw new Error("MISSING_BUILD_ARTIFACT_DIRECTORY");
          for (const file of await readdir(buildArtifactDirectory, { recursive: true })) {
            if (/(?:^|[/\\])(?:\.dev\.vars|\.env)(?:\..*)?$/.test(file))
              await rm(new URL(file.replaceAll("\\", "/"), buildArtifactDirectory));
          }
        },
      },
    },
    ...(process.env.BARO_UI_TEST_FIXTURE === "true"
      ? [
          {
            name: "baro-synthetic-ui-fixture",
            hooks: {
              "astro:config:setup": ({
                injectRoute,
              }: {
                injectRoute: (route: { pattern: string; entrypoint: string }) => void;
              }) => {
                injectRoute({
                  pattern: "/__design-system",
                  entrypoint: fileURLToPath(
                    new URL("./tests/helpers/design-system-page.astro", import.meta.url),
                  ),
                });
              },
            },
          },
        ]
      : []),
  ],
  devToolbar: { enabled: false },
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "connect-src 'self' https://challenges.cloudflare.com",
        "frame-src https://challenges.cloudflare.com",
        "img-src 'self' data:",
        "font-src 'self'",
      ],
      scriptDirective: { resources: ["'self'", "https://challenges.cloudflare.com"] },
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
