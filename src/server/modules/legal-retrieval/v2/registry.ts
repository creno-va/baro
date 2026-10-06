import { RetrievalFailure, type RetrievalPlan } from "./contracts";

// Technical source admission, not a legal applicability/publication approval.
export const OFFICIAL_CATALOG = [
  {
    id: "moleg_eflaw",
    type: "statute",
    host: "www.law.go.kr",
    paths: ["/DRF/lawSearch.do", "/DRF/lawService.do"],
    documentation: "https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdInfoGuide",
    rights: "Official MOLEG open-data API; per-service application/activation must be verified",
  },
  {
    id: "moleg_prec",
    type: "precedent",
    host: "www.law.go.kr",
    paths: ["/DRF/lawSearch.do", "/DRF/lawService.do"],
    documentation: "https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=precInfoGuide",
    rights: "Official MOLEG precedent API; HTML-only data and activation remain separate",
  },
  {
    id: "moleg_easylaw",
    type: "official_guide",
    host: "www.easylaw.go.kr",
    paths: ["/CSP/CnpClsMain.laf"],
    documentation: "https://easylaw.go.kr/CSP/InfoCopyright.laf",
    rights:
      "MOLEG EasyLaw information permits commercial use except third-party works; text-only attributed extraction, no image/download reuse",
  },
] as const;
export const GUIDE_HOSTS = ["www.easylaw.go.kr", "easylaw.go.kr"] as const;
export const DISABLED_CATALOG = [
  { id: "klac_summary_candidate", reason: "rights_unverified" },
  { id: "scourt_help_candidate", reason: "unsupported_format" },
] as const;
export function guideUrl(plan: Extract<RetrievalPlan, { kind: "official_guide" }>) {
  const url = new URL("https://www.easylaw.go.kr/CSP/CnpClsMain.laf");
  for (const key of ["csmSeq", "ccfNo", "cciNo", "cnpClsNo"] as const)
    url.searchParams.set(key, plan[key]);
  return url;
}
export function assertOfficialUrl(value: string, guide = false) {
  const url = new URL(value);
  const legal =
    url.hostname === "www.law.go.kr" &&
    ["/DRF/lawSearch.do", "/DRF/lawService.do"].includes(url.pathname);
  const allowedGuide =
    GUIDE_HOSTS.includes(url.hostname as (typeof GUIDE_HOSTS)[number]) &&
    url.pathname === "/CSP/CnpClsMain.laf";
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !(guide ? allowedGuide : legal)
  )
    throw new RetrievalFailure("unsafe_url");
  const allowed = guide
    ? ["csmSeq", "ccfNo", "cciNo", "cnpClsNo"]
    : url.searchParams.get("target") === "eflaw"
      ? url.pathname.endsWith("lawSearch.do")
        ? ["OC", "target", "type", "query", "LID", "nw", "sort", "display", "page", "efYd"]
        : ["OC", "target", "type", "MST", "efYd", "JO"]
      : url.pathname.endsWith("lawSearch.do")
        ? ["OC", "target", "type", "query", "search", "display", "page", "sort", "prncYd"]
        : ["OC", "target", "type", "ID"];
  for (const key of url.searchParams.keys())
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1)
      throw new RetrievalFailure("unsafe_url");
  if (
    !guide &&
    (!["eflaw", "prec"].includes(url.searchParams.get("target") ?? "") ||
      url.searchParams.get("type") !== "JSON")
  )
    throw new RetrievalFailure("unsafe_url");
  if (guide && allowed.some((key) => !/^\d{1,12}$/.test(url.searchParams.get(key) ?? "")))
    throw new RetrievalFailure("unsafe_url");
  return url;
}
export function assertCanonicalUrl(value: string, expected: string) {
  const a = new URL(value),
    b = new URL(expected);
  if (
    a.protocol !== "https:" ||
    a.username ||
    a.password ||
    a.port ||
    a.hash ||
    a.hostname !== b.hostname ||
    a.pathname !== b.pathname
  )
    return false;
  const entries = [...a.searchParams].sort(([a], [b]) => a.localeCompare(b));
  const desired = [...b.searchParams].sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries) === JSON.stringify(desired);
}
