import { operationStatements } from "./v2-accounting";
import { sqlClaim, type V2Core, type WorkspaceGuard } from "./v2-core";
import { type Admission, admissionSchema } from "./v2-workspace";

export type MutationReceipt = Admission & {
  route: string;
  kind: "question_batch" | "summary" | "chat";
};

/** The mutation and its replay receipt commit in the same D1 transaction. */
export function mutationTools(core: V2Core, g: WorkspaceGuard, receipt?: MutationReceipt) {
  if (receipt)
    admissionSchema.parse({
      operationId: receipt.operationId,
      key: receipt.key,
      requestHash: receipt.requestHash,
    });
  return {
    claim(id: string, condition: string, values: unknown[] = []) {
      return core.claim(
        g,
        id,
        `${condition}${receipt ? " AND NOT EXISTS(SELECT 1 FROM v2_idempotency WHERE owner_id=w.owner_id AND route=? AND key=? AND expires_at>?)" : ""}`,
        [...values, ...(receipt ? [receipt.route, receipt.key, g.now] : [])],
      );
    },
    complete(id: string): D1PreparedStatement[] {
      if (!receipt) return [];
      return [
        ...operationStatements(
          core,
          g,
          {
            id: receipt.operationId,
            workspaceId: g.workspaceId,
            kind: receipt.kind,
            revision: g.expectedRevision + 1,
            route: receipt.route,
            key: receipt.key,
            requestHash: receipt.requestHash,
          },
          id,
        ),
        core.statement(`UPDATE v2_operations SET state='completed' WHERE id=? AND ${sqlClaim}`, [
          receipt.operationId,
          id,
        ]),
      ];
    },
  };
}
