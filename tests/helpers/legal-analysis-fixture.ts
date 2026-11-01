import type { Transport } from "../../src/server/modules/legal-retrieval/v2/transport";
import sample from "../fixtures/legal/analysis/scenarios.json";

export type SyntheticLegalRequest = {
  target: string | null;
  detail: boolean;
  query: string | null;
};

/** External responses only: no DB, network, clock, binding or result-status mock.
 * ready means valid synthetic response shapes, not accepted legal conclusions.
 * empty has no law/precedent rows and no readable guide body; real parsers decide
 * no_results vs invalid/absent originals. Never relabel failures as verification. */
export function createSyntheticLegalTransport(
  options: {
    onRequest?: (request: SyntheticLegalRequest) => void;
    mode?: "ready" | "empty" | "failure";
  } = {},
): Transport {
  const candidate = {
    판례일련번호: sample.precedent.officialId,
    사건명: sample.precedent.title,
    사건번호: sample.precedent.caseNumber,
    선고일자: sample.precedent.decisionDate.replaceAll("-", ""),
    법원명: sample.precedent.court,
    데이터출처명: "대법원",
  };
  return async (address) => {
    const url = new URL(address);
    const detail = url.pathname.endsWith("lawService.do");
    const target = url.searchParams.get("target");
    options.onRequest?.({ target, detail, query: url.searchParams.get("query") });
    if (options.mode === "failure") return new Response("", { status: 503 });
    if (url.hostname === "www.easylaw.go.kr" || url.hostname === "easylaw.go.kr") {
      const canonical = url.href.replaceAll("&", "&amp;");
      return new Response(
        `<title>합성 절차 안내 | 찾기쉬운 생활법령정보</title>
<link rel="canonical" href="${canonical}">
<div id="ovDiv">${options.mode === "empty" ? "" : "합성 공식 절차 안내. 실제 제출처·법률 정보가 아닙니다."}</div>
<strong>이 정보는 2026년 9월 30일 기준으로 작성된 것입니다.</strong>`,
        { headers: { "content-type": "text/html" } },
      );
    }
    if (
      url.hostname !== "www.law.go.kr" ||
      !["eflaw", "prec"].includes(target ?? "") ||
      !["/DRF/lawSearch.do", "/DRF/lawService.do"].includes(url.pathname)
    )
      throw new Error("SYNTHETIC_LEGAL_UNHANDLED_REQUEST");
    if (options.mode === "empty")
      return Response.json(
        target === "prec"
          ? { PrecSearch: { totalCnt: "0", prec: [] } }
          : { LawSearch: { totalCnt: "0", law: [] } },
      );
    return Response.json(
      target === "prec"
        ? detail
          ? {
              PrecService: {
                ...candidate,
                판례정보일련번호: sample.precedent.officialId,
                판례내용: sample.precedent.body,
              },
            }
          : { PrecSearch: { totalCnt: "1", prec: [candidate] } }
        : detail
          ? {
              법령: {
                기본정보: {
                  법령ID: "1706",
                  법령명_한글: sample.law.title,
                  시행일자: "20260317",
                  공포일자: "20260317",
                  공포번호: "21454",
                },
                조문: {
                  조문단위: {
                    조문번호: sample.law.article,
                    조문가지번호: "0",
                    조문여부: "조문",
                    조문시행일자: "20260317",
                    조문내용: sample.law.body,
                  },
                },
              },
            }
          : {
              LawSearch: {
                totalCnt: "1",
                law: [
                  {
                    법령ID: "1706",
                    법령일련번호: "284415",
                    법령명한글: sample.law.title,
                    시행일자: "20260317",
                    공포일자: "20260317",
                    공포번호: "21454",
                  },
                ],
              },
            },
    );
  };
}

/** Real SQLite/AES/source parser/binding; every upstream body is synthetic. */
export async function legalAnalysisFixture() {
  // Pure external-adapter consumers never initialize or import a DB harness.
  const [
    { fixture },
    { createCaseDataCipher },
    { createV2Core },
    { readBoundSourceBatch },
    { createV2LegalRetrieval },
  ] = await Promise.all([
    import("../../scripts/benchmarks/retrieval/harness"),
    import("../../src/server/crypto"),
    import("../../src/server/db/v2-core"),
    import("../../src/server/modules/legal-retrieval/v2/bound-sources"),
    import("../../src/server/modules/legal-retrieval/v2/service"),
  ]);
  const f = await fixture(createV2LegalRetrieval);
  const core = createV2Core(
    f.binding,
    await createCaseDataCipher({ CASE_DATA_KEY_V1: btoa("b".repeat(32)).replace(/=+$/, "") }),
  );
  const calls: SyntheticLegalRequest[] = [];
  const transport = createSyntheticLegalTransport({ onRequest: (request) => calls.push(request) });
  return {
    ...f,
    core,
    calls,
    transport,
    service: (
      override?: Transport,
      bind = true,
      precedentDiscovery?: Parameters<typeof createV2LegalRetrieval>[2]["precedentDiscovery"],
    ) =>
      createV2LegalRetrieval({ LAW_API_OC: "synthetic-only" }, f.repo, {
        transport: override ?? transport,
        sleep: async () => {},
        ...(precedentDiscovery ? { precedentDiscovery } : {}),
        bindCitation: bind
          ? (citation) => f.repo.bindCitation(f.guard, citation)
          : async () => true,
      }),
    bound: (ids: readonly string[]) =>
      readBoundSourceBatch(core, f.guard.workspaceId, ids, f.guard.now, []),
  };
}
