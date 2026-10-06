import { dateSchema } from "../../../../contracts";
import { RetrievalFailure, type RetrievalPlan } from "./contracts";
import { GUIDE_HOSTS, guideUrl, OFFICIAL_CATALOG } from "./registry";
import { makeChunk } from "./source";
import { containerText, plainText, titleText, visibleTokens } from "./text";

export async function parseGuide(
  html: string,
  plan: Extract<RetrievalPlan, { kind: "official_guide" }>,
  asOfDate: string,
  now: string,
) {
  const canonical = [...visibleTokens(html)].filter(
    (token) =>
      token.type === "tag" && token.name === "link" && token.attributes.rel === "canonical",
  );
  if (canonical.length !== 1 || canonical[0]?.type !== "tag")
    throw new RetrievalFailure("identity_mismatch");
  const url = new URL(canonical[0].attributes.href ?? "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !GUIDE_HOSTS.includes(url.hostname as (typeof GUIDE_HOSTS)[number]) ||
    url.pathname !== "/CSP/CnpClsMain.laf" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new RetrievalFailure("unsafe_url");
  for (const key of ["csmSeq", "ccfNo", "cciNo", "cnpClsNo"] as const)
    if (url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== plan[key])
      throw new RetrievalFailure("identity_mismatch");
  for (const [key, value] of url.searchParams)
    if (
      !["csmSeq", "ccfNo", "cciNo", "cnpClsNo"].includes(key) &&
      !(key === "popMenu" && value === "ov") &&
      !(key === "menuType" && value === "cnpcls")
    )
      throw new RetrievalFailure("unsafe_url");
  const body = containerText(html, "ovDiv");
  const title = titleText(html).replace(/\s*\|\s*찾기쉬운 생활법령정보\s*$/, "");
  const dates = [
    ...plainText(html).matchAll(
      /이 정보는\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*기준으로 작성된 것입니다/g,
    ),
  ];
  if (dates.length > 1) throw new RetrievalFailure("date_invalid");
  const date = dates[0]
    ? `${dates[0][1]}-${dates[0][2]?.padStart(2, "0")}-${dates[0][3]?.padStart(2, "0")}`
    : null;
  if (date && !dateSchema.safeParse(date).success) throw new RetrievalFailure("date_invalid");
  const pending = /향후\s*업데이트\s*예정/.test(plainText(html));
  const chunk = await makeChunk(
    {
      sourceType: "official_guide",
      officialId: `guide_${plan.csmSeq}_${plan.ccfNo}_${plan.cciNo}_${plan.cnpClsNo}`,
      version: date ?? "undated",
      section: title.slice(0, 300),
      canonicalUrl: guideUrl(plan).href,
      title,
      body: body.text,
      sourceDate: date,
      fetchedAt: now,
      verifiedAt: now,
      rightsProvenance: OFFICIAL_CATALOG[2].rights,
      institutionId: plan.institutionId,
      endpointId: plan.endpointId,
      court: null,
      caseNumber: null,
    },
    asOfDate,
  );
  return {
    chunk,
    reason: pending
      ? ("update_pending" as const)
      : date === null
        ? ("unknown_publication_date" as const)
        : body.images
          ? ("image_omitted" as const)
          : null,
  };
}
