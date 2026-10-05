import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough", remoteBindings: false }),
  integrations: [react()],
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
