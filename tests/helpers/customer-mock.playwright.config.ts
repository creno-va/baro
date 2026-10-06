import { fileURLToPath } from "node:url";
import base from "../independent-review/integration.config";
export default {
  ...base,
  testDir: fileURLToPath(new URL("../independent-review", import.meta.url)),
  use: { ...base.use, baseURL: "http://127.0.0.1:4356" },
  webServer: {
    ...base.webServer,
    command: "bun run dev -- --ignore-lock --host 127.0.0.1 --port 4356",
    url: "http://127.0.0.1:4356/login",
    reuseExistingServer: false,
  },
};
