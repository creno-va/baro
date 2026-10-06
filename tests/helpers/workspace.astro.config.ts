import { fileURLToPath } from "node:url";
import base from "../../astro.config";

export default {
  ...base,
  vite: {
    ...base.vite,
    plugins: [
      ...(base.vite?.plugins ?? []),
      {
        name: "isolated-workspace-contract-facade",
        enforce: "pre" as const,
        resolveId(source: string, importer?: string) {
          if (
            source === "../../client/api" &&
            (importer?.endsWith("/components/workspace/Workspace.tsx") ||
              importer?.endsWith("/components/intake/useCustomerAccess.ts"))
          )
            return fileURLToPath(new URL("./workspace-client-fixture.ts", import.meta.url));
          return null;
        },
      },
    ],
  },
};
