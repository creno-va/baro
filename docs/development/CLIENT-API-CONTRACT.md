# 동일 클라이언트와 API mock 계약

> **2026-10-07 사용자 후속 — 이전 비용 정책보다 우선:** 계정별 AI 응답은 KST 하루200회이며 Preview/Production의 별도 전체 월 예산 차단은 해제한다. Cloudflare 기존 결제 경로에서 잔액$10 이하 시$30 자동 충전을 사용자가 직접 승인/설정했다. metering·실제 funding·가격/FX·bounded attempt·unknown 비용 보존은 유지한다. 배포 설정 `MONTHLY_BUDGET_CAP_ENABLED=false`가 예약·사용량·정산에 일관되게 적용된다. 기존 allocation 금액은 이 모드에서 소비 차단 한도가 아니며 schema0009의 기록을 보존한다.

- Status: Accepted implementation plan
- Updated: 2026-10-07
- 사용자 결정: 실제 클라이언트 UI 하나를 만들고 API 응답만 mock으로 대체한다.
- 실행: [5세션 계획](./PARALLEL-UI-SPRINT.md). 기존 공유 서버 계약은 `src/contracts/v2/`를 보존한다.

## 변경 경계

실제 경로 `/login`, `/consent`, `/cases`, `/cases/new`, `/cases/:id`, `/lawyers`,
`/lawyer`, `/settings`에서 같은 React/Astro UI를 사용한다. 별도 `/mock` 사이트,
mock 전용 페이지 복사, 컴포넌트의 합성 데이터 직접 import를 만들지 않는다.

UI → domain client → 공통 request/response 검증 → 선택한 transport → 응답 순서다.
`real` transport는 기존 same-origin API를 호출하고, `mock` transport는 같은 요청·응답 경계에서
합성 API 응답을 제공한다. UI는 transport 종류에 따른 기능 분기를 하지 않는다.
HTTP wire 형식과 서버의 복잡한 저장 형식은 domain client가 아래 화면 DTO로 변환한다.
mock과 real은 동일한 화면 DTO를 반환한다. 실제 구현되지 않은 API를 mock으로 자동 대체하지 않는다.

local/격리된 preview에서 명시적으로 `PUBLIC_API_MODE=mock`을 선택한다. 기본은 `real`이다.
2026-10-07 사용자 후속 지시에 따라 배포되는 preview도 `PUBLIC_API_MODE=real`을 사용하고
production과 같은 bundle 검사를 거친다. mock은 명시적으로 선택한 local/격리된 검증에만 사용한다.
실제 공급자 설정·가격/funding·승인 증거가 없으면 기존 API 오류를 그대로 처리하며 mock으로
대체하지 않는다. preview는 해당 환경의 same-origin API를 쓰며 production credential·DB를 복제하지 않는다.
production 빌드/실행에는 mock 응답을 허용하지 않는다. mock 페이지를 그리기 위한 local/preview
client-side 진입은 기존 실제 API의 인증·동의·owner·public gate를 해제하지 않는다.
명시적 mock 화면에는 작은 `API 예시 응답으로 보기` 표시를 제공한다.

실 API에 미연결인 버튼도 mock API를 통해 상태 변화까지 끝내되, 제품 성공으로 기록하지 않는다.
폼 입력·파일 선택·문답·프로필·선택 자료·삭제는 API mock 저장소에 보존해 새로고침 후 이어진다.
실제 OAuth/AI/R2 요청과 비용은 mock 모드에서 발생하지 않는다.

## 최소 화면 DTO와 오류

다음 필드명과 의미를 처음 2시간 동안 고정한다. 추가 필드는 optional로만 확장한다.
session A가 `src/client/api/types.ts`에 구현한다. B~E는 이 명세를 기준으로 독립적인 화면을
작성하고 임시 반환 stub을 제품에 남기지 않는다. 서버 계약·schema/migration은 이 문서가 변경하지 않는다.

```ts
type AccountType = "customer" | "lawyer";
type Provider = "google" | "naver" | "kakao";
type SessionView = {
  user: null | { id: string; name: string; accountType: AccountType };
  needsConsent: boolean;
};
type CaseView = {
  id: string; title: string; subjectContext: "individual" | "company";
  stage: "intake" | "summary" | "active" | "archived";
  revision: number; updatedAt: string; summary: string; schemaVersion?: "1" | "2";
};
type QuestionView = {
  id: string; text: string; kind: "text" | "choice";
  options?: string[]; answer?: string; answerState?: "answered" | "unknown" | "skipped";
};
type QuestionRound = { ordinal: number; questionIds: string[] };
// Question IDs map the flat editable list to its published generation rounds.
type QuestionsResult = {
  questions: QuestionView[]; complete: boolean; revision: number;
  roundLimit?: number; rounds?: QuestionRound[];
  processingStage?: "questions" | "summary";
  processing?: boolean; failed?: boolean; retryable?: boolean;
};
type MessageView = {
  id: string; role: "user" | "assistant"; text: string;
  status: "pending" | "complete" | "failed"; createdAt: string;
};
type ActionView = { id: string; title: string; detail: string; done: boolean };
type TimelineView = { id: string; date: string; title: string; detail: string };
type FileView = {
  id: string; name: string; mimeType: string; sizeBytes: number;
  status: "uploading" | "processing" | "ready" | "failed" | "waiting";
  coverage: string; extractedText: string;
};
type WorkspaceView = {
  case: CaseView; messages: MessageView[]; actions: ActionView[];
  timeline: TimelineView[]; files: FileView[];
  facts?: V2Summary["facts"]; people?: V2Summary["parties"];
  unknowns?: string[]; notices?: string[];
};
type ReportView = {
  id: string; caseId: string; revision: number; title: string;
  content: string; updatedAt: string; stale: boolean;
  excludedFileIds: string[]; maskIdentifiers: boolean;
};
type LawyerView = {
  id: string; revision: number; name: string; introduction: string;
  officeName: string; address: string; region: string; practiceAreas: string[];
  phone: string; email: string; website: string; photoUrl: string | null;
  portfolio: { id: string; title: string; text?: string; url: string | null; assetId?: string }[];
  published: boolean; verificationStatus: "self_declared" | "verified";
};
type UsageView = {
  newCases: { used: number; limit: number };
  aiResponses: { used: number; limit: number };
  mediaMinutes: { used: number; limit: number };
  storageBytes: { used: number; limit: number };
};
type ApiErrorView = {
  code: "UNAUTHENTICATED" | "CONSENT_REQUIRED" | "NOT_FOUND" | "CONFLICT"
      | "QUOTA_EXCEEDED" | "VALIDATION_ERROR" | "UNAVAILABLE";
  message: string; retryable: boolean;
};
```

## 도메인별 호출과 소유권

2026-10-07 #65 요청에 따라 WorkspaceView를 위 optional 필드로 확장한다. V2Summary는
기존 `src/contracts/v2/intake.ts`의 검증된 Summary 정본이다. facts는 사실·주장·출처 참조,
people은 parties의 기존 전체 shape를 그대로 재사용한다. unknowns/notices는 해당 Summary의
미확인·안내 문자열이다. 기존 DTO 소비자는 필드 부재를 허용하며 실제 근거·자격·모델의
새 provenance를 발명하지 않는다. facade의 모든 WorkspaceView 반환에도 같은 타입을 적용한다.

고객 모듈의 POST `/api/v2/cases/:id/timeline`은 기존 v2TimelineEditRequestSchema를 쓰고
생성은 workspace revision, 편집은 entity revision을 비교한다. GET
`/api/v2/cases/:id/workspace-jobs/latest`는 owner-scoped 기존 V2Job 또는 null이다. 목록의
`previews?: { id: string; title: string; hasSummary: boolean }[]`는 부가 표시이며
items/nextCursor와 private owner 경계를 바꾸지 않는다. HTTP receipt·동일 key/body·충돌 처리는
기존 계약을 유지한다. 새 schema/migration 없이 모듈 PR128의 실제 구현·CI에서 검증한다.

아래 호출을 `api` facade로 공개한다. `expectedRevision`과 mutation request key는
domain client가 기존 wire 형식으로 변환하고 mock에도 같은 중복 방지를 적용한다.
id는 opaque 문자열, 시각은 ISO8601이다. 화면에 schema/model/내부 job명을 노출하지 않는다.
reports의 id는 caseId이며 PDF/ZIP 다운로드에는 조회한 reportId를 사용한다.

| 소유 | facade method | 입력 → 출력 |
| --- | --- | --- |
| A | `api.session.get()` | `SessionView` |
| A | `api.session.signIn(provider, accountType)` | mock은 session 생성, real은 OAuth 시작; callback과 역할 선택 유지 |
| A | `api.session.getConsent()` | 기존 consent contract의 required/consent/needsConsent |
| A | `api.session.saveConsent(input)` | 기존 consent contract → `SessionView` |
| A | `api.session.signOut()` | session 종료 |
| B | `api.cases.list()` | `CaseView[]` |
| B | `api.cases.create({ narrative, subjectContext })` | `CaseView` |
| B | `api.cases.get(id)` | `CaseView` |
| B | `api.cases.getQuestions(id)` | `QuestionsResult`; 저장된 각 묶음의 문항 ID와 차례를 함께 반환 |
| B | `api.cases.saveAnswers(id, { expectedRevision, answers })` | answers는`{ questionId, state, value? }[]`; 질문 view와 최신 revision |
| B | `api.cases.advance(id, { expectedRevision })` | `QuestionsResult`; 현재 묶음 답변 완료 후 다음 묶음 생성, 두 묶음 완료 후 요약 준비 |
| B | `api.cases.saveSummary(id, { expectedRevision, summary })` | `CaseView` |
| B | `api.cases.confirmSummary(id, { expectedRevision })` | `CaseView`, stage=active |
| C | `api.workspace.get(id)` | `WorkspaceView` |
| C | `api.workspace.sendMessage(id, { expectedRevision, text, selectedFileIds })` | `WorkspaceView` |
| C | `api.workspace.retryMessage(id, messageId)` | `WorkspaceView` |
| C | `api.workspace.setAction(id, actionId, done)` | `WorkspaceView` |
| C | `api.workspace.saveTimeline(id, entry)` | entry는`Omit<TimelineView, "id"> & { id?: string }`; `WorkspaceView` |
| C | `api.files.list(id)` | `FileView[]` |
| C | `api.files.upload(id, file)` | browser `File` → `FileView`; real은 기존 multipart/chunk 계약 |
| C | `api.files.retry(id, fileId)` | `FileView` |
| C | `api.files.remove(id, fileId)` | 목록 재조회 |
| C | `api.files.original(id, fileId)` | 다운로드용`Blob` |
| D | `api.reports.get(id)` | `ReportView` |
| D | `api.reports.save(id, { content, maskIdentifiers, excludedFileIds })` | `ReportView` |
| D | `api.reports.generate(id)` | `ReportView` |
| D | `api.reports.pdf(id)` | PDF `Blob` |
| D | `api.reports.zip(id, selectedFileIds)` | ZIP `Blob` |
| D | `api.account.usage()` | `UsageView` |
| D | `api.account.deleteCase(id, confirmation)` | API 접수 후 목록으로; mock 저장소에서 동일 id 제거 |
| D | `api.account.deleteAccount(confirmation)` | API 접수 후 session 종료 |
| E | `api.lawyers.list({ region?, practiceArea?, query? })` | `LawyerView[]` |
| E | `api.lawyers.get(id)` | `LawyerView` |
| E | `api.lawyers.getMine()` | `LawyerView` |
| E | `api.lawyers.saveMine(profile)` | `LawyerView` |
| E | `api.lawyers.publishMine(published, current?)` | `LawyerView`; 화면에서 확인한 `{ id, revision }`을 전달. HTTP body는 `profileId`, `expectedRevision`, `published`, `consent` 필수; 운영 승인 단계 없음 |

## 병렬 편집 경계

| 소유 | client/domain files | mock files |
| --- | --- | --- |
| A | `src/client/api/core.ts`, `types.ts`, `index.ts`, `session.ts` | `src/client/api/mock/runtime.ts`, `session.ts`, 공통 registration |
| B | `src/client/api/cases.ts` | `src/client/api/mock/cases.ts` |
| C | `src/client/api/workspace.ts`, `files.ts` | `src/client/api/mock/workspace.ts`, `files.ts` |
| D | `src/client/api/reports.ts`, `account.ts` | `src/client/api/mock/reports.ts`, `account.ts` |
| E | `src/client/api/lawyers.ts` | `src/client/api/mock/lawyers.ts` |

A는 첫 20분에 types/core/registration의 기반을 commit·push해 B~E가 가져갈 수 있게 한다.
B~E는 완료를 기다리지 않고 소유 화면을 만든다. A가 표의 domain 파일에 초기 stub을 만든 경우,
최초 push 이후 소유자에게 넘기고 중복 수정하지 않는다. 각 domain은 handler와 fixture를 공개한다.
공통 mock runtime 저장소에는 domain namespace를 두며 case id/session id를 전체 영역에서 일치시킨다.
사건·요약 변경이 workspace·report에 반영되고 자료 삭제가 선택 자료에서 제거되는 상태 전이를 확인한다.

## 2시간의 최소 동작

- 로그인 역할 선택→동의→역할별 시작 화면, 로그아웃, 취소·오류·재시도.
- 빈 사건 생성→질문 답변/모름/건너뛰기→요약 수정·확인→workspace 이동.
- 채팅 전송·재시도, 자료 선택·처리 상태·삭제, 행동 상태, 타임라인 추가, 새로고침 후 이어서 이용.
- 리포트 내용·마스킹·선택 자료 저장, 실제로 열리는 합성 PDF와 ZIP 다운로드.
  원본 binary를 보존하지 않으면 ZIP은 명시한 합성 자료로 제한한다. 다른 형식을 PDF/ZIP으로 위장하지 않는다.
- 변호사 역할→본인 프로필 편집·저장·공개·비공개→디렉터리에서 같은 프로필 확인.
  역할 자기 선택으로 자격 확인 완료 badge나 moderator 권한을 부여하지 않는다.
- 사건·계정 삭제 확인→API 상태 변경→목록·session에 반영.
- 담당 영역의 로딩·빈 상태·오류·한도와 모바일 동작을 확인한다.

## 기존 실제 API 재사용과 남은 차이

인증은 Better Auth 3사와 `/api/me/consent`를 재사용한다. 기존 role은
`user/lawyer_applicant/verified_lawyer/moderator`이다. 새 MVP의 `accountType` 저장과
승인 없는 본인 프로필 공개는 아직 실제 API에 없다. A는 역할 저장, E는 본인 프로필 공개의 후속 구현을 맡는다.
기존 moderator/verified 레코드를 삭제하거나 위조하지 않는다.

#64 PR100 workspace backend, #58 files API, #60 lawyers API, #61 directory를 재사용한다.
실제 API 성공·외부 gate는 mock 완료와 별도로 기록한다. DB를 선행 재설계하지 않고 미연결 operation은
담당 기존 기능 이슈에 기록한 뒤 같은 UI의 real domain adapter를 연결한다.

## 2026-10-09 C 변호사 보완 계약

현재 3세션 소유는 A=공통 types/auth/router/runtime·고객, B=자료/리포트/삭제,
C=변호사 서버/API/client·계획/증거다. 위 옛 A~E 소유 표는 mock sprint 이력이다.
`LawyerView`는 변호사 전용 selfProfileSchema에서 파생하며 공통 types 변경은 없다.
portfolio `text`는 제목과 별개인 선택 본문(최대 5,000자); 없는 기존 snapshot/link/image/PDF와 호환된다.
본문은 HTML로 실행하지 않고 줄바꿈을 보존하는 텍스트로 미리보기·공개한다. 저장/삭제는 기존
프로필 revision·암호화·소유권·공개 동의 경로를 사용하며 migration은 추가하지 않는다.

기존 자기 profile/ready upload 조회·다운로드는 재동의 전 허용한다. 새 profile 생성·저장·공개·
업로드는 현재 동의가 필요하고 타인/고객 역할/session 만료·삭제는 계속 차단한다. 공개 디렉터리와
자산은 기존 current consent 가드를 유지한다. A의 `requireSession({consent:false})` 읽기 옵션과
lawyer 읽기 whitelist를 C mock consumer에서 사용하고 mutation/cache replay의 동의 검사는 유지한다.
최종 SHA/통합 결과는 [완료표](./MVP-REQUIREMENTS-EVIDENCE.md)와 #62/#69에서 추적한다.

## 2026-10-09 B 제품 HTML 리포트 계약

사용자가 HTML을 “BARO 제품에 적용”하도록 확정했다. B/#66은
`GET /api/v2/reports/:reportId/html`과 reports client의 `html(id)`를 구현하고
ReportReview에 디자인된 HTML 미리보기·다운로드를 연결한다. 공통 types/auth/router의 변경은
필요하면 A와 조율한다. 이 절은 계약/인수 추적이며 구현·통합 PASS를 의미하지 않는다.

저장된 보고서 내용을 렌더하므로 새 AI 생성·revision 변경과 구분한다. 고정 생성 기준·stale·
마스킹·자료 제외·출처/누락을 유지하며 재동의 전에도 기존 자기 리포트 읽기를 허용한다.
owner/session/삭제 fence를 유지하고 HTML 입력을 escape하며 script/원격 리소스/폼 실행을
허용하지 않는다. 응답의 HTML MIME·private/no-store·nosniff·제한된 CSP, 실제 다운로드 내용과
모바일/인쇄 레이아웃의 증거는 UI-35/#69/#71에서 통합 SHA에 연결한다.
