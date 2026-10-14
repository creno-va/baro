import { z } from "zod";
import { CURRENT_POLICY_VERSIONS } from "../../contracts/consent";
export const accountTypeSchema = z.enum(["customer", "lawyer"]);
export type AccountType = z.infer<typeof accountTypeSchema>;
const preferenceKey = (ownerId: string) => `account-type:${ownerId}`;
export async function readAccountType(db: D1Database, ownerId: string): Promise<AccountType> {
  const preference = await db
    .prepare("SELECT value FROM app_metadata WHERE key=?")
    .bind(preferenceKey(ownerId))
    .first<{ value: string }>();
  const saved = accountTypeSchema.safeParse(preference?.value);
  if (saved.success) return saved.data;
  const existing = await db
    .prepare(
      "SELECT role FROM v2_role_bindings WHERE owner_id=? AND role IN ('lawyer_applicant','verified_lawyer')",
    )
    .bind(ownerId)
    .first();
  return existing ? "lawyer" : "customer";
}

/** Fresh role and consent from one DB snapshot; never retained across requests. */
export async function readCustomerConsentSnapshot(db: D1Database, ownerId: string) {
  const row = await db
    .prepare(
      `SELECT coalesce((SELECT value FROM app_metadata WHERE key=? AND value IN ('customer','lawyer')),
        CASE WHEN EXISTS(SELECT 1 FROM v2_role_bindings WHERE owner_id=? AND role IN ('lawyer_applicant','verified_lawyer')) THEN 'lawyer' ELSE 'customer' END) AS account_type,
        EXISTS(SELECT 1 FROM user_consents WHERE user_id=? AND terms_version=? AND privacy_version=? AND ai_notice_version=? AND over_14_confirmed=1) AS current_consent`,
    )
    .bind(
      preferenceKey(ownerId),
      ownerId,
      ownerId,
      CURRENT_POLICY_VERSIONS.termsVersion,
      CURRENT_POLICY_VERSIONS.privacyVersion,
      CURRENT_POLICY_VERSIONS.aiNoticeVersion,
    )
    .first<{ account_type: string; current_consent: number }>();
  const accountType = accountTypeSchema.safeParse(row?.account_type);
  if (!accountType.success || (row?.current_consent !== 0 && row?.current_consent !== 1))
    throw new Error("ACCOUNT_ACCESS_UNAVAILABLE");
  return { accountType: accountType.data, currentConsent: row.current_consent === 1 };
}
export async function saveAccountType(
  db: D1Database,
  ownerId: string,
  accountType: AccountType,
): Promise<void> {
  // A display preference never grants verified_lawyer or moderator authority.
  const result = await db
    .prepare(
      "INSERT INTO app_metadata(key,value,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM user WHERE id=?) AND NOT EXISTS(SELECT 1 FROM v2_tombstones WHERE target_kind='account' AND target_id=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    )
    .bind(preferenceKey(ownerId), accountType, new Date().toISOString(), ownerId, ownerId)
    .run();
  if (!result.meta.changes) throw new Error("ACCOUNT_UNAVAILABLE");
}
