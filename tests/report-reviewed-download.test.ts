import { expect, test } from "bun:test";
import type { ReportView } from "../src/client/api/types";
import {
  downloadReviewedReport,
  type ReviewedReportDownloadPorts,
} from "../src/components/reports/download-reviewed";

const identity = {
  caseId: "synthetic-case",
  reportId: "synthetic-reviewed-report",
  reportRevision: 2,
  expectedOwner: "synthetic-owner",
};
function fixture() {
  let owner = identity.expectedOwner;
  let report: ReportView | null = {
    id: identity.reportId,
    caseId: identity.caseId,
    revision: 2,
    title: "합성",
    content: "합성 검토 본문",
    updatedAt: "2026-11-01T00:00:00Z",
    stale: false,
    maskIdentifiers: false,
    excludedFileIds: [],
  };
  const calls: string[] = [];
  let duringPdf: () => void = () => {};
  let reject = false;
  const ports: ReviewedReportDownloadPorts = {
    session: async () => {
      calls.push("owner");
      return { user: { id: owner, name: "합성", accountType: "customer" }, needsConsent: false };
    },
    peekReport: async (_id, options) => {
      calls.push("peek");
      expect(options.expectedOwner).toBe(identity.expectedOwner);
      return report;
    },
    pdf: async (id) => {
      calls.push("pdf");
      expect(id).toBe(identity.reportId);
      duringPdf();
      if (reject) throw new Error("synthetic PDF failure");
      return new Blob(["%PDF-synthetic"], { type: "application/pdf" });
    },
    download: (_blob, name) => {
      calls.push("download");
      expect(name).toBe(`BARO-${identity.reportId}.pdf`);
    },
  };
  return {
    ports,
    calls,
    setOwner: (value: string) => {
      owner = value;
    },
    setReport: (value: typeof report) => {
      report = value;
    },
    stale: () => {
      if (report) report = { ...report, stale: true };
    },
    duringPdf: (value: () => void) => {
      duringPdf = value;
    },
    reject: () => {
      reject = true;
    },
  };
}
test("the reviewed version is checked before and after PDF and only then dispatches the download", async () => {
  const f = fixture();
  await downloadReviewedReport(identity, f.ports);
  expect(f.calls.filter((call) => call === "peek")).toHaveLength(2);
  expect(f.calls.filter((call) => call === "pdf")).toHaveLength(1);
  expect(f.calls.at(-1)).toBe("download");
});
for (const when of ["before", "during"] as const)
  test(`a changed report ${when} PDF cannot download a replacement silently`, async () => {
    const f = fixture();
    const change = () => f.setReport(null);
    if (when === "before") change();
    else f.duringPdf(change);
    await expect(downloadReviewedReport(identity, f.ports)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(f.calls).not.toContain("download");
    if (when === "before") expect(f.calls).not.toContain("pdf");
  });
test("account change, host cancellation, abort and provider failure are propagated without download", async () => {
  const owner = fixture();
  owner.duringPdf(() => owner.setOwner("synthetic-other-owner"));
  await expect(downloadReviewedReport(identity, owner.ports)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  expect(owner.calls).not.toContain("download");
  const host = fixture();
  await expect(
    downloadReviewedReport({ ...identity, verify: async () => false }, host.ports),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(host.calls).toEqual([]);
  const abort = fixture(),
    controller = new AbortController();
  abort.duringPdf(() => controller.abort());
  await expect(
    downloadReviewedReport({ ...identity, signal: controller.signal }, abort.ports),
  ).rejects.toThrow();
  expect(abort.calls).not.toContain("download");
  const provider = fixture();
  provider.reject();
  await expect(downloadReviewedReport(identity, provider.ports)).rejects.toThrow(
    "synthetic PDF failure",
  );
  expect(provider.calls).not.toContain("download");
});

test("an unchanged report ID that becomes stale while rendering cannot silently download", async () => {
  const f = fixture();
  f.duringPdf(f.stale);
  await expect(downloadReviewedReport(identity, f.ports)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(f.calls).not.toContain("download");
});
