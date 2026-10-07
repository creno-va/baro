import { z } from "zod";

const approvalSchema = z.strictObject({
  kind: z.literal("operator-public-launch"),
  targetSha: z.string().regex(/^[a-f0-9]{40}$/),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  source: z.literal("direct-user-instruction"),
  publicLaunchApproved: z.literal(true),
  independentExternalEvidenceComplete: z.literal(false),
});

/** An explicit operator exception is distinct from verified external release receipts. */
export function verifyLaunchAuthorization(comment: unknown, targetSha: string, now: number) {
  const parsed = z
    .object({
      user: z.object({ login: z.literal("hwangeunchan"), type: z.literal("User") }),
      issue_url: z.literal("https://api.github.com/repos/creno-va/baro/issues/71"),
      body: z.string(),
    })
    .safeParse(comment);
  if (!parsed.success || !/^[a-f0-9]{40}$/.test(targetSha)) return false;
  const match = parsed.data.body.match(/<!-- BARO_OPERATOR_LAUNCH\n([\s\S]+?)\n-->/);
  if (!match) return false;
  try {
    const approval = approvalSchema.parse(JSON.parse(match[1] ?? "null"));
    const issued = Date.parse(approval.approvedAt),
      expires = Date.parse(approval.expiresAt);
    return (
      approval.targetSha === targetSha &&
      Number.isFinite(now) &&
      issued <= now &&
      expires > now &&
      expires > issued &&
      expires - issued <= 24 * 60 * 60 * 1000
    );
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const [targetSha, commentId] = process.argv.slice(2);
  const token = process.env.GITHUB_TOKEN;
  try {
    if (!targetSha || !commentId || !/^\d{1,20}$/.test(commentId) || !token)
      throw new Error("Invalid approval input");
    const response = await fetch(
      `https://api.github.com/repos/creno-va/baro/issues/comments/${commentId}`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok || !verifyLaunchAuthorization(await response.json(), targetSha, Date.now()))
      throw new Error("Approval mismatch");
    console.log(
      "Explicit operator public-launch authorization verified for this immutable SHA; external evidence remains separate.",
    );
  } catch {
    console.error("OPERATOR_LAUNCH_AUTHORIZATION_INVALID");
    process.exitCode = 1;
  }
}
