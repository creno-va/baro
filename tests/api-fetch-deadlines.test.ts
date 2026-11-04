import { expect, test } from "bun:test";
import { apiFetch } from "../src/client/api/fetch";

test("a slow synchronous report survives metadata expiry while admission, cancellation and transfer limits remain bounded", async () => {
  const originalFetch = globalThis.fetch,
    originalTimeout = AbortSignal.timeout;
  let elapsed = 0;
  const deadlines: { at: number; controller: AbortController }[] = [];
  const calls: { path: string; finish: (response: Response) => void }[] = [];
  AbortSignal.timeout = (milliseconds) => {
    const controller = new AbortController();
    deadlines.push({ at: elapsed + milliseconds, controller });
    return controller.signal;
  };
  globalThis.fetch = ((_path: string | URL | Request, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const abort = () => reject(init.signal?.reason);
      init.signal?.addEventListener("abort", abort, { once: true });
      calls.push({
        path: String(_path),
        finish: (response) => {
          init.signal?.removeEventListener("abort", abort);
          resolve(response);
        },
      });
    })) as typeof fetch;
  const advance = (milliseconds: number) => {
    elapsed += milliseconds;
    for (const { at, controller } of deadlines)
      if (at <= elapsed && !controller.signal.aborted)
        controller.abort(new DOMException("Synthetic transport elapsed", "TimeoutError"));
  };
  try {
    const metadata = apiFetch("/api/v2/cases/synthetic/rework/report").catch(
      (error: unknown) => error,
    );
    const admission = apiFetch("/api/v2/cases/synthetic/rework/actions", {
      method: "POST",
      body: "{}",
    }).catch((error: unknown) => error);
    const generated = apiFetch("/api/v2/cases/synthetic/reports", {
      method: "POST",
      body: "{}",
    });
    const saved = apiFetch("/api/v2/cases/synthetic/reports?review=current", {
      method: "patch",
      body: JSON.stringify({ content: "사진을 포함한 합성 검토 본문" }),
    }).catch((error: unknown) => error);
    const boundedSave = apiFetch("/api/v2/cases/synthetic/reports", {
      method: "PATCH",
      body: "{}",
    }).catch((error: unknown) => error);
    let finished = false;
    void generated.then(() => {
      finished = true;
    });
    const transfer = apiFetch("/api/v2/cases/synthetic/reports/pdf").catch(
      (error: unknown) => error,
    );
    advance(48_000);
    expect(await metadata).toMatchObject({ name: "TimeoutError" });
    expect(await admission).toMatchObject({ name: "TimeoutError" });
    await Promise.resolve();
    expect(finished).toBe(false);
    calls[2]?.finish(Response.json({ accepted: true }));
    expect(JSON.stringify(await (await generated).json())).toBe('{"accepted":true}');
    calls[3]?.finish(Response.json({ saved: true }));
    const savedResponse = await saved;
    expect(savedResponse).toBeInstanceOf(Response);
    expect(JSON.stringify(await (savedResponse as Response).json())).toBe('{"saved":true}');

    const cancel = new AbortController();
    const cancelled = apiFetch("/api/v2/cases/synthetic/reports", {
      method: "PATCH",
      signal: cancel.signal,
    }).catch((error: unknown) => error);
    cancel.abort();
    expect(await cancelled).toMatchObject({ name: "AbortError" });
    const cancelGeneration = new AbortController();
    const cancelledGeneration = apiFetch("/api/v2/cases/synthetic/reports", {
      method: "POST",
      signal: cancelGeneration.signal,
    }).catch((error: unknown) => error);
    cancelGeneration.abort();
    expect(await cancelledGeneration).toMatchObject({ name: "AbortError" });
    advance(252_000);
    expect(await boundedSave).toMatchObject({ name: "TimeoutError" });
    expect(await transfer).toMatchObject({ name: "TimeoutError" });
    expect(calls).toHaveLength(8);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});
