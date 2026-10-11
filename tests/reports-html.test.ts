import { expect, test } from "bun:test";
import { createReportHtml } from "../src/components/reports/document";
import { reportHttpFixture } from "./helpers/report-http-fixture";
import { seedTestSession } from "./helpers/session";

test("standalone HTML escapes user markup, masks title/body, preserves sections, positions and historical basis without remote resources", () => {
  const html = createReportHtml({
    title: '자료 <img src=x onerror="alert(1)"> · 010-1234-5678',
    content:
      "사건 요약\n<script>alert(1)</script>\n전화 010-1234-5678\n\n타임라인\n2.25–8.75초에 관찰한 내용\n\n미확인 사항\n12.5–19.25초 누락\n\n준비할 행동\n원본 확인",
    revision: 2,
    updatedAt: "2026-10-09T00:00:00.000Z",
    stale: true,
    maskIdentifiers: true,
    excludedFileIds: ["one"],
    basis: { workspaceRevision: 8, summaryRevision: 2, generatedAt: "2026-10-08T01:02:00.000Z" },
  });
  expect(html).toStartWith("<!doctype html>");
  expect(html).toContain('lang="ko"');
  expect(html).toContain('data-baro-report="1"');
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("&lt;img src=x onerror=&quot;");
  expect(html).not.toContain("<script");
  expect(html).toContain('alt="바로 로고"');
  expect(html).toContain('src="data:image/svg+xml;base64,');
  expect(html).not.toContain("010-1234-5678");
  expect(html).not.toContain("https://");
  expect(html).toContain("[전화번호 가림]");
  expect(html).toContain("2.25–8.75초");
  expect(html).toContain("12.5–19.25초 누락");
  expect(html).toContain("이전 생성 기준");
  expect(html).toContain("2026.10.08 · 01:02 UTC");
  expect(html).toContain("2 · 8");
  expect(html).toContain("@media print");
});
test("HTML endpoint reads the exact saved masked report before re-consent; cross-owner and deleted reports remain inaccessible", async () => {
  const f = await reportHttpFixture();
  const original = await f.reports.get(f.actor.ownerId, f.workspaceId);
  const saved = await f.reports.save(f.actor.ownerId, f.workspaceId, crypto.randomUUID(), {
    expectedRevision: original.revision,
    content: "사건 요약\n저장된 교정 010-1234-5678\n<script>금지된 실행</script>",
    maskIdentifiers: true,
    excludedFileIds: [],
  });
  const path = `/api/v2/reports/${saved.id}/html`;
  const get = (cookie = f.cookie) => f.app.request(path, { headers: { cookie } }, f.env);
  f.db.sqlite.query("DELETE FROM user_consents WHERE user_id=?").run(f.actor.ownerId);
  const response = await get(),
    html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(html).toContain("저장된 교정 [전화번호 가림]");
  expect(html).not.toContain("010-1234-5678");
  expect(html).toContain("&lt;script&gt;");
  const peer = await seedTestSession(f.db, { consent: true });
  expect((await get(peer.cookie)).status).toBe(404);
  f.db.sqlite.query("DELETE FROM v2_files WHERE id=?").run(f.selectedFileId);
  expect((await get()).status).toBe(404);
});
