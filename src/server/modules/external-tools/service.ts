import { z } from "zod";
import {
  type V2LookupToolId,
  type V2ToolResult,
  v2LookupToolIdSchema,
  v2ToolResultSchema,
} from "../../../contracts/v2";
import { reportDependencyFailure } from "../../dependency-diagnostics";
import { type LookupConfiguration, lookupCatalog, lookupTools } from "./catalog";
import { type LookupFetch, lookupJson } from "./transport";

const digits = (maximum: number) => z.string().regex(/^\d+$/).max(maximum);
const targets = {
  hometax_status: z.strictObject({ businessNumber: z.string().regex(/^\d{10}$/) }),
  thecheat: z.strictObject({
    kind: z.enum(["phone", "account"]),
    keyword: digits(20).min(8),
    bankCode: z
      .string()
      .regex(/^\d{3}$/)
      .optional(),
  }),
  datahub_property: z.strictObject({ address: z.string().trim().min(5).max(200) }),
  datahub_building: z.strictObject({
    INNB: digits(19),
    RNMGTSN: digits(12),
    BULDMNNM: digits(5),
    BULDSLNO: digits(5),
  }),
};
export interface LookupAccess {
  /** Trusted owner/case/revision and explicit recipient/target-consent closure.
   * Never accept an authorize boolean from the model or an HTTP request body. */
  authorize: () => Promise<boolean>;
  /** Durable per-job execution claim; an unknown/replayed claim cannot dispatch. */
  reserve: (tool: V2LookupToolId) => Promise<boolean>;
  observeTransport?: (
    transport: "response" | "provider_error" | "unknown" | "not_sent",
  ) => Promise<void>;
  signal: AbortSignal;
}
const field = z.union([z.string().max(1000), z.number().finite()]);
const datahubEnvelope = z.object({
  result: z.literal("SUCCESS"),
  errCode: z.literal("0000"),
  data: z.record(z.string(), z.unknown()),
});
const chequeEnvelope = z.object({
  result_code: z.number().int(),
  result_msg: z.string().max(100),
  content: z.string().max(128 * 1024),
});

async function decryptCheat(content: string, secret: string): Promise<unknown> {
  const key = new TextEncoder().encode(secret);
  if (key.byteLength !== 32) throw new Error("LOOKUP_UNAVAILABLE");
  const bytes = Uint8Array.from(atob(content), (character) => character.charCodeAt(0));
  if (bytes.length < 32 || bytes.length % 16) throw new Error("LOOKUP_UNAVAILABLE");
  const imported = await crypto.subtle.importKey("raw", key, "AES-CBC", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: bytes.subarray(0, 16) },
    imported,
    bytes.subarray(16),
  );
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain));
}

/** Read-only lookup adapters. Models select a registered tool and a server-owned
 * target; neither provider credentials nor arbitrary endpoints are tool arguments.
 * No automatic HTTP retry, redirect, registration, payment or consent fabrication. */
export function createExternalTools(
  configuration: LookupConfiguration,
  options: { fetch?: LookupFetch; clock?: () => string } = {},
) {
  const baseNetwork = options.fetch ?? fetch;
  const clock = options.clock ?? (() => new Date().toISOString());
  let attempts = 0;
  return {
    catalog: () => lookupCatalog(configuration),
    async execute(
      rawTool: V2LookupToolId,
      rawTarget: unknown,
      access: LookupAccess,
    ): Promise<V2ToolResult> {
      const tool = v2LookupToolIdSchema.parse(rawTool);
      const definition = lookupTools[tool];
      const observe = async (transport: "response" | "provider_error" | "unknown" | "not_sent") => {
        try {
          await access.observeTransport?.(transport);
        } catch (error) {
          reportDependencyFailure(error);
        }
      };
      const network: LookupFetch = async (url, init) => {
        let response: Response;
        try {
          response = await baseNetwork(url, init);
        } catch (error) {
          await observe("unknown");
          throw error;
        }
        await observe(response.ok ? "response" : "provider_error");
        return response;
      };
      const result = (
        status: V2ToolResult["status"],
        notices: string[],
        rows: V2ToolResult["rows"] = [],
        observedAt: string | null = null,
      ) =>
        v2ToolResultSchema.parse({
          id: crypto.randomUUID(),
          tool,
          title: definition.title,
          sourceUrl: definition.sourceUrl,
          status,
          rows,
          notices,
          observedAt,
        });
      if (access.signal.aborted || !(await access.authorize()))
        return result("access_denied", ["이 사건의 조회 권한이나 동의를 다시 확인해 주세요."]);
      if (
        lookupCatalog(configuration).find((item) => item.tool === tool)?.status === "not_configured"
      )
        return result("not_configured", [
          tool === "registry"
            ? "등기정보광장 조회 서비스가 아직 연결되지 않았어요. 등기부등본을 조회한 상태가 아니에요."
            : "이 조회 서비스가 아직 연결되지 않아 실제 정보를 확인하지 못했어요.",
        ]);
      if (tool === "registry")
        return result("not_configured", ["서비스별 API 명세를 먼저 연결해 주세요."]);
      if (rawTarget === null || rawTarget === undefined)
        return result("input_required", [
          "조회할 대상을 별도 입력하고 해당 외부 서비스 전송에 동의해 주세요. 채팅에서 인증정보를 입력하지 마세요.",
        ]);
      const target = targets[tool].safeParse(rawTarget);
      if (!target.success)
        return result("input_required", ["조회 대상의 입력 형식을 확인해 주세요."]);
      if (attempts >= 2 || access.signal.aborted)
        return result("unavailable", [
          "이번 요청의 조회를 시작하지 못했어요. 앞선 조회 기록은 유지돼요.",
        ]);
      attempts++;
      if (!(await access.authorize()) || !(await access.reserve(tool)))
        return result("unavailable", [
          "이번 요청의 조회를 시작하지 못했어요. 앞선 조회 기록은 유지돼요.",
        ]);
      if (access.signal.aborted || !(await access.authorize())) {
        await observe("not_sent");
        return result("access_denied", ["조회 전 권한이나 동의가 바뀌어 전송하지 않았어요."]);
      }
      try {
        let raw: unknown;
        if (tool === "hometax_status") {
          const input = targets.hometax_status.parse(target.data);
          const url = new URL("https://api.odcloud.kr/api/nts-businessman/v1/status");
          url.searchParams.set("serviceKey", configuration.hometaxKey ?? "");
          raw = await lookupJson(network, url, { b_no: [input.businessNumber] }, {}, access.signal);
          const output = z
            .object({
              status_code: z.literal("OK"),
              request_cnt: z.literal(1),
              match_cnt: z.number().int().min(0).max(1),
              data: z
                .array(
                  z.object({
                    b_no: z.literal(input.businessNumber),
                    b_stt: z.string().max(100),
                    b_stt_cd: z.enum(["", "01", "02", "03"]),
                    tax_type: z.string().max(300),
                    end_dt: z.string().regex(/^(?:\d{8})?$/),
                  }),
                )
                .length(1),
            })
            .parse(raw);
          if (!(await access.authorize()) || access.signal.aborted)
            return result("access_denied", [
              "조회 중 권한이나 동의가 바뀌어 결과를 표시하지 않았어요.",
            ]);
          const value = output.data[0];
          if (!value) throw new Error("LOOKUP_UNAVAILABLE");
          if (!output.match_cnt && !value.b_stt_cd)
            return result(
              "no_record",
              [
                "이 조회에서 사업자 상태를 확인하지 못했어요. 신규 등록과 원천 갱신 지연은 별도로 확인해 주세요.",
              ],
              [],
              clock(),
            );
          if (!output.match_cnt || !value.b_stt_cd || !value.b_stt)
            throw new Error("LOOKUP_UNAVAILABLE");
          return result(
            "retrieved",
            ["국세청 사업자 상태 조회이며 체납·신용·거래 안전을 확인한 결과가 아니에요."],
            [
              { label: "사업자 상태", value: value.b_stt },
              { label: "과세 유형", value: value.tax_type },
              ...(value.end_dt ? [{ label: "폐업일(원천 YYYYMMDD)", value: value.end_dt }] : []),
            ],
            clock(),
          );
        }
        if (tool === "thecheat") {
          const input = targets.thecheat.parse(target.data);
          raw = await lookupJson(
            network,
            new URL("https://api.thecheat.co.kr/api/v2/fraud/search"),
            {
              keyword_type: input.kind,
              keyword: input.keyword,
              ...(input.bankCode ? { bank_code: input.bankCode } : {}),
            },
            { "X-TheCheat-ApiKey": configuration.thecheatKey ?? "" },
            access.signal,
          );
          const output = chequeEnvelope.parse(raw);
          if (!(await access.authorize()) || access.signal.aborted)
            return result("access_denied", [
              "조회 중 권한이나 동의가 바뀌어 결과를 표시하지 않았어요.",
            ]);
          if (output.result_code !== 1) throw new Error("LOOKUP_UNAVAILABLE");
          if (output.result_msg === "success (test)")
            return result(
              "test_data",
              ["더치트가 테스트 응답을 반환했어요. 실제 피해 등록 조회로 사용할 수 없어요."],
              [],
              clock(),
            );
          if (output.result_msg !== "success") throw new Error("LOOKUP_UNAVAILABLE");
          const data = z
            .object({
              keyword: z.literal(input.keyword),
              keyword_type: z.literal(input.kind),
              caution: z.enum(["Y", "N"]),
              date_start: z.string().regex(/^\d{14}$/),
              date_end: z.string().regex(/^\d{14}$/),
              bank_code: z.string().optional(),
            })
            .parse(await decryptCheat(output.content, configuration.thecheatEncryptionKey ?? ""));
          if (
            data.date_start > data.date_end ||
            (input.bankCode && data.bank_code !== input.bankCode)
          )
            throw new Error("LOOKUP_UNAVAILABLE");
          if (!(await access.authorize()) || access.signal.aborted)
            return result("access_denied", [
              "조회 중 권한이나 동의가 바뀌어 결과를 표시하지 않았어요.",
            ]);
          return result(
            "retrieved",
            ["제공 기간 내 피해 등록 여부이며 사기 여부나 거래 안전의 확정 판단이 아니에요."],
            [
              {
                label: "피해 등록",
                value:
                  data.caution === "Y"
                    ? "등록된 피해사례 있음"
                    : "제공 기간에서 등록된 피해사례를 찾지 못함",
              },
              { label: "조회 시작(원천 시각)", value: data.date_start },
              { label: "조회 종료(원천 시각)", value: data.date_end },
            ],
            clock(),
          );
        }
        const endpoint =
          tool === "datahub_property"
            ? "/scrap/common/iros/v2/RealEstateEasyPreAddressSearch"
            : "/estate/common/solideo/reg/building-ledger";
        const input =
          tool === "datahub_property"
            ? { EASYADDRESS: targets.datahub_property.parse(target.data).address }
            : targets.datahub_building.parse(target.data);
        raw = await lookupJson(
          network,
          new URL(endpoint, "https://api.mydatahub.co.kr"),
          input,
          { authorization: `Token ${configuration.datahubToken ?? ""}` },
          access.signal,
        );
        const output = datahubEnvelope.parse(raw);
        if (!(await access.authorize()) || access.signal.aborted)
          return result("access_denied", [
            "조회 중 권한이나 동의가 바뀌어 결과를 표시하지 않았어요.",
          ]);
        if (tool === "datahub_property") {
          const data = z
            .object({
              RESULT: z.literal("SUCCESS"),
              DATALIST: z
                .array(
                  z.object({
                    ESTATENUM: z.string().max(50),
                    GUBUN: z.string().max(20),
                    NOWSTATE: z.enum(["T", "F"]),
                  }),
                )
                .max(100),
            })
            .parse(output.data);
          return result(
            data.DATALIST.length ? "retrieved" : "no_record",
            [
              "주소 검색 후보이며 등기부등본·소유권 확인 결과가 아니에요. 여러 후보는 사용자가 정확한 대상을 확인해 주세요.",
              ...(data.DATALIST.length > 10 ? ["후보가 많아 처음10개만 표시했어요."] : []),
            ],
            data.DATALIST.slice(0, 10).map((item, index) => ({
              label: `후보 ${index + 1} · ${item.NOWSTATE === "T" ? "현행" : "폐쇄"}`,
              value: `등기 고유번호 ${item.ESTATENUM}`,
            })),
            clock(),
          );
        }
        const labels = [
          "건축물명칭",
          "대지위치",
          "도로명주소",
          "주용도",
          "건축물수",
          "대지면적",
          "건축면적",
          "연면적",
          "사용승인일",
          "총호수가구수세대수",
        ];
        const rows = labels.flatMap((label) => {
          const parsed = field.safeParse(output.data[label]);
          return parsed.success && String(parsed.data).trim()
            ? [{ label, value: String(parsed.data) }]
            : [];
        });
        if (!rows.length) throw new Error("LOOKUP_UNAVAILABLE");
        return result(
          "retrieved",
          [
            "건축물대장 총괄표제부의 제공 항목이며 개별 전유부·소유권·권리관계를 확인한 결과가 아니에요.",
          ],
          rows,
          clock(),
        );
      } catch (error) {
        if (access.signal.aborted || !(await access.authorize()))
          return result("access_denied", [
            "조회가 취소됐거나 권한이 바뀌어 결과를 표시하지 않았어요.",
          ]);
        return result(
          error instanceof Error && error.message === "LOOKUP_ACCESS_DENIED"
            ? "access_denied"
            : "unavailable",
          ["외부 서비스 응답을 확인하지 못했어요. 조회 성공이나 기록 없음으로 판단하지 않았어요."],
        );
      }
    },
  };
}
