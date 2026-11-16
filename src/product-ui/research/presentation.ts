import { ApiError } from "../../client/api/errors";
import type { V2LookupRequest } from "../../contracts/v2";

export const isAccessError = (error: unknown) =>
  error instanceof ApiError && ["UNAUTHENTICATED", "CONSENT_REQUIRED"].includes(error.code);

export type Tool = V2LookupRequest["tool"];
export const recipients = {
  hometax_status: "국세청",
  thecheat: "더치트",
  datahub_property: "데이터허브",
  datahub_building: "데이터허브",
} as const;
export const fields = {
  hometax_status: [["businessNumber", "사업자등록번호", 10]],
  thecheat: [
    ["keyword", "조회할 전화번호 또는 계좌번호", 20],
    ["bankCode", "은행 코드 (선택, 숫자 3자리)", 3],
  ],
  datahub_property: [["address", "조회할 주소", 200]],
  datahub_building: [
    ["INNB", "대지 고유번호 (INNB)", 19],
    ["RNMGTSN", "도로명 코드 (RNMGTSN)", 12],
    ["BULDMNNM", "건물 본번 (BULDMNNM)", 5],
    ["BULDSLNO", "건물 부번 (BULDSLNO)", 5],
  ],
} as const;
