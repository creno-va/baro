import { afterEach, expect, test } from "bun:test";
import { api } from "../src/server/api";
import { saveAccountType } from "../src/server/auth/account-type";
import { createCaseDataCipher } from "../src/server/crypto";
import { createDomainRepository } from "../src/server/db/repository";
import { createTestDatabase } from "./helpers/d1";
import { seedTestSession } from "./helpers/session";

const databases: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

test("same owner changing to lawyer cannot read or mutate customer cases; account services remain available", async () => {
  const db = await createTestDatabase();
  databases.push(db);
  const owner = await seedTestSession(db, { consent: true });
  owner.env.CASE_DATA_KEY_V1 = btoa("x".repeat(32)).replace(/=+$/, "");
  const caseId = crypto.randomUUID();
  await createDomainRepository(db.binding, await createCaseDataCipher(owner.env)).commitInitialCase(
    {
      ownerId: owner.userId,
      caseId,
      analysisId: crypto.randomUUID(),
      outboxId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      requestHash: "a".repeat(64),
      input: "합성 역할 전환 이전의 고객 사건",
      now: new Date().toISOString(),
    },
  );
  const request = (path: string, method = "GET", origin = owner.env.BETTER_AUTH_URL) =>
    api.request(
      path,
      { method, headers: { cookie: owner.cookie, origin, "idempotency-key": crypto.randomUUID() } },
      owner.env,
    );
  expect((await request(`/cases/${caseId}`)).status).toBe(200);
  await saveAccountType(db.binding, owner.userId, "lawyer");
  for (const [path, method] of [
    ["/cases", "GET"],
    [`/cases/${caseId}`, "GET"],
    [`/cases/${caseId}/analysis`, "GET"],
    [`/cases/${caseId}`, "DELETE"],
    ["/v2/cases", "POST"],
    [`/v2/cases/${caseId}/workspace`, "GET"],
    [`/v2/cases/${caseId}/messages`, "POST"],
    [`/v2/cases/${caseId}/files`, "GET"],
    [`/v2/cases/${caseId}`, "DELETE"],
  ]) {
    const response = await request(path as string, method);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ROLE_REQUIRED", retryable: false },
    });
  }
  expect((await request(`/cases/${caseId}`, "DELETE", "https://foreign.test")).status).toBe(403);
  expect((await request("/v2/me/usage")).status).toBe(200);
  expect((await request("/me/deletion")).status).toBe(200);
  await saveAccountType(db.binding, owner.userId, "customer");
  expect((await request(`/cases/${caseId}`)).status).toBe(200);
  expect(db.sqlite.query("SELECT count(*) AS count FROM v2_role_bindings").get()).toEqual({
    count: 0,
  });
});
