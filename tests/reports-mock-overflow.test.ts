import { expect, test } from "bun:test";
import { createReportsMockHandler, type ReportMockState } from "../src/client/api/mock/reports";
import { createReportsClient } from "../src/client/api/reports";

function fixture(text = "Synthetic extraction") {
  let state: ReportMockState = {
    session: {
      user: { id: "synthetic-owner", name: "Synthetic", accountType: "customer" },
      needsConsent: false,
    },
    cases: {
      demo: {
        id: "demo",
        title: "Synthetic report",
        subjectContext: "individual",
        stage: "active",
        revision: 1,
        updatedAt: "2026-10-01T00:00:00Z",
        summary: "Synthetic facts",
      },
    },
    workspace: {},
    files: {
      demo: [
        {
          id: "synthetic-file",
          name: "synthetic.txt",
          mimeType: "text/plain",
          sizeBytes: 40000,
          status: "ready",
          coverage: "Synthetic coverage",
          extractedText: text,
        },
      ],
    },
    reports: {},
  };
  const update = (action: (s: ReportMockState) => void) => {
    const next = structuredClone(state);
    action(next);
    state = next;
  };
  const handler = createReportsMockHandler({
    read: () => structuredClone(state),
    update,
    original: async () => new Blob([text]),
  });
  return {
    read: () => structuredClone(state),
    update,
    handler,
    client: createReportsClient(handler),
  };
}
test("oversized first mock report fails without truncating or saving and recovers by exclusion", async () => {
  const text = `${"a".repeat(29999)}😀TAIL`,
    f = fixture(text);
  expect(text.isWellFormed()).toBe(true);
  await expect(f.client.get("demo")).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
  await expect(f.client.generate("demo", [])).rejects.toMatchObject({
    code: "EXPORT_LIMIT_EXCEEDED",
  });
  expect(f.read().reports).toEqual({});
  expect(f.read().reportRequests).toBeUndefined();
  expect(f.read().files.demo?.[0]?.extractedText).toBe(text);
  const recovered = await f.client.generate("demo", ["synthetic-file"]);
  expect(recovered.revision).toBe(1);
  expect(recovered.excludedFileIds).toEqual(["synthetic-file"]);
  expect(recovered.content).toContain("연락과 전달");
  expect(recovered.content.isWellFormed()).toBe(true);
});
test("exactly 30000 UTF-16 units retain the full Unicode text; one extra unit fails", async () => {
  const seed = fixture("MARKER");
  const baseline = await seed.client.get("demo");
  const text = `${"a".repeat(30000 - baseline.content.length + 6 - 2)}😀`;
  const f = fixture(text),
    report = await f.client.get("demo");
  expect(report.content.length).toBe(30000);
  expect(report.content).toContain(text);
  expect(report.content.isWellFormed()).toBe(true);
  expect(report.content).toContain("연락과 전달");
  const over = fixture(`${text}b`);
  await expect(over.client.get("demo")).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
  expect(over.read().reports).toEqual({});
});
test("oversized mock regeneration preserves prior report, history and retry key", async () => {
  const f = fixture(),
    prior = await f.client.get("demo");
  f.update((state) => {
    const file = state.files.demo?.[0];
    if (file) file.extractedText = "a".repeat(30000);
  });
  const snapshot = f.read();
  await expect(f.client.generate("demo", [])).rejects.toMatchObject({
    code: "EXPORT_LIMIT_EXCEEDED",
  });
  expect(f.read()).toEqual(snapshot);
  const next = await f.client.generate("demo", ["synthetic-file"]);
  expect(next.revision).toBe(prior.revision + 1);
  expect(f.read().reportHistory?.[prior.id]?.content).toBe(prior.content);
});
test("removing an exclusion cannot silently truncate a reviewed report", async () => {
  const f = fixture("a".repeat(30000));
  const prior = await f.client.generate("demo", ["synthetic-file"]);
  const snapshot = f.read();
  await expect(
    f.client.save(
      "demo",
      { content: prior.content, maskIdentifiers: false, excludedFileIds: [] },
      prior.revision,
    ),
  ).rejects.toMatchObject({ code: "EXPORT_LIMIT_EXCEEDED" });
  expect(f.read()).toEqual(snapshot);
});
