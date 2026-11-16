# 웹 UI 재구성 계획과 기능 보존표

- 작성 기준: 2026-11-16 KST, main `b54566f32d2d81f9c08ebc26acac0209623d3af1`.
- 현재 작업 순서: 기존 BARO와 정확한 디자인 기준 확인 → 기본 UI·디자인 시스템·공통 shell PR → 상세 기능 UI 이관 → 조회·성능 개선.
- 이 문서는 코드 조사와 단계별 인수 계획이다. 구현 완료, 실제 화면 인수, 외부 연동 또는 배포 성공을 뜻하지 않는다.
- 이전 전면 교체 PR #809는 종료된 별도 작업이다. 해당 PR을 다시 열거나 구현 기준으로 재사용하지 않는다.

제품 범위는 [ADR-0018](../adr/0018-conversation-report-rework.md), [대화·리포트 계약](./CONVERSATION-REPORT-REWORK.md), [앱 작업공간 계약](./APP-WORKSPACE-REWORK.md)을 따른다.
기존 문서의 과거 담당·SHA·인수 기록은 이번 작업의 완료 증거로 승격하지 않는다.
검증과 공개 운영의 경계는 [테스트 전략](../quality/TEST-STRATEGY.md), [실행 기준](./EXECUTION.md), [현행 비용 정책](../operations/PREBETA-COST-POLICY.md)을 유지한다.

## 1. 디자인 기준과 현재 증거

기존 BARO 화면을 먼저 조사하고, 확인한 화면·viewport·테마·API 모드·소스 SHA를 기준 자료에 기록한다.
합성 계정과 자료를 사용하며 실제 사건·원본·OAuth token을 화면 증거나 공개 PR에 담지 않는다.

Codex 네이티브 앱의 직접 reference 확인은 현재 도구 접근 거부로 막혀 있다. 이 조사에서는 Codex 앱을 직접 보았다고 주장하지 않으며 접근 거부를 우회하지 않는다.
정확한 Codex reference와 이를 BARO에 적용할 범위는 **디자인 출처 결정 대기** 상태다.
접근이 허용된 정확한 reference가 확인되기 전의 구조 검토나 로컬 시안은 검토용으로 표시한다. Codex와 동일한 화면을 구현했다는 인수 근거로 사용하지 않는다.

랜딩은 기존 디자인을 보존한다. 제품 UI의 시각 방향과 랜딩의 개편을 같은 작업으로 묶지 않는다.

## 2. 현재 화면 조립과 경계

현재 웹은 Astro 페이지와 독립 React island로 구성된다. 공통 탐색 island와 사건 본문 island 사이에 React context가 공유된다고 가정하지 않는다.

| 조립 요소 | 현재 역할 | 기본 UI PR에서 보존할 계약 |
| --- | --- | --- |
| [BaseLayout](../../src/layouts/BaseLayout.astro) | 문서 head, `private, no-store, no-transform`, CSP 해시, Zod jitless 초기화, 제품 테마, 접근성 진입점 | 랜딩·로그인까지 쓰는 공유 의존성, CSP와 캐시 설정 |
| [AppLayout](../../src/layouts/AppLayout.astro)·[CaseWorkbenchLayout](../../src/layouts/CaseWorkbenchLayout.astro) | 탐색 island와 본문 slot의 제품 shell | 기존 props, main 영역, 독립 island 조립, 모든 기존 경로 |
| [CaseLayout](../../src/layouts/CaseLayout.astro) | 사건 shell, 원본 미디어·로컬 사진 preview의 CSP, 안내·analytics 환경 | 기존 환경·권한·CSP·자료 preview 경계 |
| [AppNavigation](../../src/components/ui/app-navigation.tsx) | 세션과 최근 사건을 읽는 독립 탐색 island | 기존 조회·이름 변경·삭제·로그아웃 처리와 owner guard |
| [CaseWorkspaceFrame](../../src/components/ui/workspace-frame.tsx) | 헤더·중앙·참고 패널 배치, 반응형 overlay와 포커스 | 기존 `header`, `children`, `panel` 등 인터페이스; 업무 API를 소유하지 않는 경계 |
| [Workspace](../../src/components/workspace/Workspace.tsx)·[ReportReview](../../src/components/reports/ReportReview.tsx) | 대화·자료·타임라인·행동 및 별도 리포트 업무 island | 저장·복구·revision·미저장 편집 상태를 유지하는 소유 모듈 |

기본 UI PR은 제품 전용 wrapper·시각 primitive·스타일을 중심으로 진행한다. 조회 계층이나 router를 동시에 교체하는 단계로 확대하지 않는다.

## 3. 구현·현재 UI 연결 기능표

아래의 **UI 연결**은 기준 SHA의 production page와 component import에서 해당 기능으로 도달할 수 있다는 뜻이다.
실제 브라우저·외부 공급자 인수 성공을 의미하지 않는다. **조건부 연결**은 세션, 사건 단계, 서버 설정, 작업 상태에 따라 표시 여부나 조작 가능 여부가 달라진다.

| 영역·기존 URL | 현재 UI 연결과 구현 | 주요 소스 | 이후 UI 이관에서 보존할 내용 |
| --- | --- | --- | --- |
| 랜딩 `/` | UI 연결: 영상·스크롤·시연·소개·시작 링크 | [index](../../src/pages/index.astro), [랜딩 구성](../../src/components/landing/), [랜딩 스크립트](../../src/client/landing.ts) | 기존 디자인·자산·동작을 보존 |
| 로그인 `/login` | UI 연결: Kakao·Naver·Google, 연결 중·실패·재시도, 기존 계정 유형 유지 | [AuthButtons](../../src/components/AuthButtons.tsx), [session adapter](../../src/client/api/session.ts), [복귀 경로](../../src/client/return-path.ts) | 실제 provider 실패 표시, 허용된 복귀, 역할을 임의로 덮지 않는 동작 |
| 동의 `/consent` | 조건부 연결: 현재 정책 조회·저장·기존 동의 후 복귀, 정책 원문 새 창 | [ConsentForm](../../src/components/ConsentForm.tsx) | 동의 버전·연령 계약, 저장 확인 뒤 이동, 오류 시 입력 보존 |
| 새 사건 `/new` | UI 연결: 서술, 고소·청구 준비/상대방 주장 대응 입장, 길이 검증, Turnstile과 멱등 생성 | [CaseInput](../../src/components/intake/CaseInput.tsx), [rework adapter](../../src/client/api/rework.ts) | 목적·개인/기업 맥락의 구분, 동일 생성 요청 복구, 생성 뒤 질문 진입 |
| 기존 시작 URL | `/app`, `/cases`는 `/new`로 302 이동. `/cases/new`는 현재 별도 CaseInput 진입점 | [app](../../src/pages/app.astro), [cases](../../src/pages/cases/index.astro), [cases/new](../../src/pages/cases/new.astro) | 기존 URL과 접근 경계 유지; 임의 경로 삭제 금지 |
| 공통 탐색 | UI 연결: 최근 사건·단계별 이어가기·이름 변경·삭제, 최근 제목 검색, 미완료 사건 확인, 접기·모바일 drawer, 테마·도움말·설정·로그아웃 | [AppNavigation](../../src/components/ui/app-navigation.tsx) | 본인 사건만 표시, 제목 변경의 정확한 revision 확인, 포커스·모바일 탐색 |
| 질문 `/cases/:id/intake` | 조건부 연결: 최대 2차례×3문항, 선택지·직접 입력, 모름·건너뛰기, 저장·다음 질문, 준비 중·실패·동일 요청 복구 | [IntakeQuestions](../../src/components/intake/IntakeQuestions.tsx), [cases adapter](../../src/client/api/cases.ts) | 문항별 dirty 입력, 기존 답변·질문 제한, 재접속과 CAS |
| 요약 `/cases/:id/summary` | 조건부 연결: 사실·미확인·상반된 내용, 입장·절차 검토, 다른 부분/빠진 내용 설명, 변경안 비교·확정·취소, 최초 요약 확정 | [SummaryReview](../../src/components/intake/SummaryReview.tsx), [SummaryReconfirmation](../../src/components/intake/SummaryReconfirmation.tsx), [ConversationContextReview](../../src/components/workspace/ConversationContextReview.tsx) | 변경 제안과 canonical 요약 분리, before/after·이유·기준 revision·확정 receipt |
| 사건 대화 `/cases/:id` | 조건부 연결: 기록·이전 기록, 안전한 텍스트 표시, 전송·실패 재시도, 자료 선택·멘션, 업로드 처리 후 전송·대기 취소, 다음 준비 제안 | [Workspace](../../src/components/workspace/Workspace.tsx), [ConversationAgent](../../src/components/workspace/ConversationAgent.tsx), [MessageContent](../../src/components/workspace/MessageContent.tsx) | 대화 초안·선택 자료·한글 조합 입력, 전송과 서버 처리 상태의 구분, 권한 변경 시 늦은 응답 폐기 |
| 대화 안의 업무 pane | 조건부 연결: 자료, 재확인, 흐름·다음 행동, 법률 분석, 리포트 준비, 이후 해결 방법 | [액션·pane 정의](../../src/components/workspace/conversation-state.ts), [ConversationPanel](../../src/components/workspace/ConversationPanel.tsx) | pane 열기와 실제 업무 실행 구분, 진행·실패·취소·dirty/busy 상태 |
| 참고 패널 | UI 연결: 지금 확인·자료·판례, 처리·실패·갱신 필요 상태, 자료 검토 진입 | [CaseContextPanel](../../src/components/workspace/CaseContextPanel.tsx), [MaterialsPanel](../../src/components/workspace/MaterialsPanel.tsx) | 선택한 탭을 백그라운드 갱신이 가로채지 않음; 닫아도 같은 편집 트리 유지 |
| 자료 `/cases/:id/files` 및 대화·리포트의 자료 진입 | 조건부 연결: 파일·사진·촬영·붙여넣기·drag/drop, 전송·처리·대기·실패, 처리 시작/재시도, 선택·삭제 | [EvidencePicker](../../src/components/workspace/EvidencePicker.tsx), [EvidenceUpload](../../src/components/workspace/EvidenceUpload.tsx), [useEvidenceUpload](../../src/components/workspace/useEvidenceUpload.ts), [files adapter](../../src/client/api/files.ts) | 업로드 동의·물리 한도·chunk/receipt·불확실한 전송 복구, 처리 완료와 사건 반영 구분 |
| 자료 내용 확인·교정 | 조건부 연결: 원본 추출문과 교정문, 페이지·시각·프레임·관찰 종류·불확실성·coverage, 더 읽기, 포함 제외, 교정 저장·부분 저장 이어가기/취소 | [FileReview](../../src/components/workspace/FileReview.tsx), [자료 상태](../../src/components/workspace/evidence-state.ts) | 원본 보존, file/workspace revision, 미저장 교정 보존, 포함 제외의 AI·새 리포트 영향 |
| 원본·자료 반영 | 조건부 연결: 이미지·음성·영상의 명시적 원본 조회·재생/다운로드, 문서 다운로드, 자료 내용을 대화에 반영 | [Workspace](../../src/components/workspace/Workspace.tsx), [MediaPlayer](../../src/components/ui/media-player.tsx), [CaseMaterials](../../src/components/workspace/CaseMaterials.tsx) | 원본 조회 권한, 재생·탐색, 계정 변경 시 preview 제거; 교정 저장과 사건 반영을 별도 확인 |
| 타임라인 `/cases/:id/timeline` | UI 연결: 날짜 미확정 포함 일정 추가·편집, 근거 자료·사실 연결, 이전 기록, 최신 자료 기반 재정리 | [Workspace](../../src/components/workspace/Workspace.tsx), [TimelineEvidence](../../src/components/workspace/TimelineEvidence.tsx), [ConversationPreparation](../../src/components/workspace/ConversationPreparation.tsx) | 날짜·certainty·출처·revision과 기존 기록 |
| 행동 `/cases/:id/actions` | UI 연결: 완료 체크·진행률, 이전 기록, 최신 사실·자료 기반 재정리 | [Workspace](../../src/components/workspace/Workspace.tsx), [ConversationPreparation](../../src/components/workspace/ConversationPreparation.tsx) | 현재 체크 상태·중복 실행 방지·명시적 재정리 |
| 판례 `/cases/:id/precedents` 및 참고 패널 | 조건부 연결: 추천 주제·최대 2개 주제 검색, 추가 결과, 공식 원문, 출처 현재성·만료, 사건/판례 비교와 실패·복구 | [PrecedentResearch](../../src/components/workspace/PrecedentResearch.tsx), [PrecedentDocument](../../src/components/workspace/PrecedentDocument.tsx), [PrecedentComparisonPanel](../../src/components/workspace/PrecedentComparisonPanel.tsx), [comparison adapter](../../src/client/api/precedent-comparison.ts) | 별도 URL과 embedded 진입 모두 보존; 검색 결과를 검증된 사건 분석으로 자동 승격하지 않음 |
| 법률·판례 분석 | 조건부 연결: 공식 법 조항·요건과 사건 사실/증거, 공백·모순, 판례 차이·약점·보완 자료, 현재/이전 snapshot과 준비 상태 | [ConversationAnalysis](../../src/components/workspace/ConversationAnalysis.tsx), [ConversationAgent](../../src/components/workspace/ConversationAgent.tsx) | ready/partial/empty/unavailable/failed/stale 구분, 원문·정확 인용·출처 연결 |
| 외부 조회 | 설정에 따른 조건부 연결: 국세청 사업자 상태, 더치트 전화/계좌, 데이터허브 부동산 주소/건축물. 사용자가 대상과 수신처·전송 항목을 직접 확인·동의 | [LookupDialog](../../src/components/workspace/LookupDialog.tsx), [Workspace](../../src/components/workspace/Workspace.tsx), [tools 계약](../../src/contracts/v2/tools.ts) | catalog 연결 상태, 수신처별 동의, 값 변경 시 동의 해제, 같은 요청 복구. registry는 선택 대상에서 제외 |
| 리포트 `/cases/:id/reports` | 조건부 연결: 준비 상태·실패 복구, 작성 기준·현재성, 목차·절별 편집, 사진 삽입·제거, 자료 제외·식별정보 가림, 저장·취소·새 버전·이전 편집 보관 | [ReportReview](../../src/components/reports/ReportReview.tsx), [ReportReading](../../src/components/reports/ReportReading.tsx), [섹션 처리](../../src/components/reports/review-sections.ts) | 원본·이전 저장본 불변, dirty 본문·사진·scope 구분, 현재 사건 변경을 새 버전에만 반영 |
| 검토한 리포트 PDF | 조건부 연결: 수정 저장 후 정확한 report ID/revision의 PDF, 진행·실패·재시도·보관본 확인 | [검토본 다운로드](../../src/components/reports/download-reviewed.ts), [reports adapter](../../src/client/api/reports.ts), [문서 구성](../../src/components/reports/document.ts) | owner·현재 검토본 확인, 가림 시 사진 제외, PDF 조판이 새 AI/법률 조회를 시작하지 않는 계약 |
| 이후 해결 방법 | 조건부 연결: 직접 해결·변호사와 해결·리포트만 저장, 공식 절차 안내·약점, 자료/가림 범위, 사실 확인, 허용 문서 초안 생성·검토·수정·저장·TXT 다운로드, 중단·재개 | [FollowUpResolution](../../src/components/resolution/FollowUpResolution.tsx), [초안 검토 상태](../../src/components/resolution/draft-review.ts), [resolution 계약](../../src/contracts/v2/resolution.ts) | 서버 허용 문서 종류·정확한 리포트/분석 기준, 미확인 절차·기한, 검토 후 저장·다운로드. 제출·발송은 수행하지 않음 |
| 설정 `/settings` | 조건부 연결: 사용량·한도, 도움말·정책, 기존 프로필 본인 자료 확인·원본 다운로드·삭제, 연결 공급자 재인증·계정 전체 삭제 | [AccountSettings](../../src/components/AccountSettings.tsx), [LegacyProfileAssets](../../src/components/lawyers/LegacyProfileAssets.tsx), [account adapter](../../src/client/api/account.ts) | 재인증·삭제 확인, v1/v2 본인 자료·미정산/진행 작업·삭제 journal 보존 |
| 도움말·정책·404 | UI 연결: 기존 설명·FAQ·정책 원문·오류 탐색. `/policies/ai-notice`는 `/policies/ai`로 302 이동 | [help](../../src/pages/help.astro), [HelpFaq](../../src/components/HelpFaq.tsx), [PolicyDocument](../../src/components/PolicyDocument.astro), [404](../../src/pages/404.astro) | 내용·버전·기존 링크·상태 코드 |
| 변호사 공개/전용 화면 | `/lawyers`, `/lawyers/:id`, `/lawyer` 모두 현재 410 제공 종료 안내. 후속 해결의 변호사 선택은 미지원 안내 dialog | [목록 안내](../../src/pages/lawyers/index.astro), [상세 안내](../../src/pages/lawyers/[id].astro), [전용 안내](../../src/pages/lawyer/index.astro) | 종료 경계와 본인 기존 자료 권리. 기본 UI PR에서 연결 서비스를 복원하지 않음 |

후속 해결의 문서 계약에는 사실 정리, 고소장, 청구, 진술, 답변, 의견, 항소, 상고가 있다.
실제 노출은 서버의 `allowedDocumentKinds`를 따르며 공식 절차·서식 근거가 없으면 사실 정리 범위를 유지한다.

### 구현과 현재 노출을 구분할 항목

| 항목 | 기준 SHA에서 확인한 상태 | 처리 원칙 |
| --- | --- | --- |
| [ToolResults/ToolResultCards](../../src/components/workspace/ToolResults.tsx) | 컴포넌트·별도 endpoint는 있으나 production UI import가 없음 | 전용 결과 카드가 현재 보인다고 기록하지 않음. 외부 조회의 실제 대화 결과 표현과 별도 카드 연결 여부는 상세 이관 단계에서 결정 |
| HTML·저장 ZIP·선택 원본 ZIP | [API facade](../../src/client/api/index.ts)에 메서드가 있으나 현재 ReportReview의 주 내보내기는 PDF | API 존재를 현재 화면 기능으로 확대하지 않음. 새 조작 추가는 별도 범위·인수 |
| 최근 사건 검색 | 이미 불러온 본인 사건 제목의 클라이언트 필터 | 서버 전체 검색이나 별도 검색 서비스로 표현하지 않음 |
| 확인할 일 | 입력·요약 확인을 마치지 않은 사건 목록 | 별도 알림 backend가 있다고 가정하지 않음 |
| 법률·리포트 읽기 pane | 기존 authorized snapshot 조회·표시 | 펼치거나 이동하는 동작만으로 새 유료 작업을 실행하지 않음 |

## 4. 랜딩과 시스템 보존 범위

랜딩의 장면·탐색·모션·에셋·공유 의존성 상세는 [랜딩 디자인 보존 계약](./WEB-LANDING-PRESERVATION.md)을 함께 대조한다.

첫 PR은 다음 경로와 의존성의 디자인·행동을 보존한다.

- 랜딩: [index](../../src/pages/index.astro), [components/landing](../../src/components/landing/), `src/client/landing*.ts`, `src/styles/landing*.css`, `public/landing/`, 공개 폰트·브랜드 자산.
- 랜딩 공유 의존성: [BaseLayout](../../src/layouts/BaseLayout.astro), [Brand](../../src/components/ui/brand.tsx), [global.css](../../src/styles/global.css), [shell.css](../../src/styles/shell.css), [app-focus.css](../../src/styles/app-focus.css), [design-system.css](../../src/styles/design-system.css), [app-focus 설치](../../src/client/app-focus.ts).
- 백엔드·계약·데이터: `src/server/`, `src/contracts/`, `src/workflows/`, `src/worker.ts`, schema·migration·원본 저장소·삭제·실행 작업.
- 모바일·공유 클라이언트: `apps/mobile/`, `packages/api-client/`, `packages/client-core/`, `packages/design-tokens/`. [global.css](../../src/styles/global.css)·[product.css](../../src/styles/product.css)의 공유 token 추출 계약도 유지한다.
- 운영: 기존 공급자·모델·결제·AI200/일·질문2×3·권한·동의·revision/CAS·물리/기술 한도·비용 관측 전용 정책.

제품 전용 규칙은 `.baro-workbench` 또는 `[data-app-workspace]` 같은 명시적 제품 영역으로 제한한다.
공유 파일 변경이 필요한 경우 랜딩의 같은 selector·import·브랜드 표현에 미치는 영향을 먼저 확인하고 별도 근거를 남긴다.
범위를 벗어난 전역 reset이나 랜딩 재작성으로 기본 UI를 맞추지 않는다.

서버에서도 사용하는 [리포트 문서 구성](../../src/components/reports/document.ts), [마스킹·다운로드](../../src/components/reports/download.ts), [인증 장애 문서](../../src/components/ui/unavailable-document.ts)는 단순히 component 디렉터리에 있다는 이유로 삭제하지 않는다.
동등한 기능·실패·권한·데이터 보존 검증이 준비되기 전에는 기존 UI·보조 로직·테스트를 광범위하게 삭제하거나 테스트 전용 경로로 이전하지 않는다.

## 5. 단계별 PR 범위

| 단계 | 산출물과 범위 | 다음 단계로 넘어갈 조건 |
| --- | --- | --- |
| 0. 기준 확인 | 기존 BARO 화면·상태·동선과 이 기능표 대조, 정확한 Codex reference/적용 범위 결정, 랜딩 기준 증거 | 디자인 출처와 미확인 부분을 구분하고 검토 가능한 기본 UI 범위 확정 |
| 1. 기본 UI PR | 제품 전용 DS와 공통 shell: 사이드바·헤더·본문·입력 영역·참고 패널의 배치/토큰/시각 primitive·반응형·포커스. 기존 업무 island와 props·URL·API 호출 유지 | 기본 UI와 랜딩 보존 검증, 기존 기능 진입 유지, 변경 관련 검사와 PR CI 성공. 상세 기능 이관·성능 개선 완료라고 표시하지 않음 |
| 2-A. 시작·재확인 | 로그인·동의·새 사건·질문·요약·입장/절차·변경안 검토 화면을 기존 업무 계약에 맞춰 이관 | 두 입장, 2×3 제한, unknown/skip, 저장/재개·변경안 확정/취소·충돌 검증 |
| 2-B. 대화·자료·도구 | 대화·첨부·촬영·멘션·업로드 복구, 자료 교정·반영·원본, 타임라인·행동, 판례 검색/비교, 명시적 외부 조회 | 기준 기능표의 각각에 새 UI 진입과 실패/권한 검증이 연결됨. 별도 판례 URL 포함 |
| 2-C. 리포트·후속 해결 | 검토·절별 편집·사진·가림/제외·버전·PDF, 자료 추가·반영, 해결 경로·절차·초안·검토·저장·TXT·중단/재개 | 현재/이전본·미저장/저장·stale·해결 초안 기준과 실제 출력 일치. 미지원 연결 경계 유지 |
| 2-D. 계정·보조 경로 | 사용량·한도·기존 프로필 자료·재인증·사건/계정 삭제·도움말·정책·404/410 | 기존 계정과 v1 읽기·삭제, 정책 버전·본인 자료 권리·상태 코드 검증 |
| 3. 조회·성능 | 실제 중복 요청·payload·대기 시간 측정 뒤 요청 병합·선택 조회·무효화·취소·polling을 각각 개선 | 개선 전후 같은 시나리오 측정, 아래 owner/session/revision/dirty/in-flight 인수표 유지, 공유 모바일 회귀 성공 |
| 4. 통합 인수 | 정확한 통합 SHA의 필요한 전체 검증과 제한된 실제 외부 확인, 승인 범위 안의 PR·릴리스 | local/mock/SSR/브라우저/실제 외부/배포 증거를 각각 기록. 공개·법률·운영 gate 별도 유지 |

각 상세 단계는 선행 PR의 검토·CI·main 통합 뒤 독립된 범위로 진행한다. 첫 기반 준비에는 Zustand·TanStack Query의 격리된 인스턴스와 검증을 포함할 수 있지만, 기존 업무 island의 조회를 연결하거나 SPA/router·API facade·DB를 함께 교체하지 않는다.
조회·성능 단계도 기존 공유 클라이언트의 소유권·멱등성·작업 복구를 우회하지 않는다.

## 6. 공통 인수표

첫 PR은 변경된 shell/DS와 기존 업무 화면의 연결을 검증한다. 상세 이관·성능 단계에서는 해당 행의 상태 전이를 새 UI에서 다시 확인한다.

| 검증 축 | 재현·확인할 상황 | 성공 기준과 보존 경계 |
| --- | --- | --- |
| 랜딩 | 같은 SHA의 기존 랜딩을 동일 viewport·motion 설정으로 비교 | 전용 파일·자산과 공유 의존성의 디자인/동작 보존. 제품 스타일이 랜딩에 침범하지 않음 |
| 경로·기능 진입 | 직접 URL·새로고침·뒤로가기·기존 bookmark, 판례·리포트·설정·410 포함 | URL별 올바른 업무 모듈·상태 코드·복귀. 기본 shell 때문에 기능 경로가 사라지지 않음 |
| owner 변경 | 본인 A의 읽기/변경 요청 중 로그아웃 또는 B로 전환, 늦은 성공·오류 수신 | A의 사적 데이터·preview·draft가 B에 표시되지 않음. 오래된 요청이 새 세션을 다시 무효화하거나 권한을 되살리지 않음 |
| 세션·foreground | 동시 island 조회, focus/pageshow/visibility·백그라운드, 연결 장애 뒤 복구 | 진행 중 조회 병합과 새 권한 확인을 구분. 장애를 익명 세션·성공으로 위장하지 않고 숨겨진 탭에서 불필요한 polling 중단 |
| 동의 | 최신 동의 철회/버전 변경, 과거 자료·리포트 읽기와 새 작업 비교 | 기존 허용 읽기·다운로드·삭제 경계 유지, 새 생성·교정·편집은 현재 동의 확인 |
| revision/CAS | 다른 화면·탭에서 사건·요약·자료·리포트를 바꾼 뒤 저장 | 정확한 대상·revision 확인, 충돌 표시·로컬 수정 보존, 조용한 덮어쓰기·기준 임의 이동 없음 |
| 멱등성·불확실한 결과 | 전송 직후 ACK 유실, timeout, 재접속, 같은 요청 재시도 | 같은 의도·body·key/receipt 복구, 이미 접수된 작업 중복 생성 방지. HTTP 읽기 취소와 서버 작업 취소 구분 |
| 미저장 편집 | 같은 사건에서 참고 탭·자료 패널·중첩 dialog·본문 이동, 백그라운드 갱신, 새로 불러오기 | 기존 same-owner 편집과 변경 전 확인을 보존. 페이지를 떠날 때 저장·취소·명시적 폐기를 구분하며 자동 영구 저장을 약속하지 않음. 저장본과 dirty 본문·사진·scope 분리, 계정 변경 시 이전 사적 내용 폐기 |
| 입력·접근성 | 한글 조합, 긴 제목·서술·파일명·본문, disabled·오류·비동기 상태 | 조합 중 오전송 없음, Unicode 길이 계약 유지, 읽을 수 있는 이름·설명·status/alert, 44px 조작 영역 |
| 업로드 | 선택/촬영/붙여넣기/drag/drop, 동의, chunk 중단, 처리 실패·재시도, 원본 재선택 | byte/receipt·상태와 실제 처리 구분, 미완료 업로드 복구, 임의 새 업로드·자료 소실 없음 |
| 자료 교정 | paged 관찰·coverage·원본 확인, 수정·포함 제외, 부분 저장·충돌·이어가기·취소 | 원문·위치·불확실성·file/workspace revision 보존. 교정 저장과 사건 반영을 각각 확인 |
| 외부 조회 | 미설정 catalog, 직접 대상 입력·변경, 동의, 전송 실패·같은 요청 확인 | 가능한 서비스만 표시, 수신처/필드별 동의 유지·입력 변경 시 재확인, 자동 외부 재조회 없음 |
| 판례·분석 | 빈/부분/불가/실패·원문 만료, 사건 변경 후 검색/비교/분석 재확인 | 상태를 완료로 승격하지 않음. signed read·정확 인용·사건 기준·기존 공식 출처 보존 |
| 리포트·PDF | 본문/사진 편집·가림/제외·저장·새 버전·stale·PDF 실패와 재시도 | 화면과 저장된 정확한 ID/revision·출력 일치, 이전본 보존, 가림 시 사진 제외, PDF 다운로드가 새 모델 호출을 만들지 않음 |
| 후속 해결·초안 | self/미지원 lawyer/save-report, 문서 허용 범위·자료/가림 변경, 검토·저장·TXT·중단/재개 | 현재 분석/리포트 기준·검토 receipt, 미입력·절차/기한 불확실성 보존. 자동 제출·발송 없음 |
| 반응형·포커스 | 320/390/768/900/1200/1440px, 200% zoom, 낮은 가로 화면, 키보드·Escape·nested dialog·viewport 변경 | 탐색 공백·가로 넘침 없음, 내용·footer·닫기 도달 가능, trap/복귀 일치. 외부 panel reset이 열린 도구나 편집 포커스를 가로채지 않음 |
| 실제 연결과 합성 | real API 실패, local 합성 adapter, 외부 키 미설정, native 출력 준비 미완료 | 모드·실패·검증 범위를 사실대로 표시. 합성 응답을 실제 OAuth/AI/R2/원격 배포 성공으로 표현하지 않음 |

## 7. 증거와 완료 기록 방식

각 PR에는 문제와 결과 동작, 변경 경계, 검사 명령·결과, 정확한 head SHA, 화면 조건, 남은 외부 조건을 기록한다.
`bun ci` 뒤 `validate:quick`과 변경 기능의 필요한 검증을 실행하며 빌드 영향은 `validate:build`로 확인한다.
새 근거나 실패 원인 변경 없이 같은 대형 검사를 반복하지 않고, 필요한 전체 검증·실제 외부·배포는 별도 증거로 남긴다.
기존 회귀 검사의 기능·권한·원문·출력 단언을 유지하고 새 UI 동선으로 이관한다. 이전 UI 검사 성공만으로 새 UI 인수를 완료하지 않는다.

| 기록 대상 | 현재 상태 |
| --- | --- |
| 코드 조사·기능 연결표 | 기준 SHA에서 작성. 실제 화면 대조는 별도 기록 필요 |
| 기존 BARO 화면 기준 | baseline 캡처·조작 결과를 현재 작업에서 수집·대조 |
| 정확한 Codex reference | 직접 앱 도구 접근 거부. 디자인 출처 결정 대기 |
| 기본 UI PR | 구현·검토·검증 결과를 해당 신규 PR에 기록 |
| 상세 기능 UI 이관 | 후속 단계. 이 문서는 이관 완료 증거가 아님 |
| 조회·성능 개선 | 후속 측정·독립 PR 단계 |
| 실제 외부/배포 인수 | 요청·승인·환경·동일 SHA의 실제 결과가 있을 때 별도로 기록 |
