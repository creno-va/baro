import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough", remoteBindings: false }),
  integrations: [react()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
});
