import { createV2Core, type V2Core } from "../../db/v2-core";
import { ReportError } from "./source";

// Leave room for the session/origin middleware on the same Workers invocation.
export const REPORT_QUERY_LIMIT = 900;
export const REPORT_ROW_LIMIT = 2_700_000;
export type ReportWorkPlan = { queries: number; rowsRead: number; rowsWritten: number };
const meters = new WeakMap<
  D1Database,
  { plan: (plan: ReportWorkPlan) => void; cleanup: () => void }
>();
export function applyReportWorkPlan(core: V2Core, plan: ReportWorkPlan) {
  meters.get(core.binding)?.plan(plan);
}
export function allowReportCleanup(core: V2Core) {
  meters.get(core.binding)?.cleanup();
}
/** Conservative envelope includes both artifacts, three source passes, the
 * outward download, existing original GET admission and immutable record CAS.
 * A case/file byte limit is not a promise that one synchronous ZIP fits D1. */
export function reportWorkPlan(input: {
  pdfBytes: number;
  zipBytes?: number;
  selectedFiles?: number;
  originalParts?: number;
  sourceRows: number;
  reportFiles: number;
}): ReportWorkPlan {
  const chunks = Math.ceil(input.pdfBytes / 262144) + Math.ceil((input.zipBytes ?? 0) / 262144);
  const queries =
    300 +
    5 * chunks +
    input.reportFiles * 15 +
    3 * ((input.selectedFiles ?? 0) * 24 + (input.originalParts ?? 0) * 32);
  if (input.sourceRows > 250 || queries > REPORT_QUERY_LIMIT - 100)
    throw new ReportError("EXPORT_LIMIT_EXCEEDED");
  return {
    queries,
    rowsRead: REPORT_QUERY_LIMIT * (1000 + input.sourceRows * 8),
    rowsWritten: 1000,
  };
}
/** Request-local metering, never mutate the shared Env binding. Every query is
 * checked before dispatch; batches count each statement. Actual D1 row metadata
 * stops further dispatch if the measured envelope is exhausted. */
export function reportRequestCore(core: V2Core, requireRowMeta = true) {
  let queries = 0,
    rowsRead = 0,
    rowsWritten = 0;
  let queryLimit = REPORT_QUERY_LIMIT,
    rowLimit = REPORT_ROW_LIMIT,
    writeLimit = 1000,
    planned = false;
  const original = new WeakMap<object, D1PreparedStatement>();
  const charge = (n = 1) => {
    if (queries + n > queryLimit || rowsRead > rowLimit || rowsWritten > writeLimit)
      throw new ReportError("EXPORT_LIMIT_EXCEEDED");
    queries += n;
  };
  const receipt = <T extends { meta?: { rows_read?: number; rows_written?: number } }>(
    result: T,
  ): T => {
    if (
      requireRowMeta &&
      (!Number.isSafeInteger(result.meta?.rows_read) ||
        !Number.isSafeInteger(result.meta?.rows_written))
    )
      throw new ReportError("STORAGE_UNAVAILABLE");
    rowsRead += result.meta?.rows_read ?? 0;
    rowsWritten += result.meta?.rows_written ?? 0;
    if (rowsRead > rowLimit || rowsWritten > writeLimit)
      throw new ReportError("EXPORT_LIMIT_EXCEEDED");
    return result;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    const value = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values)),
      async all<T>() {
        charge();
        return receipt(await statement.all<T>());
      },
      async run<T>() {
        charge();
        return receipt(await statement.run<T>());
      },
      async first<T>(column?: string) {
        charge();
        const result = receipt(await statement.all<Record<string, unknown>>());
        const row = result.results[0];
        return (column ? (row?.[column] ?? null) : (row ?? null)) as T | null;
      },
      async raw<T>(options?: { columnNames?: boolean }) {
        charge();
        const result = receipt(await statement.all<Record<string, unknown>>());
        const rows = result.results.map((row) => Object.values(row));
        return (
          options?.columnNames ? [Object.keys(result.results[0] ?? {}), ...rows] : rows
        ) as T[];
      },
    } as D1PreparedStatement;
    original.set(value, statement);
    return value;
  };
  const binding = {
    prepare: (sql: string) => wrap(core.binding.prepare(sql)),
    async batch<T>(statements: D1PreparedStatement[]) {
      charge(statements.length);
      const results = await core.binding.batch<T>(statements.map((s) => original.get(s) ?? s));
      return results.map(receipt);
    },
  } as D1Database;
  meters.set(binding, {
    plan: (plan) => {
      if (planned) return;
      planned = true;
      queryLimit = plan.queries;
      rowLimit = plan.rowsRead;
      writeLimit = plan.rowsWritten;
      if (queries > queryLimit || rowsRead > rowLimit || rowsWritten > writeLimit)
        throw new ReportError("EXPORT_LIMIT_EXCEEDED");
    },
    cleanup: () => {
      queryLimit = REPORT_QUERY_LIMIT;
    },
  });
  return createV2Core(binding, core.cipher);
}
