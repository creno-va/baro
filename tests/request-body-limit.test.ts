import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { ApiEnvironment } from "../src/server/api/errors";
import { requestBodyLimit } from "../src/server/api/request-body-limit";

function application() {
  return new Hono<ApiEnvironment>().use("*", requestBodyLimit).all("*", (c) => {
    expect(c.req.raw.bodyUsed).toBe(false);
    return c.text("authorization denied", 401);
  });
}

test("binary part reaches authorization with its body unread", async () => {
  for (const prefix of ["", "/api"]) {
    const response = await application().request(`${prefix}/v2/cases/case_1/files/file-2/parts/0`, {
      method: "PUT",
      body: new Uint8Array(70_000),
      headers: { "content-length": "70000" },
    });
    expect(response.status).toBe(401);
  }
});

test("profile asset content reaches authorization before reading its large body", async () => {
  for (const prefix of ["", "/api"]) {
    const response = await application().request(`${prefix}/v2/me/lawyer/assets/asset_1/content`, {
      method: "PUT",
      body: new Uint8Array(70_000),
      headers: { "content-length": "70000" },
    });
    expect(response.status).toBe(401);
  }
});

test("JSON and lookalike upload paths retain the 64 KiB limit", async () => {
  for (const [method, path] of [
    ["POST", "/api/v2/cases/case_1/files/file-2/parts/0"],
    ["PUT", "/api/v2/cases/case_1/files/file-2/parts/0/extra"],
    ["PUT", "/api/v2/cases/case_1/files/file-2/parts/01"],
    ["PUT", "/api/v2/cases/case_1/files/file-2/parts/-1"],
    ["PUT", "/api/v2/cases/case_1/files/file-2/complete"],
    ["POST", "/api/cases"],
    ["POST", "/api/v2/me/lawyer/assets/asset_1/content"],
    ["PUT", "/api/v2/me/lawyer/assets/asset_1/content/extra"],
    ["POST", "/api/v2/me/lawyer/verification-assets"],
    ["POST", "/api/v2/me/lawyer/portfolio-assets"],
    ["POST", "/api/v2/cases/case_1/reports"],
    ["PATCH", "/api/v2/cases/case_1/reports/extra"],
    ["PATCH", "/api/v2/reports/report_1"],
  ]) {
    const response = await application().request(path as string, {
      method: method as string,
      body: new Uint8Array(70_000),
      headers: { "content-length": "70000" },
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "BODY_TOO_LARGE" } });
  }
});

test("only the exact report review PATCH accepts bounded Korean JSON", async () => {
  const app = new Hono<ApiEnvironment>()
    .use("*", requestBodyLimit)
    .all("*", async (c) =>
      c.json({ length: (await c.req.json<{ content: string }>()).content.length }),
    );
  for (const prefix of ["", "/api"]) {
    const response: Response = await app.request(`${prefix}/v2/cases/case_1/reports`, {
      method: "PATCH",
      body: JSON.stringify({ content: "한".repeat(30_000) }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ length: 30_000 });
    // No Content-Length: enforce the limit while consuming streamed bytes.
    const oversized = await app.request(`${prefix}/v2/cases/case_1/reports`, {
      method: "PATCH",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(65_536));
          controller.enqueue(new Uint8Array(65_537));
          controller.close();
        },
      }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "BODY_TOO_LARGE" } });
  }
});
