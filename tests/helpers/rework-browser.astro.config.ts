import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import type { ViteDevServer } from "vite";
import base from "../../astro.config";

// Actual application routes and real authenticated client; no component/API alias.
if (process.env.PUBLIC_API_MODE !== "real" || process.env.BARO_UI_TEST_FIXTURE !== "true")
  throw new Error("REWORK_BROWSER_REQUIRES_EXPLICIT_REAL_CLIENT_FIXTURE");
export default {
  ...base,
  vite: {
    ...base.vite,
    plugins: [
      ...(base.vite?.plugins ?? []),
      {
        name: "baro-rework-original-upload-transport",
        configureServer(server: ViteDevServer) {
          server.middlewares.use((request, response, next) => {
            const target = request.headers["x-baro-rework-upstream"];
            if (target === undefined) return next();
            if (
              typeof target !== "string" ||
              !/^http:\/\/127\.0\.0\.1:\d+$/.test(target) ||
              request.method !== "PUT" ||
              !/^\/api\/v2\/cases\/[^/?]+\/files\/[^/?]+\/parts\/\d+$/.test(request.url ?? "") ||
              request.headers.origin !== `http://${request.headers.host}`
            ) {
              response.writeHead(400).end();
              return;
            }
            // WebKit's Playwright Request hides Blob bytes. Keep the original
            // same-origin browser HTTP stream, CSP, signed cookie and API guards.
            // This development-only middleware never reconstructs a file body.
            const headers: IncomingHttpHeaders = { ...request.headers, host: new URL(target).host };
            delete headers["x-baro-rework-upstream"];
            const upstream = httpRequest(
              new URL(request.url ?? "", target),
              { method: request.method, headers },
              (result) => {
                response.writeHead(result.statusCode ?? 502, result.headers);
                result.pipe(response);
              },
            );
            upstream.setTimeout(30000, () => upstream.destroy());
            upstream.on("error", () => {
              if (!response.headersSent) response.writeHead(502);
              response.end();
            });
            request.on("aborted", () => upstream.destroy());
            response.on("close", () => {
              if (!response.writableFinished) upstream.destroy();
            });
            request.pipe(upstream);
          });
        },
      },
    ],
  },
};
