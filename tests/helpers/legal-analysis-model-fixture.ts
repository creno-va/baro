import { z } from "zod";
import { opaqueIdSchema } from "../../src/contracts";
import {
  analysisCaseFacts,
  canonicalAnalysisJson,
  type LegalAnalysisInput,
  legalAnalysisInputSchema,
} from "../../src/server/modules/legal-retrieval/analysis/context";
import {
  legalAnalysisOutputSchema,
  legalAnalysisPlanSchema,
} from "../../src/server/modules/llm-gateway/analysis-schema";

/** Fake external model outputs for the synthetic loan scenario only. Accept the
 * parsed native contents[0].parts[0].text.data, NOT an application result. No DB,
 * retrieval, audit approval, binding or final ready/partial status is fabricated. */
export function syntheticLegalPlan(raw: unknown, options: { many?: boolean } = {}) {
  const input = legalAnalysisInputSchema.strip().parse(raw);
  const facts = analysisCaseFacts(input).slice(0, 8);
  return legalAnalysisPlanSchema.parse({
    issues: facts.length
      ? [
          {
            id: "synthetic_loan_issue",
            title: "대여 약정의 자료 확인",
            factIds: facts.map((fact) => fact.id),
            requests: [
              {
                kind: "statute",
                lawTitle: "민법",
                articles: options.many
                  ? [
                      { number: "598", branch: "0" },
                      { number: "600", branch: "0" },
                    ]
                  : [{ number: "598", branch: "0" }],
              },
              ...(options.many
                ? [
                    {
                      kind: "statute",
                      lawTitle: "형법",
                      articles: [
                        { number: "1", branch: "0" },
                        { number: "2", branch: "0" },
                      ],
                    },
                  ]
                : []),
              { kind: "precedent", concept: "대여금" },
            ],
          },
        ]
      : [],
  });
}

const sourceInputSchema = z.object({
  plan: legalAnalysisPlanSchema,
  // The real workspace wire deliberately omits supplier officialId/proof bodies.
  citations: z.array(
    z.object({ id: opaqueIdSchema, kind: z.enum(["statute", "precedent", "official_guide"]) }),
  ),
  sourceTexts: z.array(
    z.object({
      citationId: opaqueIdSchema,
      text: z.string().min(1),
      startUtf16: z.number().int().nonnegative().default(0),
    }),
  ),
});
function boundedText(text: string, limit: number) {
  let end = Math.min(text.length, limit);
  if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end--;
  return text.slice(0, end);
}

export function syntheticLegalDraft(raw: unknown) {
  const input = legalAnalysisInputSchema.strip().parse(raw);
  const sources = sourceInputSchema.parse(raw);
  const facts = analysisCaseFacts(input);
  const known = new Map(facts.map((fact) => [fact.id, fact]));
  const law = sources.citations.find((citation) => citation.kind === "statute");
  const precedent = sources.citations.find((citation) => citation.kind === "precedent");
  if (!law || !precedent || !sources.plan.issues.length || !facts.length)
    throw new Error("MISSING_SYNTHETIC_LEGAL_CONTEXT");
  if (sources.plan.issues.some((issue) => issue.factIds.some((id) => !known.has(id))))
    throw new Error("UNKNOWN_SYNTHETIC_FACT");
  const quote = (citationId: string, id: string) => {
    const matches = sources.sourceTexts.filter((source) => source.citationId === citationId);
    if (matches.length !== 1 || !matches[0]) throw new Error("MISSING_SYNTHETIC_SOURCE_TEXT");
    const source = matches[0];
    const text = boundedText(source.text, 10000);
    return {
      id,
      kind: "quotation" as const,
      citationId,
      text,
      startUtf16: source.startUtf16,
      endUtf16: source.startUtf16 + text.length,
    };
  };
  const sourceClaims = [
    quote(law.id, "synthetic_law_claim"),
    quote(precedent.id, "synthetic_precedent_claim"),
  ];
  const evidence = [
    ...new Map(
      [
        ...input.materials.map((material) => material.reference),
        ...facts.flatMap((fact) =>
          fact.references.filter(
            (reference): reference is LegalAnalysisInput["materials"][number]["reference"] =>
              reference.kind === "user_material",
          ),
        ),
      ]
        .filter(
          (reference) =>
            !input.scope.excludedFileIds.includes(reference.fileId) &&
            input.includedEvidence.some(
              (file) =>
                file.fileId === reference.fileId && file.fileRevision === reference.fileRevision,
            ),
        )
        .map((reference) => [canonicalAnalysisJson(reference), structuredClone(reference)]),
    ).values(),
  ].slice(0, 100);
  const selected = sources.plan.issues[0]?.factIds ?? [];
  const caseText = boundedText(known.get(selected[0] ?? "")?.text ?? "현재 제공된 사건 설명", 250);
  const conflicts = [
    ...new Set(facts.flatMap((fact) => fact.conflictingFactIds).filter((id) => known.has(id))),
  ];
  const purpose = input.context.casePurpose;
  return legalAnalysisOutputSchema.parse({
    issues: sources.plan.issues.map((issue, index) => ({
      id: issue.id,
      title: issue.title,
      requirements: [
        {
          id: `synthetic_requirement_${index}`,
          label: `합성 약정 확인 요건과 현재 설명을 연결합니다: ${caseText}. 진술과 자료 관찰은 독립 증명·진정성 확인과 구분하고 원본을 확인해야 합니다.`,
          assessment: "insufficient",
          sourceClaimIds: ["synthetic_law_claim"],
          factIds: issue.factIds,
          conflictingFactIds: conflicts,
          evidence,
          gaps: ["약정·지급·변제 설명과 원본 자료의 대응 및 자료의 진정성 확인"],
        },
      ],
    })),
    precedents: [
      {
        citationId: precedent.id,
        commonalities: [
          {
            text: `합성 판례의 약정·지급 자료 확인 쟁점과 비교할 현재 설명: ${caseText}`,
            factIds: selected,
            sourceClaimIds: ["synthetic_precedent_claim"],
          },
        ],
        differences: [
          {
            text: "합성 판례에 제출된 자료와 이번에 포함된 자료의 기록 방식·원본·변제 범위가 같은지는 확인되지 않았습니다.",
            factIds: selected,
            sourceClaimIds: ["synthetic_precedent_claim"],
          },
        ],
        preparationMeaning:
          "현재 진술과 포함된 자료 위치에 대응하는 원본 및 반환 내역을 구분해 보완합니다.",
      },
    ],
    perspective: {
      casePurpose: purpose,
      weaknesses: [
        purpose === "respond_to_claim"
          ? "상대 주장에 대한 현재 설명과 자료의 불일치·반박 근거를 확인해야 합니다."
          : purpose === "prepare_claim"
            ? "현재 주장의 약정·지급·변제 설명에 대응하는 원본과 입증의 빈틈을 확인해야 합니다."
            : "입장 확정 전에는 현재 설명과 자료의 범위·미확인 부분을 구분해야 합니다.",
      ],
      claimGaps:
        purpose === "prepare_claim"
          ? ["청구 주장의 약정 내용·교부·이미 반환된 금액을 구분해 입증할 자료"]
          : [],
      responsePoints:
        purpose === "respond_to_claim"
          ? [
              {
                opponentPosition:
                  "상대방 주장으로 확인된 내용과 아직 확인되지 않은 부분을 구분해야 합니다.",
                ourExplanation: `현재 제공된 설명: ${caseText}`,
                conflictingFactIds: conflicts,
                sourceClaimIds: ["synthetic_law_claim", "synthetic_precedent_claim"],
                additionalMaterials: ["우리 설명·반박에 대응하는 원본 자료와 반환 내역"],
              },
            ]
          : [],
      additionalMaterials:
        purpose === "unconfirmed"
          ? ["청구 준비인지 상대 주장 대응인지 확인"]
          : ["전체 대화·지급·변제 원본 자료"],
    },
    evidenceRequirements: evidence.length
      ? [
          {
            id: "synthetic_evidence_requirement",
            kind: "other",
            label: "포함 자료의 원본 확인",
            reason:
              "현재 자료 위치의 관찰·사용자 교정과 독립 증명 및 진정성 확인은 구분해야 합니다.",
            fileIds: [...new Set(evidence.map((reference) => reference.fileId))],
          },
        ]
      : [],
    sourceClaims,
    limitations: [
      "합성 공식 원문과 외부 모델 대역을 이용한 연결 검증이며 실제 법률 API·모델 품질 인수가 아닙니다.",
    ],
  });
}
