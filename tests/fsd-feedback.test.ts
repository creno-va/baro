import { expect, test } from "bun:test";
import {
  createInputSchema,
  createLawyersClient,
  type DomainRequest,
  type DomainRequestInit,
} from "@baro/api-client";
import { createSessionScope } from "@baro/client-core";
import { emptySelfProfile } from "@baro/contracts/v2/self-profile";
import { createReportMarkup } from "../src/components/reports/document";
import { createCaseRequestSchema } from "../src/contracts/cases";
import { v2CreateCaseRequestSchema } from "../src/contracts/v2";

test("short case input has the same Unicode boundary in client and both APIs", () => {
  for (const narrative of ["폭행을 당했어요.", "😀".repeat(5), "  다섯글자요  "]) {
    expect(createInputSchema.safeParse({ narrative, subjectContext: "individual" }).success).toBe(
      true,
    );
    expect(
      createCaseRequestSchema.safeParse({ narrative, turnstileToken: "synthetic" }).success,
    ).toBe(true);
    expect(
      v2CreateCaseRequestSchema.safeParse({
        narrative,
        subjectContext: "individual",
        jurisdiction: "KR",
        turnstileToken: "synthetic",
      }).success,
    ).toBe(true);
  }
  for (const narrative of ["", "    ", "😀".repeat(4), "가".repeat(5001)]) {
    expect(createInputSchema.safeParse({ narrative, subjectContext: "individual" }).success).toBe(
      false,
    );
    expect(
      v2CreateCaseRequestSchema.safeParse({
        narrative,
        subjectContext: "individual",
        jurisdiction: "KR",
        turnstileToken: "synthetic",
      }).success,
    ).toBe(false);
  }
});

test("profile contact whitespace is normalized and invalid fields explain why no save was sent", async () => {
  const profile = emptySelfProfile("synthetic-profile");
  const writes: unknown[] = [];
  const request: DomainRequest = async <T>(_path: string, init?: DomainRequestInit) => {
    writes.push(init?.body);
    return (init?.body as { profile: typeof profile } | undefined)?.profile as T;
  };
  const client = createLawyersClient({ request, scope: createSessionScope() });
  const saved = await client.saveMine({
    ...profile,
    email: " lawyer@example.com ",
    website: " https://example.com ",
    phone: " 010-1234-5678 ",
  });
  expect(saved).toMatchObject({
    email: "lawyer@example.com",
    website: "https://example.com",
    phone: "010-1234-5678",
  });
  for (const [change, message] of [
    [{ email: "invalid" }, "이메일 주소"],
    [{ website: "www.example.com" }, "홈페이지 주소"],
    [{ website: "http://example.com" }, "https://"],
    [{ phone: "전화주세요" }, "전화번호"],
    [{ portfolio: [{ id: "empty-title", title: "", url: null }] }, "포트폴리오"],
  ] as const) {
    await expect(
      client.saveMine({
        ...profile,
        ...change,
        portfolio: "portfolio" in change ? [...change.portfolio] : [],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining(message),
    });
  }
  expect(writes).toHaveLength(1);
  await expect(client.saveMine(null as unknown as typeof profile)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  await expect(
    client.saveMine({ ...profile, email: 123 } as unknown as typeof profile),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  expect(writes).toHaveLength(1);
});

test("selected photo captions keep the exact related text escaped and disappear under masking", () => {
  const report = {
    title: "합성 리포트",
    content: "사건 요약\n합성 내용",
    revision: 1,
    updatedAt: "2026-10-28T00:00:00Z",
    stale: false,
    maskIdentifiers: false,
    excludedFileIds: [],
    photos: [
      {
        id: "synthetic-photo",
        name: "합성사진.png",
        revision: 3,
        dataUrl: "data:image/png;base64,AA==",
        notes: ["확인 필요: <script>합성 관찰</script>"],
      },
    ],
  };
  const markup = createReportMarkup(report);
  expect(markup).toContain("확인 필요: &lt;script&gt;합성 관찰&lt;/script&gt;");
  expect(markup).not.toContain("<script>");
  expect(markup).not.toContain("자료 버전 3");
  expect(createReportMarkup({ ...report, maskIdentifiers: true })).not.toContain("data:image/png");
  expect(createReportMarkup({ ...report, excludedFileIds: ["synthetic-photo"] })).not.toContain(
    "data:image/png",
  );
});
