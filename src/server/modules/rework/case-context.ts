import { z } from "zod";
import { idempotencyKeySchema, opaqueIdSchema } from "../../../contracts";
import {
  type V2CaseContext,
  type V2CaseContextView,
  v2CaseContextSchema,
  v2CaseContextUpdateSchema,
  v2CaseContextViewSchema,
  v2ReworkCreateCaseRequestSchema,
  v2ReworkCreateCaseResponseSchema,
  v2ReworkVersionSchema,
} from "../../../contracts/v2";
import { createV2AccountingRepository } from "../../db/v2-accounting";
import { type Actor, aliveWorkspace, sqlClaim, type V2Core } from "../../db/v2-core";
import { runtimeDigest } from "../../db/v2-paid-runtime";
import { createV2ReworkRepository, reworkConsentGuard } from "../../db/v2-rework";
import { createV2WorkspaceRepository, storedWorkspaceContentSchema } from "../../db/v2-workspace";

export class ReworkError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "STALE_REVISION"
      | "IDEMPOTENCY_CONFLICT"
      | "REVIEW_REQUIRED"
      | "USER_QUOTA_EXCEEDED"
      | "DEPENDENCY_UNAVAILABLE"
      | "CONSENT_REQUIRED",
  ) {
    super(code);
  }
}
export const unconfirmedProcedure = () => ({
  kind: "unconfirmed" as const,
  stage: "unconfirmed" as const,
  description: null,
});
const response = (workspaceRevision: number, context: V2CaseContext): V2CaseContextView => ({
  contractVersion: v2ReworkVersionSchema.value,
  workspaceRevision,
  context,
});
const receiptSchema = z.strictObject({
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  response: v2CaseContextViewSchema,
});

export function createReworkCaseService(core: V2Core, deps: { clock?: () => string } = {}) {
  const now = deps.clock ?? (() => new Date().toISOString());
  const actor = (ownerId: string): Actor => ({
    ownerId: opaqueIdSchema.parse(ownerId),
    now: now(),
  });
  const workspace = createV2WorkspaceRepository(core.binding, core.cipher);
  const records = createV2ReworkRepository(core, { clock: now });
  const requireConsent = async (ownerId: string) => {
    const guard = reworkConsentGuard(ownerId);
    if (!(await core.statement(`SELECT 1 AS allowed WHERE ${guard.sql}`, guard.values).first()))
      throw new ReworkError("CONSENT_REQUIRED");
  };
  const content = async (a: Actor, id: string) => {
    const w = await workspace.findWorkspace(a, opaqueIdSchema.parse(id));
    if (!w) throw new ReworkError("NOT_FOUND");
    const row = await core
      .statement(
        `SELECT w.encrypted_payload FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=? AND ${aliveWorkspace}`,
        [id, a.ownerId, w.workspaceRevision],
      )
      .first<{ encrypted_payload: string }>();
    if (!row) throw new ReworkError("STALE_REVISION");
    const value = await core.decrypt(
      "v2_workspaces",
      id,
      a.ownerId,
      1,
      row.encrypted_payload,
      storedWorkspaceContentSchema,
    );
    const context = value.reworkContext ?? {
      casePurpose: "unconfirmed" as const,
      subjectContext: value.subjectContext,
      procedure: unconfirmedProcedure(),
    };
    if (context.subjectContext !== value.subjectContext)
      throw new ReworkError("DEPENDENCY_UNAVAILABLE");
    if (
      !(await core
        .statement(
          `SELECT w.id FROM v2_workspaces w WHERE w.id=? AND w.owner_id=? AND w.revision=? AND w.encrypted_payload=? AND ${aliveWorkspace}`,
          [id, a.ownerId, w.workspaceRevision, row.encrypted_payload],
        )
        .first())
    )
      throw new ReworkError("STALE_REVISION");
    return { workspace: w, content: value, context, encryptedPayload: row.encrypted_payload };
  };
  const business = (raw: unknown) => {
    const { turnstileToken: _token, ...input } = v2ReworkCreateCaseRequestSchema.parse(raw);
    return input;
  };
  const replayCreate = async (ownerId: string, key: string, raw: unknown) => {
    const input = business(raw);
    const replay = await createV2AccountingRepository(core).findOperation(
      actor(ownerId),
      "/api/v2/cases/rework",
      idempotencyKeySchema.parse(key),
      await runtimeDigest(input),
    );
    if (replay?.kind === "conflict") throw new ReworkError("IDEMPOTENCY_CONFLICT");
    if (replay?.kind !== "replay" || !replay.operation.workspace_id) return null;
    const state = await content(actor(ownerId), replay.operation.workspace_id);
    return v2ReworkCreateCaseResponseSchema.parse({
      contractVersion: v2ReworkVersionSchema.value,
      workspace: state.workspace,
      context: state.context,
    });
  };
  return {
    replayCreate,
    async create(ownerId: string, key: string, raw: unknown) {
      await requireConsent(ownerId);
      const input = business(raw),
        a = actor(ownerId);
      const context = v2CaseContextSchema.parse({
        casePurpose: input.casePurpose,
        subjectContext: input.subjectContext,
        procedure: unconfirmedProcedure(),
      });
      const { casePurpose: _purpose, ...oldInput } = input;
      const created = await workspace.create(
        a,
        crypto.randomUUID(),
        oldInput,
        {
          operationId: crypto.randomUUID(),
          key: idempotencyKeySchema.parse(key),
          requestHash: await runtimeDigest(input),
        },
        undefined,
        context,
      );
      if (created.kind === "conflict") throw new ReworkError("IDEMPOTENCY_CONFLICT");
      if (created.kind === "rejected") {
        await requireConsent(ownerId);
        throw new ReworkError("USER_QUOTA_EXCEEDED");
      }
      const id =
        created.kind === "created" ? created.workspace?.id : created.operation.workspace_id;
      if (!id) throw new ReworkError("NOT_FOUND");
      const state = await content(a, id);
      return v2ReworkCreateCaseResponseSchema.parse({
        contractVersion: v2ReworkVersionSchema.value,
        workspace: state.workspace,
        context: state.context,
      });
    },
    async get(ownerId: string, id: string) {
      const state = await content(actor(ownerId), id);
      return response(state.workspace.workspaceRevision, state.context);
    },
    async update(ownerId: string, id: string, key: string, raw: unknown) {
      await requireConsent(ownerId);
      const request = v2CaseContextUpdateSchema.parse(raw),
        a = actor(ownerId);
      idempotencyKeySchema.parse(key);
      const entityId = await runtimeDigest(["case_context", id, key]),
        requestHash = await runtimeDigest(request);
      const replay = await records.read(a, id, "action_receipt", entityId, receiptSchema);
      if (replay) {
        if (replay.value.requestHash !== requestHash) throw new ReworkError("IDEMPOTENCY_CONFLICT");
        return replay.value.response;
      }
      const current = await content(a, id),
        w = current.workspace;
      if (
        w.workspaceRevision !== request.expectedRevision ||
        w.currentJobId ||
        w.status === "archived"
      )
        throw new ReworkError("STALE_REVISION");
      const { expectedRevision: _expected, ...context } = request;
      const encrypted = await core.encrypt("v2_workspaces", id, ownerId, 1, {
        ...current.content,
        subjectContext: context.subjectContext,
        reworkContext: context,
      });
      const next = response(w.workspaceRevision + 1, context);
      const saved = await records.write(
        { ...a, workspaceId: id, expectedRevision: w.workspaceRevision },
        {
          kind: "action_receipt",
          entityId,
          expectedVersion: 0,
          value: { requestHash, response: next },
          schema: receiptSchema,
          bumpWorkspace: true,
          authority: {
            sql: "w.encrypted_payload=? AND w.status!='archived'",
            values: [current.encryptedPayload],
          },
          statements: (claimId) => [
            core.statement(
              `UPDATE v2_workspaces SET encrypted_payload=? WHERE id=? AND ${sqlClaim}`,
              [encrypted, id, claimId],
            ),
          ],
        },
      );
      if (!saved) {
        const recovered = await records.read(a, id, "action_receipt", entityId, receiptSchema);
        if (recovered?.value.requestHash === requestHash) return recovered.value.response;
        throw new ReworkError("STALE_REVISION");
      }
      return saved.value.response;
    },
  };
}
