import { useState } from "react";
import type { FileReviewView, FileView } from "../../src/client/api/types";
import { Button, ButtonLink } from "../../src/product-ui/Button";
import { summary } from "../fixtures/contracts/v2";

export const productShellCaseId = "shell-app-case";

/** Same explicit synthetic records as the actual-route browser acceptance. */
export function productShellFixtureValues(now = new Date().toISOString()) {
  const item = {
    id: productShellCaseId,
    title: "돌려받지 못한 보증금과 반환 약속을 함께 정리하는 긴 사건 제목",
    schemaVersion: "2",
    stage: "active",
    revision: 1,
    updatedAt: now,
    summary: "계약 종료 뒤 보증금을 돌려받지 못한 합성 사건입니다.",
    summaryDetails: summary,
    subjectContext: "individual",
  };
  return {
    session: {
      user: { id: "shell-app-owner", name: "합성 고객", accountType: "customer" },
      needsConsent: false,
    },
    cases: { [productShellCaseId]: item },
    caseOwners: { [productShellCaseId]: "shell-app-owner" },
    reworkContexts: {
      [productShellCaseId]: {
        casePurpose: "prepare_claim",
        subjectContext: "individual",
        procedure: { kind: "unconfirmed", stage: "unconfirmed", description: null },
      },
    },
    workspace: { [productShellCaseId]: { messages: [], timeline: [], actions: [] } },
    files: { [productShellCaseId]: [] },
  };
}

export function productShellFixtureEnabled(mode: unknown, hostname: string) {
  return mode === "mock" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

/** No authentication request or policy acceptance occurs in this local fixture. */
export function prepareProductShellFixture(
  mode: unknown,
  hostname: string,
  storage: Pick<Storage, "setItem">,
) {
  if (!productShellFixtureEnabled(mode, hostname)) throw new Error("LOCAL_MOCK_FIXTURE_REQUIRED");
  for (const [key, value] of Object.entries(productShellFixtureValues()))
    storage.setItem(`baro-api-mock-v1:${key}`, JSON.stringify(value));
  storage.setItem("shell-app-seeded", "1");
}

/** Opens an unchecked consent screen without accepting or submitting a policy. */
export function prepareProductConsentFixture(
  mode: unknown,
  hostname: string,
  storage: Pick<Storage, "setItem">,
) {
  prepareProductShellFixture(mode, hostname, storage);
  storage.setItem(
    "baro-api-mock-v1:session",
    JSON.stringify({ ...productShellFixtureValues().session, needsConsent: true }),
  );
}

/** Additional local, synthetic material. No original binary is fabricated. */
export function prepareProductDetailsFixture(
  mode: unknown,
  hostname: string,
  storage: Pick<Storage, "setItem">,
) {
  prepareProductShellFixture(mode, hostname, storage);
  const file: FileView = {
    id: "shell-detail-file",
    revision: 1,
    name: "합성 보증금 반환 대화.txt",
    mimeType: "text/plain",
    sizeBytes: 96,
    status: "ready",
    coverage: "합성 텍스트 1쪽 처리, 2쪽 확인 불가",
    extractedText: "상대방이 보증금을 다음 주에 돌려주겠다고 진술한 합성 대화입니다.",
  };
  const observation = {
    id: "shell-detail-observation",
    text: file.extractedText,
    position: { kind: "document", page: 1, paragraph: 1, table: null },
    certainty: "uncertain",
    userEdited: false,
    included: true,
  } as const;
  const review: FileReviewView = {
    file: { id: file.id, name: file.name, revision: 1, status: "ready" },
    workspaceRevision: 1,
    coverage: {
      category: "document",
      status: "partial",
      pageCount: 2,
      pages: [
        { page: 1, status: "processed" },
        { page: 2, status: "low_quality" },
      ],
    },
    observations: [{ ordinal: 0, value: observation, original: observation }],
    nextAfterOrdinal: null,
    pendingReview: null,
    recovery: null,
  };
  storage.setItem("baro-api-mock-v1:files", JSON.stringify({ [productShellCaseId]: [file] }));
  storage.setItem("baro-api-mock-v1:fileReviews", JSON.stringify({ [file.id]: review }));
}

export function ProductShellFixture() {
  const [prepared, setPrepared] = useState(false);
  const [message, setMessage] = useState("아직 합성 계정을 준비하지 않았습니다.");
  const [error, setError] = useState("");
  const mock = import.meta.env.PUBLIC_API_MODE === "mock";
  function prepare(details = false, consent = false) {
    try {
      const seed = consent
        ? prepareProductConsentFixture
        : details
          ? prepareProductDetailsFixture
          : prepareProductShellFixture;
      seed(import.meta.env.PUBLIC_API_MODE, location.hostname, localStorage);
      window.dispatchEvent(new Event("baro-session-changed"));
      setPrepared(true);
      setError("");
      setMessage(
        consent
          ? "동의가 필요한 로컬 합성 계정을 준비했습니다. 정책 동의는 제출하지 않았습니다."
          : "로컬 합성 고객과 사건을 준비했습니다. 아래 실제 제품 경로를 열어 확인하세요.",
      );
    } catch {
      setError("localhost의 명시적 mock 모드와 사용 가능한 로컬 저장 공간이 필요합니다.");
    }
  }
  function visitor() {
    try {
      if (!productShellFixtureEnabled(import.meta.env.PUBLIC_API_MODE, location.hostname))
        throw new Error("LOCAL_MOCK_FIXTURE_REQUIRED");
      localStorage.setItem(
        "baro-api-mock-v1:session",
        JSON.stringify({ user: null, needsConsent: false }),
      );
      window.dispatchEvent(new Event("baro-session-changed"));
      setPrepared(false);
      setError("");
      setMessage("로컬 mock 세션을 방문자 상태로 바꿨습니다. 사건 기록은 보존했습니다.");
    } catch {
      setError("localhost의 명시적 mock 모드와 사용 가능한 로컬 저장 공간이 필요합니다.");
    }
  }
  return (
    <main
      id="main-content"
      data-product-ui=""
      data-theme="light"
      className="min-h-dvh bg-[var(--pui-background)] px-6 py-12 text-[var(--pui-text)]"
    >
      <div className="mx-auto flex max-w-2xl flex-col items-start gap-6">
        <h1 className="text-3xl font-semibold">실제 제품 shell 검토</h1>
        <p className="leading-7">
          개발 전용 화면입니다. 버튼을 누르기 전에는 저장 공간을 바꾸지 않습니다. 합성 계정 준비는
          실제 로그인이나 약관 동의가 아니며 정책 동의를 제출하지 않습니다. 기본 준비는
          needsConsent=false, 동의 화면용은 needsConsent=true인 로컬 mock 세션을 설정합니다. 같은
          로컬 주소의 합성 사건 목록을 초기 예시로 바꿉니다.
        </p>
        {!mock && (
          <p role="alert">PUBLIC_API_MODE=mock으로 실행한 localhost에서만 준비할 수 있습니다.</p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button disabled={!mock} onClick={() => prepare()}>
            합성 계정 준비
          </Button>
          <Button disabled={!mock} variant="secondary" onClick={() => prepare(true)}>
            자료가 있는 합성 계정 준비
          </Button>
          <Button disabled={!mock} variant="secondary" onClick={() => prepare(false, true)}>
            동의 화면용 합성 계정 준비
          </Button>
          <Button disabled={!mock} variant="secondary" onClick={visitor}>
            방문자 상태로 초기화
          </Button>
        </div>
        <p role="status">{message}</p>
        {error && <p role="alert">{error}</p>}
        {prepared && (
          <nav aria-label="실제 제품 경로" className="flex flex-wrap gap-3">
            <ButtonLink href="/consent" variant="secondary">
              동의 화면 열기
            </ButtonLink>
            <ButtonLink href="/new">새 사건 열기</ButtonLink>
            <ButtonLink href="/__product-shell/input" variant="secondary">
              빌드 CSP 입력 확인
            </ButtonLink>
            <ButtonLink href={`/cases/${productShellCaseId}`} variant="secondary">
              합성 사건 열기
            </ButtonLink>
            <ButtonLink href={`/cases/${productShellCaseId}/summary`} variant="secondary">
              합성 요약 열기
            </ButtonLink>
            <ButtonLink href={`/cases/${productShellCaseId}/reports`} variant="secondary">
              합성 리포트 열기
            </ButtonLink>
            <ButtonLink href="/settings" variant="secondary">
              설정 열기
            </ButtonLink>
          </nav>
        )}
        <a href="/new" className="underline underline-offset-4">
          현재 세션으로 /new 열기
        </a>
      </div>
    </main>
  );
}
