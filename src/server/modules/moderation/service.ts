import { z } from "zod";
import { opaqueIdSchema, revisionSchema, timestampSchema } from "../../../contracts";
import {
  v2ApplicationDecisionRequestSchema,
  v2ProfileDecisionRequestSchema,
} from "../../../contracts/v2";
import { actorSchema, parse, type V2Core } from "../../db/v2-core";
import { createV2LawyersRepository } from "../../db/v2-lawyers";
import { digest } from "../files/binary";
import { LawyerError } from "../lawyers/service";

export const reviewPageSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(20).default(10),
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});
export function createModerationService(core: V2Core, options: { clock?: () => string } = {}) {
  const repository = createV2LawyersRepository(core);
  const actor = (ownerId: string) =>
    parse(actorSchema, {
      ownerId,
      now: new Date(
        timestampSchema.parse((options.clock ?? (() => new Date().toISOString()))()),
      ).toISOString(),
    });
  return {
    applications(ownerId: string, sessionId: string, input: unknown) {
      const q = reviewPageSchema.parse(input);
      return repository.submittedApplications(actor(ownerId), sessionId, {
        limit: q.limit,
        ...(q.cursor ? { cursor: q.cursor } : {}),
      });
    },
    profiles(ownerId: string, sessionId: string, input: unknown) {
      const q = reviewPageSchema.parse(input);
      return repository.submittedProfiles(actor(ownerId), sessionId, {
        limit: q.limit,
        ...(q.cursor ? { cursor: q.cursor } : {}),
      });
    },
    async application(ownerId: string, sessionId: string, id: string) {
      opaqueIdSchema.parse(id);
      const result = await repository.readSubmittedApplication(actor(ownerId), sessionId, id);
      if (!result) throw new LawyerError("NOT_FOUND");
      return result;
    },
    async profile(ownerId: string, sessionId: string, revisionId: string) {
      opaqueIdSchema.parse(revisionId);
      const result = await repository.readSubmittedProfileById(
        actor(ownerId),
        sessionId,
        revisionId,
      );
      if (!result) throw new LawyerError("NOT_FOUND");
      return result;
    },
    async verification(ownerId: string, sessionId: string, applicationId: string, assetId: string) {
      opaqueIdSchema.parse(applicationId);
      opaqueIdSchema.parse(assetId);
      const result = await repository.readSubmittedVerification(
        actor(ownerId),
        sessionId,
        applicationId,
        assetId,
      );
      if (!result) throw new LawyerError("NOT_FOUND");
      return result;
    },
    async decideApplication(ownerId: string, sessionId: string, id: string, input: unknown) {
      opaqueIdSchema.parse(id);
      const body = v2ApplicationDecisionRequestSchema.parse(input);
      const target = await repository.readSubmittedApplication(actor(ownerId), sessionId, id);
      if (!target || target.revision !== body.expectedRevision)
        throw new LawyerError("STALE_REVISION");
      if (!(await repository.decideApplication(actor(ownerId), sessionId, id, body)))
        throw new LawyerError("STALE_REVISION");
      return { id, revision: body.expectedRevision, status: body.decision };
    },
    async decideProfile(ownerId: string, sessionId: string, revisionId: string, input: unknown) {
      opaqueIdSchema.parse(revisionId);
      const body = v2ProfileDecisionRequestSchema.parse(input);
      const target = await repository.readSubmittedProfileById(
        actor(ownerId),
        sessionId,
        revisionId,
      );
      if (!target || target.revision !== body.expectedRevision)
        throw new LawyerError("STALE_REVISION");
      const admission = {
        operationId: crypto.randomUUID(),
        key: crypto.randomUUID(),
        requestHash: await digest(
          new TextEncoder().encode(JSON.stringify({ revisionId, ...body })),
        ),
      };
      if (
        !(await repository.decideProfile(
          actor(ownerId),
          sessionId,
          target.profileId,
          body,
          admission,
        ))
      )
        throw new LawyerError("STALE_REVISION");
      return {
        id: revisionId,
        revision: target.revision,
        status: body.decision,
        publicationPending: body.decision === "approved",
      };
    },
    async revokeVerification(
      ownerId: string,
      sessionId: string,
      id: string,
      expectedRevision: number,
    ) {
      opaqueIdSchema.parse(id);
      parse(revisionSchema, expectedRevision);
      if (
        !(await repository.revokeVerificationByApplication(
          actor(ownerId),
          sessionId,
          id,
          expectedRevision,
        ))
      )
        throw new LawyerError("STALE_REVISION");
      return { id, status: "withdrawn" as const, cleanupPending: true };
    },
  };
}
