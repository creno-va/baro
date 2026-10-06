import { z } from "zod";
import { displayText } from "../../../../contracts";
import { apiDate, digits, RetrievalFailure } from "./contracts";
import { OFFICIAL_CATALOG } from "./registry";
import { makeChunk } from "./source";
import { plainText } from "./text";

const candidate = z.object({
  판례일련번호: digits,
  사건명: displayText(500),
  사건번호: displayText(200),
  선고일자: apiDate,
  법원명: displayText(200),
  데이터출처명: z.string().optional(),
});
export type PrecedentCandidate = z.infer<typeof candidate>;
export function precedentCandidates(value: unknown, asOfDate: string, limit: number) {
  const root = z
    .object({
      PrecSearch: z.object({
        prec: z.union([candidate, z.array(candidate).max(100)]).optional(),
        totalCnt: z.coerce.number().int().nonnegative(),
      }),
    })
    .parse(value).PrecSearch;
  const rows = root.prec ? (Array.isArray(root.prec) ? root.prec : [root.prec]) : [];
  if (rows.length > root.totalCnt) throw new RetrievalFailure("schema_mismatch");
  return {
    rows: rows.filter((row) => row.선고일자 <= asOfDate).slice(0, limit),
    truncated: root.totalCnt > rows.length,
  };
}
// PrecService and field types were checked against the public documented
// example. The example proves no configured credential or corpus coverage.
export async function parsePrecedent(
  value: unknown,
  expected: PrecedentCandidate,
  asOfDate: string,
  now: string,
) {
  if (expected.데이터출처명 === "국세법령정보시스템")
    throw new RetrievalFailure("unsupported_format");
  const root = z
    .object({
      PrecService: z.object({
        판례정보일련번호: digits,
        사건명: displayText(500),
        사건번호: displayText(200),
        선고일자: apiDate,
        법원명: displayText(200),
        판결요지: z.string().optional(),
        판례내용: z.string().optional(),
      }),
    })
    .parse(value).PrecService;
  if (
    root.판례정보일련번호 !== expected.판례일련번호 ||
    root.사건명 !== expected.사건명 ||
    root.사건번호 !== expected.사건번호 ||
    root.선고일자 !== expected.선고일자 ||
    root.법원명 !== expected.법원명
  )
    throw new RetrievalFailure("identity_mismatch");
  const full = !!root.판례내용?.trim();
  const section = full ? "판례내용" : "판결요지";
  const body = plainText(full ? (root.판례내용 ?? "") : (root.판결요지 ?? ""));
  if (!body) throw new RetrievalFailure("unsupported_format");
  const chunk = await makeChunk(
    {
      sourceType: "precedent",
      officialId: root.판례정보일련번호,
      version: `decision_${root.선고일자}`,
      section,
      canonicalUrl: `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${root.판례정보일련번호}`,
      title: root.사건명,
      body,
      sourceDate: root.선고일자,
      fetchedAt: now,
      verifiedAt: now,
      rightsProvenance: OFFICIAL_CATALOG[1].rights,
      institutionId: null,
      endpointId: null,
      court: root.법원명,
      caseNumber: root.사건번호,
    },
    asOfDate,
  );
  return { chunk, full };
}
