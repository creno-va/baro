import type { V2LookupToolId } from "../../../contracts/v2";

export const lookupTools = {
  hometax_status: {
    title: "국세청 사업자 상태 조회",
    sourceUrl: "https://www.data.go.kr/data/15081808/openapi.do",
    description: "사업자등록 상태·과세 유형. 개인의 납세/체납 내역 조회가 아닙니다.",
  },
  thecheat: {
    title: "더치트 피해 등록 조회",
    sourceUrl: "https://apicenter.thecheat.co.kr/",
    description: "동의한 연락처/계좌의 제공 기간 내 피해 등록 여부. 사기 확정 판단이 아닙니다.",
  },
  registry: {
    title: "등기정보광장 조회",
    sourceUrl: "https://data.iros.go.kr/",
    description: "서비스별 승인된 등기 현황 정보. 개별 등기부등본이나 소유권 증명이 아닙니다.",
  },
  datahub_property: {
    title: "데이터허브 부동산 주소 조회",
    sourceUrl: "https://dataapi.co.kr/",
    description: "입력한 주소의 등기 대상 후보. 모호한 주소는 사용자가 후보를 확인해야 합니다.",
  },
  datahub_building: {
    title: "데이터허브 건축물대장 조회",
    sourceUrl: "https://dataapi.co.kr/",
    description: "주소 검색에서 확인한 식별자로 총괄표제부를 조회합니다.",
  },
} as const satisfies Record<
  V2LookupToolId,
  { title: string; sourceUrl: string; description: string }
>;

export interface LookupConfiguration {
  hometaxKey?: string;
  thecheatKey?: string;
  thecheatEncryptionKey?: string;
  datahubToken?: string;
}
export function lookupConfiguration(env: Env): LookupConfiguration {
  return {
    ...(env.HOMETAX_SERVICE_KEY ? { hometaxKey: env.HOMETAX_SERVICE_KEY } : {}),
    ...(env.THECHEAT_API_KEY ? { thecheatKey: env.THECHEAT_API_KEY } : {}),
    ...(env.THECHEAT_ENCRYPTION_KEY ? { thecheatEncryptionKey: env.THECHEAT_ENCRYPTION_KEY } : {}),
    ...(env.DATAHUB_API_TOKEN ? { datahubToken: env.DATAHUB_API_TOKEN } : {}),
  };
}
export function lookupCatalog(configuration: LookupConfiguration) {
  return Object.entries(lookupTools).map(([tool, value]) => ({
    tool: tool as V2LookupToolId,
    ...value,
    status:
      tool === "registry"
        ? ("not_configured" as const)
        : (
              tool === "hometax_status"
                ? configuration.hometaxKey?.trim()
                : tool === "thecheat"
                  ? configuration.thecheatKey?.trim() && configuration.thecheatEncryptionKey?.trim()
                  : configuration.datahubToken?.trim()
            )
          ? ("input_required" as const)
          : ("not_configured" as const),
  }));
}
