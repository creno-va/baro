import { fixture } from "../../scripts/benchmarks/retrieval/harness";
import { createCaseDataCipher } from "../../src/server/crypto";
import { createV2Core } from "../../src/server/db/v2-core";
import { readBoundSourceBatch } from "../../src/server/modules/legal-retrieval/v2/bound-sources";
import { createV2LegalRetrieval } from "../../src/server/modules/legal-retrieval/v2/service";
import type { Transport } from "../../src/server/modules/legal-retrieval/v2/transport";
import sample from "../fixtures/legal/analysis/scenarios.json";

/** Real SQLite/AES/source parser/binding; every upstream body is synthetic. */
export async function legalAnalysisFixture() {
  const f = await fixture(createV2LegalRetrieval);
  const core = createV2Core(
    f.binding,
    await createCaseDataCipher({ CASE_DATA_KEY_V1: btoa("b".repeat(32)).replace(/=+$/, "") }),
  );
  const calls: { target: string | null; detail: boolean; query: string | null }[] = [];
  const candidate = {
    판례일련번호: sample.precedent.officialId,
    사건명: sample.precedent.title,
    사건번호: sample.precedent.caseNumber,
    선고일자: sample.precedent.decisionDate.replaceAll("-", ""),
    법원명: sample.precedent.court,
    데이터출처명: "대법원",
  };
  const transport: Transport = async (address) => {
    const url = new URL(address);
    const detail = url.pathname.endsWith("lawService.do");
    const target = url.searchParams.get("target");
    calls.push({ target, detail, query: url.searchParams.get("query") });
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
  return {
    ...f,
    core,
    calls,
    transport,
    service: (override?: Transport, bind = true) =>
      createV2LegalRetrieval({ LAW_API_OC: "synthetic-only" }, f.repo, {
        transport: override ?? transport,
        sleep: async () => {},
        bindCitation: bind
          ? (citation) => f.repo.bindCitation(f.guard, citation)
          : async () => true,
      }),
    bound: (ids: readonly string[]) =>
      readBoundSourceBatch(core, f.guard.workspaceId, ids, f.guard.now, []),
  };
}
