import { z } from "zod";
import { displayText } from "../../../../contracts";
import { apiDate, digits, RetrievalFailure } from "./contracts";
import { OFFICIAL_CATALOG } from "./registry";
import { makeChunk } from "./source";
import { plainText } from "./text";

// Actual PrecSearch lists use YYYY.MM.DD; details also use compact YYYYMMDD.
// Normalize only the observed notation, then retain apiDate's calendar checks.
const precedentDate = z.preprocess(
  (value) =>
    typeof value === "string" && /^\d{4}\.\d{2}\.\d{2}$/.test(value)
      ? value.replaceAll(".", "")
      : value,
  apiDate,
);
const candidate = z
  .object({
    판례일련번호: digits,
    사건명: displayText(500),
    사건번호: displayText(200),
    선고일자: precedentDate,
    법원명: z.union([displayText(200), z.literal("")]),
    데이터출처명: z.string().optional(),
  })
  .refine((row) => row.법원명 !== "" || row.데이터출처명 === "국세법령정보시스템", {
    path: ["법원명"],
    message: "A supported precedent must identify its court",
  });
export type PrecedentCandidate = z.infer<typeof candidate>;
export function matchesPrecedentCaseNumber(listNumber: string, detailNumber: string) {
  if (listNumber === detailNumber) return true;
  // A captured joined decision lists its leading case number but its detail
  // appends same-year/type serials (e.g. 2026다100001, 100002). Match the complete
  // leading number, never a substring, a later number or an arbitrary suffix.
  if (!/^\d{4}[가-힣]{1,4}\d{1,10}(?:,\s*\d{1,10})+$/.test(detailNumber)) return false;
  const [leading, ...serials] = detailNumber.split(/,\s*/);
  const leadingSerial = leading?.match(/[가-힣]+(\d+)$/)?.[1];
  return leading === listNumber && new Set([leadingSerial, ...serials]).size === serials.length + 1;
}
export function precedentCandidates(value: unknown, asOfDate: string, limit: number) {
  const root = z
    .object({
      PrecSearch: z.object({
        prec: z.union([z.object({}).passthrough(), z.array(z.unknown()).max(100)]).optional(),
        totalCnt: z.coerce.number().int().nonnegative(),
      }),
    })
    .parse(value).PrecSearch;
  const rows = root.prec ? (Array.isArray(root.prec) ? root.prec : [root.prec]) : [];
  if (rows.length > root.totalCnt) throw new RetrievalFailure("schema_mismatch");
  if (root.totalCnt > 0 && !rows.length) throw new RetrievalFailure("schema_mismatch");
  const valid: PrecedentCandidate[] = [];
  let malformed = false;
  for (const row of rows) {
    const parsed = candidate.safeParse(row);
    if (!parsed.success) {
      malformed = true;
      continue;
    }
    valid.push(parsed.data);
  }
  if (malformed && !valid.length) throw new RetrievalFailure("schema_mismatch");
  if (new Set(valid.map((row) => row.판례일련번호)).size !== valid.length)
    throw new RetrievalFailure("identity_mismatch");
  return {
    rows: valid.filter((row) => row.선고일자 <= asOfDate).slice(0, limit),
    truncated: root.totalCnt > rows.length,
    ...(malformed ? { failures: ["schema_mismatch" as const] } : {}),
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
        선고일자: precedentDate,
        법원명: displayText(200),
        판결요지: z.string().optional(),
        판례내용: z.string().optional(),
      }),
    })
    .parse(value).PrecService;
  if (
    root.판례정보일련번호 !== expected.판례일련번호 ||
    root.사건명 !== expected.사건명 ||
    !matchesPrecedentCaseNumber(expected.사건번호, root.사건번호) ||
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
      // Keep the exact verified discovery number for cache metadata checks.
      // A joined detail's leading case still identifies this same official ID.
      caseNumber: expected.사건번호,
    },
    asOfDate,
  );
  return { chunk, full };
}
