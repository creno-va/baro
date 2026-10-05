import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import { type ConsentInput, CURRENT_POLICY_VERSIONS } from "../../../contracts/consent";
import { userConsents } from "../../db/schema";

type Database = DrizzleD1Database<typeof import("../../db/schema")>;

export async function readConsent(database: Database, userId: string) {
  return database.query.userConsents.findFirst({
    where: eq(userConsents.userId, userId),
  });
}

export async function hasCurrentConsent(database: Database, userId: string): Promise<boolean> {
  const consent = await database.query.userConsents.findFirst({
    columns: { userId: true },
    where: and(
      eq(userConsents.userId, userId),
      eq(userConsents.termsVersion, CURRENT_POLICY_VERSIONS.termsVersion),
      eq(userConsents.privacyVersion, CURRENT_POLICY_VERSIONS.privacyVersion),
      eq(userConsents.aiNoticeVersion, CURRENT_POLICY_VERSIONS.aiNoticeVersion),
      eq(userConsents.over14Confirmed, true),
    ),
  });

  return Boolean(consent);
}

export async function saveConsent(database: Database, userId: string, input: ConsentInput) {
  const consentedAt = new Date().toISOString();

  await database
    .insert(userConsents)
    .values({
      userId,
      ...input,
      consentedAt,
    })
    .onConflictDoUpdate({
      target: userConsents.userId,
      set: {
        ...input,
        consentedAt,
      },
    });

  return { ...input, consentedAt };
}
