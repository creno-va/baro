import { mobileDeletionStartSchema } from "../../contracts/mobile-deletion";
import { deleteAccount, deletionOwnerTag } from "../modules/deletion/service";
import { takeAppleCallbackMaterial } from "./apple-identity";
import {
  type AppleCallbackMaterial,
  type AppleRevocationResult,
  revokeAppleAccess,
} from "./apple-revoke";
import { NativeAuthProofError } from "./native-codes";
import { createNativeDeletionReceipts } from "./native-deletion-receipt";
import { createNativeReauthentication } from "./native-reauth";

/** Explicit DELETE + fresh same-owner callback commits deletion before any provider-side request. */
export async function completeNativeAccountDeletion(
  env: Env,
  raw: unknown,
  provider: string,
  actor: { userId: string; sessionId: string },
  dependencies: {
    now?: () => number;
    material?: AppleCallbackMaterial | null;
    revoke?: (material: AppleCallbackMaterial) => Promise<AppleRevocationResult>;
  } = {},
) {
  const input = mobileDeletionStartSchema.parse(raw),
    now = dependencies.now ?? Date.now;
  const auth = createNativeReauthentication({
    db: env.DB,
    issuer: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    now,
  });
  const authorization = await auth.authorizeDeletion(input, provider, actor);
  const receipts = createNativeDeletionReceipts({
    db: env.DB,
    issuer: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    now,
  });
  const appleRows = (
    await env.DB.prepare(
      "SELECT account_id FROM account WHERE user_id=? AND provider_id='apple' ORDER BY account_id LIMIT 2",
    )
      .bind(actor.userId)
      .all<{ account_id: string }>()
  ).results;
  const material =
    dependencies.material === undefined ? await takeAppleCallbackMaterial() : dependencies.material;
  const ownedMaterial =
    provider === "apple" &&
    material &&
    (await env.DB.prepare(
      "SELECT 1 AS ok FROM account WHERE user_id=? AND provider_id='apple' AND account_id=?",
    )
      .bind(actor.userId, material.subject)
      .first())
      ? material
      : null;
  const fullyScoped = Boolean(
    ownedMaterial && appleRows.length === 1 && appleRows[0]?.account_id === ownedMaterial.subject,
  );
  const handle = await receipts.prepareCommit({
    attemptId: input.attemptId,
    challenge: input.challenge,
    ownerTag: await deletionOwnerTag(env.BETTER_AUTH_SECRET, actor.userId),
    appleLinked: appleRows.length > 0,
  });
  const deleted = await deleteAccount(env.DB, actor.userId, actor.sessionId, now(), {
    intent: authorization.guard,
    receipt: handle.metadata,
    apple: {
      linked: appleRows.length > 0,
      ...(ownedMaterial ? { revokeSubject: ownedMaterial.subject } : {}),
      ...(fullyScoped && ownedMaterial ? { singleSubject: ownedMaterial.subject } : {}),
    },
  });
  if (!deleted) throw new NativeAuthProofError();
  if (ownedMaterial) {
    let status: "confirmed" | "unconfirmed" = "unconfirmed";
    try {
      const result = await (dependencies.revoke ?? ((value) => revokeAppleAccess(env, value)))(
        ownedMaterial,
      );
      if (result.status === "confirmed" && fullyScoped) status = "confirmed";
    } catch {
      /* Provider failure cannot undo an already committed BARO deletion. */
    }
    try {
      await receipts.finish(handle, status);
    } catch {
      /* Atomic initial receipt remains honest: unconfirmed. */
    }
  }
  return { attemptId: input.attemptId, code: handle.code };
}
