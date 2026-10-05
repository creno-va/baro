import { z } from "zod";
import {
  citationSchema,
  dateSchema,
  displayText,
  retrievalOutputSchema,
  timestampSchema,
} from "../../../contracts";
import type { createDomainRepository } from "../../db/repository";

const digits = z.string().regex(/^\d{1,12}$/);
const apiDate = z
  .string()
  .regex(/^\d{8}$/)
  .transform((s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`)
  .pipe(dateSchema);
const candidateSchema = z.object({
  법령ID: digits,
  법령일련번호: digits,
  법령명한글: displayText(100),
  시행일자: apiDate,
});
const listSchema = z.object({
  LawSearch: z.object({
    law: z.union([z.array(candidateSchema).max(100), candidateSchema]).optional(),
    totalCnt: z.coerce.number().int().min(0),
  }),
});
const sectionSchema = z.object({
  항내용: z.string().optional(),
  호내용: z.string().optional(),
  목내용: z.string().optional(),
  호: z.unknown().optional(),
  목: z.unknown().optional(),
});
const articleSchema = z.object({
  조문번호: digits,
  조문가지번호: digits.optional(),
  조문여부: z.string(),
  조문내용: z.union([z.string(), z.array(z.string())]),
  조문시행일자: apiDate,
  항: z.unknown().optional(),
});
const detailSchema = z.object({
  법령: z.object({
    기본정보: z.object({ 법령ID: digits, 법령명_한글: displayText(100), 시행일자: apiDate }),
    조문: z.object({ 조문단위: z.union([z.array(articleSchema).max(3000), articleSchema]) }),
  }),
});
export class LegalSourceError extends Error {
  constructor() {
    super("LEGAL_SOURCE_UNAVAILABLE");
  }
}
type Transport = (url: string, init: RequestInit) => Promise<Response>;
type Repo = ReturnType<typeof createDomainRepository>;
const conceptSchema = z.enum(["loan", "interest", "repayment"]);
const articleNumbers = { loan: ["598"], interest: ["600"], repayment: ["603"] } as const;
export async function textHash(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function array<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
function sectionText(value: unknown, depth = 0): string[] {
  if (value === undefined) return [];
  if (depth > 3) throw new LegalSourceError();
  return array(value).flatMap((item) => {
    const s = sectionSchema.parse(item);
    return [
      s.항내용,
      s.호내용,
      s.목내용,
      ...sectionText(s.호, depth + 1),
      ...sectionText(s.목, depth + 1),
    ].filter((v): v is string => typeof v === "string" && !!v);
  });
}
export function selectLaw(value: unknown, asOfDate: string) {
  dateSchema.parse(asOfDate);
  const response = listSchema.parse(value).LawSearch;
  if (response.totalCnt > 100) throw new LegalSourceError(); // Never infer a version from a truncated history.
  return (
    (response.law ? array(response.law) : [])
      .filter((c) => c.법령명한글 === "민법" && c.시행일자 <= asOfDate)
      .sort((a, b) => b.시행일자.localeCompare(a.시행일자))[0] ?? null
  );
}
export async function parseOfficialDetail(
  value: unknown,
  candidate: z.infer<typeof candidateSchema>,
  numbers: readonly string[],
  asOfDate: string,
  verifiedAt: string,
) {
  const detail = detailSchema.parse(value).법령;
  timestampSchema.parse(verifiedAt);
  dateSchema.parse(asOfDate);
  if (
    detail.기본정보.법령ID !== candidate.법령ID ||
    detail.기본정보.법령명_한글 !== candidate.법령명한글 ||
    detail.기본정보.시행일자 !== candidate.시행일자 ||
    candidate.시행일자 > asOfDate
  )
    throw new LegalSourceError();
  const chunks = [];
  for (const article of array(detail.조문.조문단위).filter(
    (a) => a.조문여부 === "조문" && numbers.includes(a.조문번호) && !Number(a.조문가지번호 ?? 0),
  )) {
    if (article.조문시행일자 > asOfDate) throw new LegalSourceError();
    const text = [...array(article.조문내용), ...sectionText(article.항)].join("\n");
    const hash = await textHash(text);
    const citation = citationSchema.parse({
      id: `law_${hash}`,
      sourceId: `statute:${candidate.법령ID}:${article.조문시행일자}:${article.조문번호}:${hash}`,
      lawName: candidate.법령명한글,
      article: `제${article.조문번호}조`,
      effectiveDate: article.조문시행일자,
      verifiedAt,
      url: `https://law.go.kr/LSW/lsInfoP.do?lsiSeq=${candidate.법령일련번호}`,
      contentHash: hash,
    });
    chunks.push({ citation, text });
  }
  return chunks;
}
export function createLegalRetrieval(
  env: Pick<Env, "LAW_API_OC">,
  repo: Repo,
  transport: Transport = fetch,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  async function request(path: string, params: Record<string, string>) {
    if (!env.LAW_API_OC) throw new LegalSourceError();
    const url = new URL(`https://www.law.go.kr/DRF/${path}`);
    url.search = new URLSearchParams({
      OC: env.LAW_API_OC,
      target: "eflaw",
      type: "JSON",
      ...params,
    }).toString();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await transport(url.toString(), {
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 2) {
            await sleep(1000 * 2 ** attempt);
            continue;
          }
          throw new LegalSourceError();
        }
        if (!response.ok) throw new LegalSourceError();
        const raw = await response.text();
        if (new TextEncoder().encode(raw).length > 2 * 1024 * 1024) throw new LegalSourceError();
        return JSON.parse(raw) as unknown;
      } catch (error) {
        if (error instanceof LegalSourceError || error instanceof SyntaxError || attempt === 2)
          throw new LegalSourceError();
        await sleep(1000 * 2 ** attempt);
      }
    }
    throw new LegalSourceError();
  }
  return {
    async retrieve(concepts: unknown, asOfDate: string, now: string) {
      try {
        const selected = z.array(conceptSchema).min(1).max(3).parse(concepts);
        dateSchema.parse(asOfDate);
        timestampSchema.parse(now);
        const numbers = [...new Set(selected.flatMap((c) => [...articleNumbers[c]]))];
        const candidate = selectLaw(
          await request("lawSearch.do", {
            query: "민법",
            nw: "1,3",
            sort: "efdes",
            display: "100",
            efYd: `00010101~${asOfDate.replaceAll("-", "")}`,
          }),
          asOfDate,
        );
        if (!candidate) throw new LegalSourceError();
        const chunks = [];
        for (const number of numbers) {
          const cached = await repo.findLatestLegalSource(
            candidate.법령ID,
            `제${number}조`,
            asOfDate,
            now,
          );
          if (
            cached &&
            cached.sourceUrl === `https://law.go.kr/LSW/lsInfoP.do?lsiSeq=${candidate.법령일련번호}`
          ) {
            if ((await textHash(cached.body)) !== cached.contentHash) throw new LegalSourceError();
            chunks.push({
              citation: citationSchema.parse({
                id: `law_${cached.contentHash}`,
                sourceId: cached.sourceId,
                lawName: cached.lawName,
                article: cached.article,
                effectiveDate: cached.effectiveDate,
                verifiedAt: cached.fetchedAt,
                url: cached.sourceUrl,
                contentHash: cached.contentHash,
              }),
              text: cached.body,
            });
            continue;
          }
          const detail = await request("lawService.do", {
            MST: candidate.법령일련번호,
            efYd: candidate.시행일자.replaceAll("-", ""),
            JO: `${number.padStart(4, "0")}00`,
          });
          const parsed = await parseOfficialDetail(detail, candidate, [number], asOfDate, now);
          if (parsed.length !== 1) throw new LegalSourceError();
          for (const chunk of parsed) {
            await repo.putLegalSource(
              chunk.citation,
              chunk.text,
              now,
              new Date(Date.parse(now) + 86_400_000).toISOString(),
            );
            chunks.push(chunk);
          }
        }
        return retrievalOutputSchema.parse({
          schemaVersion: "1",
          asOfDate,
          chunks,
          retrievalHash: await textHash(JSON.stringify(chunks.map((c) => c.citation.sourceId))),
        });
      } catch {
        throw new LegalSourceError();
      }
    },
  };
}
