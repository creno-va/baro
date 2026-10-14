import { expect, test } from "bun:test";
import { CURRENT_POLICY_VERSIONS } from "../src/contracts/consent";
import { readCustomerConsentSnapshot } from "../src/server/auth/account-type";
import { createTestDatabase } from "./helpers/d1";
import { countD1Calls } from "./helpers/d1-call-count";
import { seedTestSession } from "./helpers/session";

test("customer access snapshot preserves preference precedence and legacy role fallback", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true });
    const meter = countD1Calls(db.binding);
    for (const preference of [null, "invalid", "customer", "lawyer"])
      for (const role of [null, "user", "moderator", "lawyer_applicant", "verified_lawyer"]) {
        db.sqlite.query("DELETE FROM app_metadata").run();
        db.sqlite.query("DELETE FROM v2_role_bindings").run();
        if (preference)
          db.sqlite
            .query("INSERT INTO app_metadata(key,value,updated_at) VALUES(?,?,?)")
            .run(`account-type:${owner.userId}`, preference, new Date().toISOString());
        if (role)
          db.sqlite
            .query("INSERT INTO v2_role_bindings(owner_id,role,granted_at) VALUES(?,?,?)")
            .run(owner.userId, role, new Date().toISOString());
        meter.reset();
        expect(await readCustomerConsentSnapshot(meter.binding, owner.userId)).toEqual({
          accountType:
            preference === "customer" || preference === "lawyer"
              ? preference
              : role === "lawyer_applicant" || role === "verified_lawyer"
                ? "lawyer"
                : "customer",
          currentConsent: true,
        });
        expect(meter.work).toEqual({ calls: 1, statements: 1 });
      }
  } finally {
    db.close();
  }
});

test("customer access snapshot requires every current policy and over-14 consent on every read", async () => {
  const db = await createTestDatabase();
  try {
    const owner = await seedTestSession(db, { consent: true });
    const reset = () =>
      db.sqlite
        .query(
          "UPDATE user_consents SET terms_version=?,privacy_version=?,ai_notice_version=?,over_14_confirmed=1 WHERE user_id=?",
        )
        .run(
          CURRENT_POLICY_VERSIONS.termsVersion,
          CURRENT_POLICY_VERSIONS.privacyVersion,
          CURRENT_POLICY_VERSIONS.aiNoticeVersion,
          owner.userId,
        );
    for (const field of ["terms_version", "privacy_version", "ai_notice_version"] as const) {
      reset();
      expect((await readCustomerConsentSnapshot(db.binding, owner.userId)).currentConsent).toBe(
        true,
      );
      db.sqlite
        .query(`UPDATE user_consents SET ${field}=? WHERE user_id=?`)
        .run("stale", owner.userId);
      expect((await readCustomerConsentSnapshot(db.binding, owner.userId)).currentConsent).toBe(
        false,
      );
    }
    reset();
    // The DB contract also forbids storing a positive consent without this flag.
    expect(() =>
      db.sqlite
        .query("UPDATE user_consents SET over_14_confirmed=0 WHERE user_id=?")
        .run(owner.userId),
    ).toThrow();
    db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(owner.userId);
    expect((await readCustomerConsentSnapshot(db.binding, owner.userId)).currentConsent).toBe(
      false,
    );
  } finally {
    db.close();
  }
});
