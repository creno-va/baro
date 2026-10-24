import { expect, test } from "bun:test";
import { v2LookupToolIdSchema, v2ToolResultSchema } from "../src/contracts/v2";
import {
  createExternalTools,
  type LookupAccess,
} from "../src/server/modules/external-tools/service";
import type { LookupFetch } from "../src/server/modules/external-tools/transport";

const now = "2026-10-24T06:00:00.000Z";
const access = (authorize = async () => true): LookupAccess => ({
  authorize,
  reserve: async () => true,
  signal: new AbortController().signal,
});
const configuration = {
  hometaxKey: "synthetic-key-sentinel",
  thecheatKey: "synthetic-cheat-sentinel",
  thecheatEncryptionKey: "k".repeat(32),
  datahubToken: "synthetic-datahub-sentinel",
};
const taxTarget = { businessNumber: "0000000000" };
const tax = {
  status_code: "OK",
  request_cnt: 1,
  match_cnt: 1,
  data: [
    { b_no: "0000000000", b_stt: "계속사업자", b_stt_cd: "01", tax_type: "일반과세자", end_dt: "" },
  ],
};
test("tool result contracts reject invented success rows, timestamps and arbitrary links", () => {
  const pending = {
    id: "synthetic_lookup",
    tool: "thecheat",
    status: "not_configured",
    title: "더치트 조회",
    sourceUrl: "https://apicenter.thecheat.co.kr/",
    observedAt: null,
    rows: [],
    notices: [],
  };
  expect(v2ToolResultSchema.safeParse(pending).success).toBe(true);
  for (const value of [
    { ...pending, rows: [{ label: "결과", value: "안전함" }] },
    { ...pending, status: "retrieved" },
    { ...pending, sourceUrl: "https://untrusted.invalid/" },
    { ...pending, rawToken: "private-sentinel" },
  ])
    expect(v2ToolResultSchema.safeParse(value).success).toBe(false);
});

test("all unissued lookup APIs return not_configured without HTTP, targets or invented observation times", async () => {
  let calls = 0;
  const tools = createExternalTools(
    {},
    {
      fetch: (async () => {
        calls++;
        throw new Error("must not dispatch");
      }) as LookupFetch,
    },
  );
  for (const tool of v2LookupToolIdSchema.options) {
    const result = await tools.execute(tool, null, access());
    expect(result.status).toBe("not_configured");
    expect(result.rows).toEqual([]);
    expect(result.observedAt).toBeNull();
  }
  expect(calls).toBe(0);
});

test("HomeTax binds the returned business number and exposes only status fields", async () => {
  let seen: RequestInit | undefined,
    calls = 0;
  const tools = createExternalTools(configuration, {
    clock: () => now,
    fetch: (async (url, init) => {
      calls++;
      seen = init;
      expect(new URL(String(url)).hostname).toBe("api.odcloud.kr");
      expect(new URL(String(url)).searchParams.get("serviceKey")).toBe(configuration.hometaxKey);
      return Response.json({ ...tax, owner: "private-owner-sentinel" });
    }) as LookupFetch,
  });
  const result = await tools.execute("hometax_status", taxTarget, access());
  expect(result).toMatchObject({
    status: "retrieved",
    observedAt: now,
    rows: [
      { label: "사업자 상태", value: "계속사업자" },
      { label: "과세 유형", value: "일반과세자" },
    ],
  });
  expect(JSON.stringify(result)).not.toMatch(/sentinel|0000000000|serviceKey/);
  expect(seen?.redirect).toBe("manual");
  expect(seen?.cache).toBe("no-store");
  expect(calls).toBe(1);
  const wrong = createExternalTools(configuration, {
    fetch: (async () =>
      Response.json({ ...tax, data: [{ ...tax.data[0], b_no: "1111111111" }] })) as LookupFetch,
  });
  expect((await wrong.execute("hometax_status", taxTarget, access())).status).toBe("unavailable");
});

async function encrypted(value: unknown) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(configuration.thecheatEncryptionKey),
    "AES-CBC",
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(16).fill(7);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );
  return btoa(String.fromCharCode(...iv, ...ciphertext));
}
const cheatTarget = { kind: "phone", keyword: "01000000000" };
const cheatData = {
  keyword_type: "phone",
  keyword: "01000000000",
  caution: "N",
  date_start: "20260724090000",
  date_end: "20261024090000",
  keyword_url: "https://api.thecheat.co.kr/web/private-sentinel",
  owner: "private-owner-sentinel",
};
test("TheCheat decrypts AES-CBC, matches the exact target and never returns private deep links or a safety guarantee", async () => {
  const content = await encrypted(cheatData);
  const tools = createExternalTools(configuration, {
    clock: () => now,
    fetch: (async (_url, init) => {
      expect(new Headers(init?.headers).get("X-TheCheat-ApiKey")).toBe(configuration.thecheatKey);
      return Response.json({ result_code: 1, result_msg: "success", content });
    }) as LookupFetch,
  });
  const result = await tools.execute("thecheat", cheatTarget, access());
  expect(result.status).toBe("retrieved");
  expect(result.rows).toHaveLength(3);
  expect(result.notices.join(" ")).toContain("확정 판단이 아니");
  expect(JSON.stringify(result)).not.toMatch(/sentinel|01000000000|keyword_url/);
  const wrong = createExternalTools(configuration, {
    fetch: (async () =>
      Response.json({
        result_code: 1,
        result_msg: "success",
        content: await encrypted({ ...cheatData, keyword: "01011111111" }),
      })) as LookupFetch,
  });
  expect((await wrong.execute("thecheat", cheatTarget, access())).status).toBe("unavailable");
});

test("TheCheat success(test) cannot become a live fraud result or no_record", async () => {
  const tools = createExternalTools(configuration, {
    clock: () => now,
    fetch: (async () =>
      Response.json({
        result_code: 1,
        result_msg: "success (test)",
        content: "synthetic-invalid-ciphertext",
      })) as LookupFetch,
  });
  const result = await tools.execute("thecheat", cheatTarget, access());
  expect(result.status).toBe("test_data");
  expect(result.rows).toEqual([]);
  expect(result.observedAt).toBe(now);
});

test("DataHub uses the documented production endpoint and omits owners from ambiguous address candidates", async () => {
  const tools = createExternalTools(configuration, {
    clock: () => now,
    fetch: (async (url, init) => {
      expect(String(url)).toBe(
        "https://api.mydatahub.co.kr/scrap/common/iros/v2/RealEstateEasyPreAddressSearch",
      );
      expect(JSON.parse(String(init?.body))).toEqual({ EASYADDRESS: "합성시 합성구 합성로 100" });
      return Response.json({
        result: "SUCCESS",
        errCode: "0000",
        data: {
          RESULT: "SUCCESS",
          DATALIST: [1, 2].map((i) => ({
            ESTATENUM: String(i),
            GUBUN: "3",
            NOWSTATE: "T",
            SOYOUADDRESS: `합성 주소 후보 ${i}`,
            SOYOUJANAME: "private-owner-sentinel",
          })),
        },
      });
    }) as LookupFetch,
  });
  const result = await tools.execute(
    "datahub_property",
    { address: "합성시 합성구 합성로 100" },
    access(),
  );
  expect(result.status).toBe("retrieved");
  expect(result.rows).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain("sentinel");
  expect(result.notices.join(" ")).toContain("소유권 확인 결과가 아니");
});

test("building-ledger selects scalar overview fields and never turns an empty/error response into no_record", async () => {
  const target = {
    INNB: "0000000000000000000",
    RNMGTSN: "000000000000",
    BULDMNNM: "1",
    BULDSLNO: "0",
  };
  for (const data of [
    { 건축물명칭: "합성 건축물", 연면적: 123, 소유자: "private-owner-sentinel" },
    {},
  ]) {
    const tools = createExternalTools(configuration, {
      fetch: (async (url) => {
        expect(new URL(String(url)).pathname).toBe("/estate/common/solideo/reg/building-ledger");
        return Response.json({ result: "SUCCESS", errCode: "0000", data });
      }) as LookupFetch,
    });
    const result = await tools.execute("datahub_building", target, access());
    expect(result.status).toBe("건축물명칭" in data ? "retrieved" : "unavailable");
    expect(JSON.stringify(result)).not.toContain("sentinel");
  }
});

test("no credentials follow redirects, no oversized/private errors escape, and no paid request is retried", async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { location: "https://untrusted.invalid/" } }),
    new Response("x".repeat(256 * 1024 + 1)),
    new Response("private-error-sentinel", { status: 503 }),
  ]) {
    let calls = 0;
    const tools = createExternalTools(configuration, {
      fetch: (async () => {
        calls++;
        return response;
      }) as LookupFetch,
    });
    const result = await tools.execute("hometax_status", taxTarget, access());
    expect(result.status).toBe("unavailable");
    expect(calls).toBe(1);
    expect(JSON.stringify(result)).not.toContain("sentinel");
  }
});

test("scope/revision consent and durable reservation fence dispatch and late disclosure; concurrent calls stay bounded", async () => {
  let allowed = true,
    calls = 0;
  const tools = createExternalTools(configuration, {
    fetch: (async () => {
      calls++;
      allowed = false;
      return Response.json(tax);
    }) as LookupFetch,
  });
  expect(
    (
      await tools.execute(
        "hometax_status",
        taxTarget,
        access(async () => false),
      )
    ).status,
  ).toBe("access_denied");
  expect(calls).toBe(0);
  expect(
    (await tools.execute("hometax_status", taxTarget, { ...access(), reserve: async () => false }))
      .status,
  ).toBe("unavailable");
  expect(calls).toBe(0);
  expect(
    (
      await tools.execute(
        "hometax_status",
        taxTarget,
        access(async () => allowed),
      )
    ).status,
  ).toBe("access_denied");
  expect(calls).toBe(1);
  let concurrent = 0;
  const bounded = createExternalTools(configuration, {
    fetch: (async () => {
      concurrent++;
      return Response.json(tax);
    }) as LookupFetch,
  });
  await Promise.all([1, 2, 3].map(() => bounded.execute("hometax_status", taxTarget, access())));
  expect(concurrent).toBe(2);
});
