import { describe, expect, test } from "bun:test";
import { api } from "./index";

describe("health API", () => {
  test("reports the Worker as live without requiring dependencies", async () => {
    const response = await api.request("/health/live");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body).toEqual({
      status: "ok",
      service: "baro",
      environment: "test",
    });
  });

  test("preserves a caller-provided request id", async () => {
    const response = await api.request("/health/live", {
      headers: { "x-request-id": "test-request-id" },
    });

    expect(response.headers.get("x-request-id")).toBe("test-request-id");
  });
});
