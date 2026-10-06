import { dateSchema, displayText, timestampSchema } from "../../../../contracts";
import { v2OfficialCitationSchema } from "../../../../contracts/v2";
import type { OfficialSourceWrite } from "../../../db/v2-official-sources";
import { textHash } from "../service";
import {
  EXTRACTOR_VERSION,
  MAX_SOURCE_BYTES,
  RetrievalFailure,
  type SourceChunk,
} from "./contracts";
import { assertCanonicalUrl, GUIDE_HOSTS, guideUrl } from "./registry";

export async function makeChunk(
  input: Omit<OfficialSourceWrite, "sourceId" | "contentHash" | "extractorVersion" | "expiresAt">,
  asOfDate: string,
): Promise<SourceChunk> {
  const fetched = timestampSchema.safeParse(input.fetchedAt),
    verified = timestampSchema.safeParse(input.verifiedAt);
  if (
    !fetched.success ||
    !verified.success ||
    Date.parse(input.verifiedAt) < Date.parse(input.fetchedAt)
  )
    throw new RetrievalFailure("date_invalid");
  let canonical = false;
  try {
    if (input.sourceType === "statute")
      canonical =
        /^\d{1,12}$/.test(input.officialId) &&
        /^\d{1,12}$/.test(input.version) &&
        assertCanonicalUrl(
          input.canonicalUrl,
          `https://law.go.kr/LSW/lsInfoP.do?lsiSeq=${input.version}`,
        );
    else if (input.sourceType === "precedent")
      canonical =
        /^\d{1,12}$/.test(input.officialId) &&
        input.version === `decision_${input.sourceDate}` &&
        assertCanonicalUrl(
          input.canonicalUrl,
          `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${input.officialId}`,
        );
    else {
      const ids = /^guide_(\d{1,12})_(\d{1,12})_(\d{1,12})_(\d{1,12})$/.exec(input.officialId);
      if (ids)
        canonical =
          input.institutionId === "moleg_easylaw" &&
          input.endpointId === "easylaw_text_section" &&
          input.version === (input.sourceDate ?? "undated") &&
          assertCanonicalUrl(
            input.canonicalUrl,
            guideUrl({
              kind: "official_guide",
              institutionId: "moleg_easylaw",
              endpointId: "easylaw_text_section",
              csmSeq: ids[1] ?? "",
              ccfNo: ids[2] ?? "",
              cciNo: ids[3] ?? "",
              cnpClsNo: ids[4] ?? "",
            }).href,
          );
    }
  } catch {
    canonical = false;
  }
  if (!canonical) throw new RetrievalFailure("identity_mismatch");
  if (new TextEncoder().encode(input.body).byteLength > MAX_SOURCE_BYTES)
    throw new RetrievalFailure("too_large");
  if (
    !displayText(500).safeParse(input.title).success ||
    !input.body.trim() ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(input.body) ||
    /<\/?[a-z!][^>]*>/i.test(input.body)
  )
    throw new RetrievalFailure("schema_mismatch");
  if (
    input.sourceDate !== null &&
    (!dateSchema.safeParse(input.sourceDate).success || input.sourceDate > asOfDate)
  )
    throw new RetrievalFailure("date_invalid");
  const contentHash = await textHash(input.body);
  const identity = await textHash(
    JSON.stringify([
      input.sourceType,
      input.officialId,
      input.version,
      input.section,
      contentHash,
      EXTRACTOR_VERSION,
    ]),
  );
  const source: OfficialSourceWrite = {
    ...input,
    sourceId: `source_${identity}`,
    contentHash,
    extractorVersion: EXTRACTOR_VERSION,
    expiresAt: new Date(Date.parse(input.verifiedAt) + 86400000).toISOString(),
  };
  const base = {
    id: `cite_${crypto.randomUUID().replaceAll("-", "_")}`,
    sourceId: source.sourceId,
    title: source.title,
    verifiedAt: source.verifiedAt,
    contentHash,
    url: source.canonicalUrl,
  };
  const citation = v2OfficialCitationSchema(GUIDE_HOSTS).parse(
    source.sourceType === "statute"
      ? {
          ...base,
          kind: "statute",
          officialId: source.officialId,
          article: source.section,
          effectiveDate: source.sourceDate,
        }
      : source.sourceType === "precedent"
        ? {
            ...base,
            kind: "precedent",
            officialId: source.officialId,
            court: source.court,
            caseNumber: source.caseNumber,
            decisionDate: source.sourceDate,
          }
        : {
            ...base,
            kind: "official_guide",
            institutionId: source.institutionId,
            endpointId: source.endpointId,
            section: source.section,
            publishedDate: source.sourceDate,
          },
  );
  return {
    citation,
    source,
    span: { startUtf16: 0, endUtf16: source.body.length, text: source.body },
    applicability: "requires_review",
  };
}
