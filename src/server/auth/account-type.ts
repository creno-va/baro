import { z } from "zod";
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
