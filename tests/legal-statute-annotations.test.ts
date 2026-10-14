import { expect, test } from "bun:test";
import { textHash } from "../src/server/modules/legal-retrieval/service";
import {
  parseStatute,
  parseStatuteCandidate,
} from "../src/server/modules/legal-retrieval/v2/statutes";
import { createBoundedTransport } from "../src/server/modules/legal-retrieval/v2/transport";
import officialList from "./fixtures/legal/official-list.json";
import officialDetail from "./fixtures/legal/official-sample.json";

const candidate = parseStatuteCandidate(officialList.LawSearch.law[0]);
const now = "2026-10-06T00:00:00.000Z";
const parse = (detail: unknown, number = "606") =>
  parseStatute(detail, candidate, { number, branch: "0" }, "2026-10-06", now);

for (const number of ["606", "607"])
  test(`captured article ${number} preserves its literal amendment annotation and exact source hash`, async () => {
    const original = officialDetail.법령.조문.조문단위.find((row) => row.조문번호 === number);
    if (!original) throw new Error("Missing captured article");
    const chunk = await parse(officialDetail, number);
    expect(chunk.source.body).toBe(original.조문내용);
    expect(chunk.span.text).toBe(original.조문내용);
    expect(chunk.span.endUtf16).toBe(original.조문내용.length);
    expect(chunk.source.contentHash).toBe(await textHash(original.조문내용));
    expect(chunk.citation.contentHash).toBe(chunk.source.contentHash);
    expect(chunk.source.sourceDate).toBe("2026-03-17");
  });

function syntheticDetail(body: string) {
  const detail = structuredClone(officialDetail);
  const article = detail.법령.조문.조문단위.find((row) => row.조문번호 === "606");
  if (!article) throw new Error("Missing synthetic article template");
  article.조문내용 = body;
  return detail;
}

test("synthetic bounded annotations preserve dates, spaces and comma-separated amendment histories", async () => {
  for (const annotation of [
    "<개정 2013. 8. 13.>",
    "<개정 2009.5.8, 2011. 7. 21., 2024.2.29>",
    "<신설 2013.8.13>",
    "<삭제 2013. 8. 13.>",
  ]) {
    const body = `합성 조문 본문. ${annotation}`;
    expect((await parse(syntheticDetail(body))).source.body).toBe(body);
  }
});

test("nested paragraph annotations retain their place in the normalized source and hash", async () => {
  const base = syntheticDetail("제606조(합성 조문)");
  const article = base.법령.조문.조문단위.find((row) => row.조문번호 === "606");
  if (!article) throw new Error("Missing synthetic article");
  Object.assign(article, {
    항: [
      { 항내용: "① 합성 첫 항. <개정 2013. 8. 13.>" },
      { 항내용: "② 합성 다음 항.", 호: { 호내용: "1. 합성 호. <신설 2014.2.28>" } },
    ],
  });
  const chunk = await parse(base);
  const expected =
    "제606조(합성 조문)\n① 합성 첫 항. <개정 2013. 8. 13.>\n② 합성 다음 항.\n1. 합성 호. <신설 2014.2.28>";
  expect(chunk.source.body).toBe(expected);
  expect(chunk.source.contentHash).toBe(await textHash(expected));
});

test("annotation parsing does not accept invalid dates, arbitrary Korean tags or malformed markup", async () => {
  for (const annotation of [
    "<개정 2023.2.29>",
    "<개정 2013.8.13,>",
    "<개정 secret>",
    "<미승인 2013.8.13>",
    "<개정 2013.8.13 onclick=secret>",
    "<개정 2013.8.13<script>secret</script>>",
    "<개정 2013.8.13",
    `<개정 ${" ".repeat(10000)}`,
    "&unknown;",
  ])
    await expect(parse(syntheticDetail(`합성 본문 ${annotation}`))).rejects.toMatchObject({
      reason: "schema_mismatch",
      schemaFailure: {
        stage: "statute_text",
        issues: [{ field: "article_text", expected: "plain_text" }],
      },
    });
});

test("real markup is still sanitized and escaped active markup cannot become source text", async () => {
  expect(
    (await parse(syntheticDetail("<p>합성 본문</p><script>secret</script><개정 2013.8.13>"))).source
      .body,
  ).toBe("합성 본문\n<개정 2013.8.13>");
  for (const body of [
    "합성 본문 &lt;script&gt;secret&lt;/script&gt; <개정 2013.8.13>",
    "합성 본문 <개정 2013.8.13> \ud800",
  ])
    await expect(parse(syntheticDetail(body))).rejects.toMatchObject({
      reason: "schema_mismatch",
      schemaFailure: { stage: "source_body", issues: [{ field: "body", expected: "plain_text" }] },
    });
});

test("transport rejects empty, invalid UTF-8 and truncated bodies with fixed diagnostic labels and no retry", async () => {
  for (const [response, field, expected] of [
    [
      new Response(null, { headers: { "content-type": "application/json" } }),
      "body",
      "nonempty_body",
    ],
    [
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "application/json" },
      }),
      "encoding",
      "utf8",
    ],
    [
      new Response(new Uint8Array([0xc3]), { headers: { "content-type": "application/json" } }),
      "encoding",
      "utf8",
    ],
    [
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "5" },
      }),
      "length",
      "declared_bytes",
    ],
  ] as const) {
    let calls = 0;
    const transport = createBoundedTransport(async () => {
      calls++;
      return response;
    });
    await expect(
      transport(
        new URL("https://www.law.go.kr/DRF/lawSearch.do?target=eflaw&type=JSON"),
        "moleg_eflaw_list",
        {
          authorize: async () => true,
          authorizeQuery: async () => true,
          reserveRequest: async () => true,
        },
      ),
    ).rejects.toMatchObject({
      reason: "schema_mismatch",
      schemaFailure: { stage: "response_body", issues: [{ field, expected }] },
    });
    expect(calls).toBe(1);
  }
});
