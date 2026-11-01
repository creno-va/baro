import { expect, test } from "bun:test";
import type { V2Core } from "../src/server/db/v2-core";
import { loadAnalysisInput } from "../src/server/modules/rework/analysis-input";
import { createReworkCaseService } from "../src/server/modules/rework/case-context";
import { loadReconciliationSource } from "../src/server/modules/rework/reconciliation-source";
import { reportFixture } from "./helpers/report-fixture";

for (const failure of ["source_changed", "database_error"] as const)
  test(`reconciliation context distinguishes ${failure} from an unavailable current summary`, async () => {
    const f = await reportFixture();
    try {
      let injected = false;
      const core: V2Core = {
        ...f.core,
        binding: new Proxy(f.core.binding, {
          get(binding, method) {
            if (method !== "prepare") {
              const value = Reflect.get(binding, method);
              return typeof value === "function" ? value.bind(binding) : value;
            }
            return (sql: string) => {
              const statement = binding.prepare(sql);
              if (!sql.includes("i.summary_id IS ? AND w.revision=?")) return statement;
              const intercept = (target: D1PreparedStatement): D1PreparedStatement =>
                new Proxy(target, {
                  get(target, key) {
                    if (key === "bind")
                      return (...values: unknown[]) => intercept(target.bind(...values));
                    if (key === "first")
                      return async (column?: string) => {
                        if (!injected) {
                          injected = true;
                          if (failure === "database_error") throw new Error("SYNTHETIC_DB_FAILURE");
                          f.db.sqlite
                            .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
                            .run(f.workspaceId);
                        }
                        return column === undefined ? target.first() : target.first(column);
                      };
                    const value = Reflect.get(target, key);
                    return typeof value === "function" ? value.bind(target) : value;
                  },
                });
              return intercept(statement);
            };
          },
        }),
      };
      await expect(
        loadReconciliationSource(core, { ...f.actor, caseId: f.workspaceId }, { write: false }),
      ).rejects.toMatchObject({
        code: failure === "source_changed" ? "STALE_REVISION" : "DB_OPERATION_FAILED",
      });
      expect(injected).toBe(true);
      await expect(
        loadReconciliationSource(f.core, { ...f.actor, caseId: f.workspaceId }, { write: false }),
      ).resolves.toBeDefined();
      expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
    } finally {
      f.db.close();
    }
  });

for (const consumer of ["analysis", "reconciliation"] as const)
  for (const boundary of [1, 2])
    test(`${consumer} rejects an interrupted summary before parsing JSON at fragment ${boundary}`, async () => {
      const f = await reportFixture();
      try {
        await createReworkCaseService(f.core, { clock: () => f.actor.now }).update(
          f.actor.ownerId,
          f.workspaceId,
          crypto.randomUUID(),
          {
            expectedRevision: f.rev(),
            casePurpose: "respond_to_claim",
            subjectContext: "individual",
            procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
          },
        );
        const factId = crypto.randomUUID();
        const encrypted = await f.core.encrypt("v2_facts", factId, f.actor.ownerId, 1, {
          id: factId,
          text: "합성 검증: 반환 약속 날짜는 아직 확인하지 못했습니다.",
          attribution: "user_statement",
          certainty: "uncertain",
          significance: "neutral",
          references: [{ kind: "intake_narrative", intakeRevision: 1 }],
          conflictingFactIds: [],
          userEdited: false,
        });
        f.db.sqlite
          .query(
            "INSERT INTO v2_facts(id,entity_id,workspace_id,summary_revision,revision,encrypted_payload) VALUES(?,?,?,1,1,?)",
          )
          .run(factId, factId, f.workspaceId, encrypted);
        let seen = 0;
        const core: V2Core = {
          ...f.core,
          binding: new Proxy(f.core.binding, {
            get(binding, method) {
              if (method !== "prepare") {
                const value = Reflect.get(binding, method);
                return typeof value === "function" ? value.bind(binding) : value;
              }
              return (sql: string) => {
                const statement = binding.prepare(sql);
                if (
                  !sql.startsWith("SELECT i.id FROM v2_intakes") ||
                  !sql.includes("i.summary_id=? AND w.revision=?")
                )
                  return statement;
                const intercept = (target: D1PreparedStatement): D1PreparedStatement =>
                  new Proxy(target, {
                    get(target, key) {
                      if (key === "bind")
                        return (...values: unknown[]) => intercept(target.bind(...values));
                      if (key === "first")
                        return async (column?: string) => {
                          if (++seen === boundary)
                            f.db.sqlite
                              .query("UPDATE v2_workspaces SET revision=revision+1 WHERE id=?")
                              .run(f.workspaceId);
                          return column === undefined ? target.first() : target.first(column);
                        };
                      const value = Reflect.get(target, key);
                      return typeof value === "function" ? value.bind(target) : value;
                    },
                  });
                return intercept(statement);
              };
            },
          }),
        };
        const read = (source: V2Core) =>
          consumer === "analysis"
            ? loadAnalysisInput(source, f.actor, f.workspaceId)
            : loadReconciliationSource(
                source,
                { ...f.actor, caseId: f.workspaceId },
                { write: false },
              );
        await expect(read(core)).rejects.toMatchObject({ code: "STALE_REVISION" });
        expect(seen).toBe(boundary);
        await expect(read(f.core)).resolves.toBeDefined();
        expect(f.db.sqlite.query("SELECT count(*) n FROM v2_jobs").get()).toEqual({ n: 0 });
        expect(f.db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        f.db.close();
      }
    });
