// Synthetic judgments exist only in the explicit PUBLIC_API_MODE=mock bundle.

import {
  type V2PrecedentSearchResponse,
  v2PrecedentReadRequestSchema,
  v2PrecedentSearchRequestSchema,
} from "../../../contracts/v2/precedent-research";
import { ApiError } from "../errors";
import type { CaseView } from "../types";
import { readStore, registerMockHandlers, requireSession } from "./runtime";

const documents = new Map<
  string,
  {
    owner: string;
    id: string;
    revision: number;
    expires: number;
    item: V2PrecedentSearchResponse["items"][number];
  }
>();
function scope(id: string, revision?: number) {
  const owner = requireSession().user;
  const item = readStore<Record<string, CaseView>>("cases", {})[id];
  if (
    owner?.accountType !== "customer" ||
    readStore<Record<string, string>>("caseOwners", {})[id] !== owner.id ||
    !item ||
    readStore<string[]>("deletedCaseIds", []).includes(id)
  )
    throw new ApiError("NOT_FOUND", "사건을 다시 확인해 주세요.");
  if (
    item.stage !== "active" ||
    !item.summaryDetails ||
    (revision !== undefined && item.revision !== revision)
  )
    throw new ApiError("CONFLICT", "최신 사건 요약을 확인해 주세요.");
  return { owner: owner.id, item };
}
const excerpt = (text: string) => ({
  text,
  startUtf16: 0,
  endUtf16: text.length,
  fullLengthUtf16: text.length,
  truncated: false,
});
registerMockHandlers({
  "precedents.context": ({ id }: { id: string }) => {
    const { item } = scope(id);
    return {
      schemaVersion: "2",
      workspaceRevision: item.revision,
      summaryRevision: item.summaryDetails?.revision,
      caseTitle: item.title,
      recommendedTopics: ["lease", "contract"],
    };
  },
  "precedents.search": ({ id, body }: { id: string; body: unknown }) => {
    const input = v2PrecedentSearchRequestSchema.parse(body);
    const { owner, item } = scope(id, input.expectedRevision);
    if (item.summaryDetails?.revision !== input.summaryRevision)
      throw new ApiError("CONFLICT", "최신 사건 요약을 확인해 주세요.");
    const checkedAt = new Date().toISOString();
    const items = input.topics.map((topic, index) => {
      const officialId = String(90000000201 + index);
      const citation = {
        id: `synthetic-research-citation-${index}`,
        kind: "precedent" as const,
        sourceId: `synthetic-research-source-${index}`,
        contentHash: "a".repeat(64),
        title: "합성 검증 판례 · 임대차보증금 반환",
        url: `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${officialId}`,
        officialId,
        court: "대법원",
        caseNumber: `2026다${900001 + index}`,
        decisionDate: "2026-09-01",
        verifiedAt: checkedAt,
      };
      const value = {
        id: citation.id,
        citation,
        matchedTopics: [topic],
        excerpt: excerpt(
          "브라우저 검증용 합성 판례입니다. 실제 재판이나 법률 판단을 나타내지 않습니다. 임대차 계약 종료 후 보증금 반환에 관한 원문 표시와 사용자 접근 통제를 검증합니다.",
        ),
        readToken: `synthetic_research_receipt.${crypto.randomUUID().replaceAll("-", "_")}`,
      };
      documents.set(value.readToken, {
        owner,
        id,
        revision: input.expectedRevision,
        expires: Date.now() + 600000,
        item: value,
      });
      if (documents.size > 30) documents.delete(documents.keys().next().value ?? "");
      return value;
    });
    return {
      schemaVersion: "2",
      workspaceRevision: item.revision,
      summaryRevision: input.summaryRevision,
      checkedAt,
      topics: input.topics,
      status: "complete",
      searchTruncated: true,
      items,
      unavailableTopics: [],
    };
  },
  "precedents.read": ({ id, body }: { id: string; body: unknown }) => {
    const input = v2PrecedentReadRequestSchema.parse(body);
    const { owner } = scope(id, input.expectedRevision);
    const found = documents.get(input.readToken);
    if (
      !found ||
      found.owner !== owner ||
      found.id !== id ||
      found.revision !== input.expectedRevision ||
      found.expires <= Date.now()
    )
      throw new ApiError("NOT_FOUND", "다시 검색해 주세요.");
    const item = found.item;
    return {
      schemaVersion: "2",
      workspaceRevision: input.expectedRevision,
      citation: item.citation,
      excerpt: item.excerpt,
    };
  },
});
