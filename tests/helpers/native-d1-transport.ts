import type { Miniflare } from "miniflare";

// Only the transport is local. Every statement, parameter check, batch transaction
// and result/metadata comes from workerd's real D1 binding. Miniflare's generic
// getD1Database proxy instead performs synchronous IPC for each prepare/bind and
// property access; those calls can dominate the entire native runtime test.
export const nativeD1TransportWorker = `
export default {
  async fetch(request, env) {
    const input = await request.json();
    const db = env[input.database];
    const argument = value =>
      value.kind === "bytes" ? new Uint8Array(value.value).buffer :
      value.kind === "array" ? value.value.map(argument) :
      value.kind === "number" ? Number(value.value) :
      value.kind === "bigint" ? BigInt(value.value) :
      value.kind === "undefined" ? undefined : value.value;
    const statement = (input) => {
      const prepared = db.prepare(input.sql);
      return input.values === null ? prepared : prepared.bind(...input.values.map(argument));
    };
    try {
      const value = input.operation === "batch"
        ? await db.batch(input.statements.map(statement))
        : await statement(input.statement)[input.operation](input.options);
      return Response.json({ ok: true, value });
    } catch (error) {
      const encode = (error, depth = 0) => ({
        name: error?.name ?? "Error",
        message: error?.message ?? "Native D1 failed",
        ...(error?.cause && depth < 4 ? { cause: encode(error.cause, depth + 1) } : {}),
      });
      return Response.json({ ok: false, error: encode(error) });
    }
  }
};`;

type Argument =
  | { kind: "value"; value: unknown }
  | { kind: "bytes"; value: number[] }
  | { kind: "array"; value: Argument[] }
  | { kind: "number" | "bigint"; value: string }
  | { kind: "undefined" };
type Statement = { sql: string; values: Argument[] | null };
type NativeError = { name: string; message: string; cause?: NativeError };

/** Test-only D1 operations used by the native runtime fixture; no SQL emulation. */
export function nativeD1Transport(mf: Miniflare, database: string): D1Database {
  const statements = new WeakMap<D1PreparedStatement, Statement>();
  const error = (input: NativeError): Error => {
    const result = new Error(
      input.message,
      input.cause ? { cause: error(input.cause) } : undefined,
    );
    result.name = input.name;
    return result;
  };
  const send = async <T>(input: Record<string, unknown>): Promise<T> => {
    const response = await fetch(await mf.ready, {
      method: "POST",
      body: JSON.stringify({ database, ...input }),
    });
    if (!response.ok) throw new Error("Native D1 transport failed");
    const result = (await response.json()) as
      | { ok: true; value: T }
      | { ok: false; error: NativeError };
    if (!result.ok) throw error(result.error);
    return result.value;
  };
  const argument = (value: unknown): Argument => {
    if (value === undefined) return { kind: "undefined" };
    // JSON would silently turn nonfinite numbers into null and bigint cannot be
    // encoded directly. Preserve them so D1 itself performs its binding checks.
    if (typeof value === "number" && !Number.isFinite(value))
      return { kind: "number", value: String(value) };
    if (typeof value === "bigint") return { kind: "bigint", value: String(value) };
    if (Array.isArray(value)) return { kind: "array", value: value.map(argument) };
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes =
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { kind: "bytes", value: [...bytes] };
    }
    // D1 accepts scalar values and byte arrays, not arbitrary objects. Do not
    // allow an object's toJSON hook (e.g. Date) to turn it into an accepted text.
    return {
      kind: "value",
      value: value !== null && typeof value === "object" && !Array.isArray(value) ? {} : value,
    };
  };
  const prepare = (descriptor: Statement): D1PreparedStatement => {
    const statement = {
      bind: (...values: unknown[]) => prepare({ ...descriptor, values: values.map(argument) }),
      all: <T>() => send<D1Result<T>>({ operation: "all", statement: descriptor }),
      run: <T>() => send<D1Result<T>>({ operation: "run", statement: descriptor }),
      first: <T>(column?: string) =>
        send<T | null>({ operation: "first", statement: descriptor, options: column }),
      raw: <T>(options?: { columnNames?: boolean }) =>
        send<T[]>({ operation: "raw", statement: descriptor, options }),
    } as D1PreparedStatement;
    statements.set(statement, descriptor);
    return statement;
  };
  return {
    prepare: (sql: string) => prepare({ sql, values: null }),
    batch: <T>(batch: D1PreparedStatement[]) =>
      send<D1Result<T>[]>({
        operation: "batch",
        statements: batch.map((statement) => {
          const descriptor = statements.get(statement);
          if (!descriptor) throw new Error("Native D1 statement belongs to another binding");
          return descriptor;
        }),
      }),
  } as D1Database;
}
