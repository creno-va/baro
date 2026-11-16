import { fileURLToPath } from "node:url";
import base from "../../astro.config";
export default {
  ...base,
  vite: {
    ...base.vite,
    plugins: [
      ...(base.vite?.plugins ?? []),
      {
        name: "isolated-intake-reconfirmation-facade",
        enforce: "pre" as const,
        resolveId(source: string, importer?: string) {
          if (
            /^(?:\.\.\/)+(?:src\/)?client\/api$/.test(source) &&
            importer?.includes("/components/intake/")
          )
            return fileURLToPath(new URL("./intake-rework-client-fixture.ts", import.meta.url));
          return null;
        },
      },
    ],
  },
};
