import { fileURLToPath } from "node:url";
import base from "../../astro.config";

export default {
  ...base,
  integrations: [
    ...(base.integrations ?? []),
    {
      name: "isolated-conversation-agent",
      hooks: {
        "astro:config:setup": ({
          injectRoute,
        }: {
          injectRoute: (route: { pattern: string; entrypoint: string }) => void;
        }) => {
          injectRoute({
            pattern: "/__conversation-agent",
            entrypoint: fileURLToPath(new URL("./conversation-agent-page.astro", import.meta.url)),
          });
        },
      },
    },
  ],
  vite: {
    ...base.vite,
    plugins: [
      ...(base.vite?.plugins ?? []),
      {
        name: "isolated-conversation-session",
        enforce: "pre" as const,
        resolveId(source: string, importer?: string) {
          if (
            source === "../../client/api" &&
            importer?.endsWith("/workspace/ConversationAgent.tsx")
          )
            return fileURLToPath(new URL("./conversation-agent-browser-api.ts", import.meta.url));
          return null;
        },
      },
    ],
  },
};
