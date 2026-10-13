import { createV2Core, type V2Core } from "../../db/v2-core";
import { FileError } from "./binary";

// Per binary-part invocation, not per whole file. Leave room for signed access
// middleware outside this core and stop subsequent work on an over-limit receipt.
export const FILE_STORAGE_WORK = Object.freeze({
  queries: 200,
  rowsRead: 1_000_000,
  rowsWritten: 1000,
  cpuMs: 300_000,
});
const metered = new WeakSet<V2Core>();
export const hasFileStorageMeter = (core: V2Core) => metered.has(core);

/** Native D1 receipts, including every batch member, bound further dispatch.
 * This is an execution guard, never a provider receipt or refund. Already
 * committed intents survive a missing/over-limit response for later cleanup. */
export function fileStorageRequestCore(core: V2Core, requireRowMeta = true) {
  let queries = 0,
    read = 0,
    written = 0,
    stopped = false;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const fail = () => {
    stopped = true;
    throw new FileError("PROCESSING_UNAVAILABLE");
  };
  const charge = (count = 1) => {
    if (stopped || queries + count > FILE_STORAGE_WORK.queries) fail();
    queries += count;
  };
  const receipt = <T>(result: D1Result<T>) => {
    const r = result.meta?.rows_read,
      w = result.meta?.rows_written;
    if (requireRowMeta && (!Number.isSafeInteger(r) || !Number.isSafeInteger(w) || r < 0 || w < 0))
      fail();
    read += r ?? 0;
    written += w ?? 0;
    if (read > FILE_STORAGE_WORK.rowsRead || written > FILE_STORAGE_WORK.rowsWritten) fail();
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
        const row = receipt(await statement.all<Record<string, unknown>>()).results[0];
        return (column ? (row?.[column] ?? null) : (row ?? null)) as T | null;
      },
      async raw<T>(options?: { columnNames?: boolean }) {
        charge();
        const rows = receipt(await statement.all<Record<string, unknown>>()).results;
        const values = rows.map((row) => Object.values(row));
        return (options?.columnNames ? [Object.keys(rows[0] ?? {}), ...values] : values) as T[];
      },
    } as D1PreparedStatement;
    originals.set(value, statement);
    return value;
  };
  const binding = {
    prepare: (sql: string) => wrap(core.binding.prepare(sql)),
    async batch<T>(statements: D1PreparedStatement[]) {
      charge(statements.length);
      return (await core.binding.batch<T>(statements.map((s) => originals.get(s) ?? s))).map(
        receipt,
      );
    },
  } as D1Database;
  const result = createV2Core(binding, core.cipher, {
    monthlyBudgetCapEnabled: core.monthlyBudgetCapEnabled,
  });
  metered.add(result);
  return result;
}
