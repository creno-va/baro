import { z } from "zod";
import { displayText } from "../../../../contracts";
import { apiDate, digits, RetrievalFailure, type RetrievalPlan } from "./contracts";
import { OFFICIAL_CATALOG } from "./registry";
import { makeChunk } from "./source";
import { plainText } from "./text";

const candidateSchema = z.object({
  법령ID: digits,
  법령일련번호: digits,
  법령명한글: displayText(100),
  시행일자: apiDate,
  공포일자: apiDate,
  공포번호: z.union([displayText(100), z.number().int().nonnegative()]).transform(String),
});
const listSchema = z.object({
  LawSearch: z.object({
    law: z.union([candidateSchema, z.array(candidateSchema).max(100)]).optional(),
    totalCnt: z.coerce.number().int().min(0),
  }),
});
export type LawCandidate = z.infer<typeof candidateSchema>;
export function parseStatuteCandidate(value: unknown) {
  return candidateSchema.parse(value);
}
export function selectStatute(
  value: unknown,
  plan: Extract<RetrievalPlan, { kind: "statute" }>,
  asOfDate: string,
  observedDate = asOfDate,
) {
  const list = listSchema.parse(value).LawSearch;
  const rows = list.law ? (Array.isArray(list.law) ? list.law : [list.law]) : [];
  if (list.totalCnt > 100 || list.totalCnt !== rows.length)
    throw new RetrievalFailure("history_incomplete");
  if (rows.some((row) => row.공포일자 > observedDate)) throw new RetrievalFailure("date_invalid");
  const candidates = rows
    .filter(
      (row) =>
        row.법령명한글 === plan.lawTitle &&
        (!plan.lawId || row.법령ID === plan.lawId) &&
        row.시행일자 <= asOfDate,
    )
    .sort((a, b) => b.시행일자.localeCompare(a.시행일자));
  const first = candidates[0];
  if (!first) throw new RetrievalFailure("no_results");
  if (
    candidates.some((c) => c.시행일자 === first.시행일자 && c.법령일련번호 !== first.법령일련번호)
  )
    throw new RetrievalFailure("identity_mismatch");
  return first;
}
const article = z.object({
  조문번호: digits,
  조문가지번호: digits.optional(),
  조문여부: z.string(),
  조문내용: z.union([z.string(), z.array(z.string()).max(100)]),
  조문시행일자: apiDate,
  항: z.unknown().optional(),
});
const detail = z.object({
  법령: z.object({
    기본정보: z.object({
      법령ID: digits,
      법령명_한글: displayText(100),
      시행일자: apiDate,
      공포일자: apiDate,
      공포번호: z.union([displayText(100), z.number().int().nonnegative()]).transform(String),
    }),
    조문: z.object({ 조문단위: z.union([article, z.array(article).max(3000)]) }),
  }),
});
function nested(value: unknown, depth = 0): string[] {
  if (value === undefined) return [];
  if (depth > 3) throw new RetrievalFailure("schema_mismatch");
  const values = Array.isArray(value) ? value : [value];
  if (values.length > 1000) throw new RetrievalFailure("too_large");
  return values.flatMap((raw) => {
    const row = z
      .object({
        항내용: z.string().optional(),
        호내용: z.string().optional(),
        목내용: z.string().optional(),
        호: z.unknown().optional(),
        목: z.unknown().optional(),
      })
      .parse(raw);
    return [
      row.항내용,
      row.호내용,
      row.목내용,
      ...nested(row.호, depth + 1),
      ...nested(row.목, depth + 1),
    ].filter((v): v is string => !!v);
  });
}
export async function parseStatute(
  value: unknown,
  candidate: LawCandidate,
  selected: { number: string; branch: string },
  asOfDate: string,
  now: string,
) {
  const root = detail.parse(value).법령,
    basic = root.기본정보;
  if (
    basic.법령ID !== candidate.법령ID ||
    basic.법령명_한글 !== candidate.법령명한글 ||
    basic.시행일자 !== candidate.시행일자 ||
    basic.공포일자 !== candidate.공포일자 ||
    basic.공포번호 !== candidate.공포번호
  )
    throw new RetrievalFailure("identity_mismatch");
  const rows = Array.isArray(root.조문.조문단위) ? root.조문.조문단위 : [root.조문.조문단위];
  const chosen = rows.filter(
    (row) =>
      row.조문여부 === "조문" &&
      row.조문번호 === BigInt(selected.number).toString() &&
      (row.조문가지번호 ?? "0") === BigInt(selected.branch).toString(),
  );
  if (chosen.length !== 1) throw new RetrievalFailure("identity_mismatch");
  const row = chosen[0];
  if (!row) throw new RetrievalFailure("no_results");
  const text = plainText(
    [...(Array.isArray(row.조문내용) ? row.조문내용 : [row.조문내용]), ...nested(row.항)].join(
      "\n",
    ),
  );
  return makeChunk(
    {
      sourceType: "statute",
      officialId: basic.법령ID,
      version: candidate.법령일련번호,
      section: `제${row.조문번호}조${BigInt(selected.branch) !== 0n ? `의${BigInt(selected.branch)}` : ""}`,
      canonicalUrl: `https://law.go.kr/LSW/lsInfoP.do?lsiSeq=${candidate.법령일련번호}`,
      title: basic.법령명_한글,
      body: text,
      sourceDate: row.조문시행일자,
      fetchedAt: now,
      verifiedAt: now,
      rightsProvenance: OFFICIAL_CATALOG[0].rights,
      institutionId: null,
      endpointId: null,
      court: null,
      caseNumber: null,
    },
    asOfDate,
  );
}
