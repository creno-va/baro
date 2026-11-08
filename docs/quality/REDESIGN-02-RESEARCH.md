# 사건 목록·시작·대화·자료 조사

- 조사 기준: main `7236c14f88f21a64c5fe916a90779d7c238fff6d`, 2026-11-08 KST.
- 담당: 사건 목록·시작·현재 intake·대화·자료. 공통 토큰/CSS/ui/layout/CaseNavigation은 01 소유.
- 작업: `codex/764-case-conversation-materials`, 별도 `flow-02-cases` worktree.
- 조사 기준 이후의 구현은 아래 '구현 범위'에서 구분한다. 후속 계약은 완료 기능으로 표시하지 않는다.

## 결정과 구현의 구분

사용자 현재 지시는 민사 준비/대응·형사 고소 준비/대응을 고려하고 실제 변호사 컨택을
제공하지 않으며 본인 계정·사건·자료 접근을 보존하는 것이다. 총괄의 새 IA는 대화·자료·
리포트·문서 초안의 네 상시 진입이다. 자료는 독립 작업이고 근거 검토는 필요할 때 연다.

[#764](https://github.com/creno-va/baro/issues/764)와 [Draft PR765](https://github.com/creno-va/baro/pull/765)의
조사 head는 `9ca3c0ad94bd8375a6129d66b135cbb54723e6ea`다. ADR0019의 초기 범위 결정과
ADR0020 Proposed의 문서 우선 intake·0회 질문·작성 중 보관·새 drafts URL 제안을 구분한다.
현재 API/DB를 임의 확장하거나 과거 UI 인수/배포 성공을 이번 개편의 증거로 사용하지 않는다.
별도 PR772는 조사 당시 통합하지 않았다. 이후 main `b02357ffde3bc6af94218086cca1c0706c938d36`에
병합된 안전한 메시지 렌더러를 공통/리포트 체크포인트와 함께 반영했고 `ProgressiveReply`에서도 유지한다.

총괄을 통해 전달된 최종 사용자 결정은 **기존 계약 유지, 설명을 먼저 저장한 뒤 자료 추가**다.
문서만 시작하기와 문서를 초기 질문에 연결하기는 이번 UI의 완료 범위가 아니다.

## 구현 범위

- 사건 목록은 `/cases`에서 현재 불러온 수·실제 단계·다음 행동을 표시한다. 기존 두 계정 유형의
  본인 사건 접근과 명시적 삭제 확인을 유지한다. 사건 시작은 공통 ReadingContent/PageHeader/
  Section/Select/Textarea/Button을 소비하며 전역 스타일은 공통 담당 체크포인트를 사용한다.
- 민사 준비/대응·형사 준비/대응·분야 미확인 준비/대응의 여섯 선택은 기존 purpose와 procedure로
  저장한다. 단계를 추측하지 않는다. 사건 생성 후 맥락 저장이 실패하면 생성된 ID를 유지하고
  명시적으로 맥락만 재시도한다. PUT 응답 유실 뒤 읽기 확인으로 중복 생성을 피한다.
- 대화·자료·리포트·문서 초안은 기존 URL에서 같은 Workspace의 보관된 작업으로 이동한다.
  직접 리포트 진입도 Workspace를 사용하며 기존 query/hash와 브라우저 뒤로가기를 유지한다.
  리포트 구현과 직접 route는 03 체크포인트를 소비한다.
- 자료 파일 선택은 업로드 준비다. 동의와 명시적 업로드 뒤 접수·추출·실패·재시도 상태를 구분한다.
  현재 revision의 사실 참조가 있을 때만 대화 근거 연결을 표시하며 전체 분석 완료로 표현하지 않는다.
- '이 자료로 질문하기'는 자료 ID 선택과 대화 복귀만 수행한다. 리포트 발췌도 별도 제거 가능한
  질문 맥락으로 보관하고 기존 입력을 덮지 않는다. 실제 보내기에서만 기존 API를 호출한다.
- 메시지/타임라인의 자료 출처는 FileReview에서 정확한 revision과 추출 위치를 대조한다.
  변경된 revision이나 확인할 수 없는 범위를 알리고 원문 private 경로를 유지한다.
- 기존 모델/레거시 `open_lawyers` 제안은 실행 전에 지원하지 않는 동작으로 안내한다.
  변호사 컨택과 네트워크 호출을 복원하지 않는다. 계정과 본인 자료 접근은 별개로 보존한다.

## 현재 API로 할 수 있는 것

| 동작 | 근거 | 한계 |
| --- | --- | --- |
| 준비/대응 목적과 설명으로 사건 등록 | `src/contracts/v2/rework.ts`, `packages/api-client/src/rework.ts` | 설명 필수. 생성 DTO에 procedure나 files 없음 |
| 질문 시작 전 사건 등록 | `src/server/modules/rework/case-context.ts`, `src/server/db/v2-workspace.ts` | collecting 상태·new_case receipt 등록. 등록 자체가 AI 질문 시작은 아님 |
| 민사/형사·입장·진행 단계 확인/수정 | 기존 `getContext`/`updateContext` | 현재 revision·소유권·동의·실행 중 job fence 필요. UI 선택만으로 저장 성공 아님 |
| 최대 2차례×각 3문항·모름/건너뛰기·답변 저장/재개 | `IntakeQuestions.tsx`, `src/contracts/v2/common.ts`, `workspace/pipeline.ts` | 질문 생성은 명시 advance. 0문항 출력/자동 skip 지원으로 해석하지 않음 |
| private 자료 등록/처리/추출 교정/원본 확인/재시도 | 기존 files client·FileReview·useEvidenceUpload | 업로드 ACK, 처리 ready, 추출 검토, 사실 연결은 서로 다른 상태 |
| 선택 자료로 명시 대화 전송 | `Workspace.tsx`, `workspace/materials.ts` | 자료 선택/질문 준비만으로 전송하지 않음. 처리 범위는 전체 문서를 보장하지 않음 |
| 같은 화면의 자료 원문 검토 | Workspace의 FileReview 모달 | 같은 React 트리여서 미전송 입력·File·선택 유지. 별도 페이지/새로고침 복구와 다름 |

### 문서 시작에 필요한 후속 계약

기존 사건 등록은 질문 실행과 분리되어 있다. 그러나 현재 생성에는 narrative가 필수이고,
현재 웹 Workspace의 새 자료 입력은 active 사건을 기준으로 한다. 서버 파일 경로의 일부
intake 지원만 보고 완성된 문서 우선 intake라고 표시할 수 없다.

질문 실행도 full WorkspaceContext를 읽지만 자료 선택은
`context.ts`의 `conversationMaterialIds(latest, messages)`에 따른다. 처음 intake에는
자료를 선택한 user message가 없으므로 업로드 목록만으로 문서가 intake에 포함되지 않는다.
`precedent_comparison` profile의 빈 자료 projection은 별개이며 이 판단의 근거가 아니다.
현재 질문 prompt/출력과 요약 검증의 단일 출처·참조·중복 질문 감사도 함께 유지해야 한다.

따라서 다음 계약은 총괄/서버 소유자의 후속 작업으로 분리한다.

1. 설명 없이 문서만 등록하는 admission 또는 설명 필수 상태를 드러내는 진입 계약.
2. 질문 전 처리 완료한 자료·정확한 file revision/coverage·사용자 교정의 intake context 연결.
3. 추출 결과 확인과 새 질문의 구분 및 0회 질문/요약 확인의 명시 조건.
4. 상대 주장/본인 설명/자료 기재의 출처를 지키는 요약 publication과 구형 client 호환.

설명에 문서 OCR을 몰래 합치거나 가짜 설명을 생성해 문서 전용 시작을 흉내 내지 않는다.
자료가 없는 대응은 기존 설명 입력으로 지원한다. 소장·고소장 제출을 필수 조건으로 만들지 않는다.

## 화면/액션 제안

| 화면 | 먼저 전달할 가치 | 명확한 다음 행동 |
| --- | --- | --- |
| 사건 목록 | 지금 이어갈 사건·실제 단계·마지막 저장 시각 | 답변 이어가기/요약 확인/사건 열기 |
| 사건 시작 | 설명과 자료를 구분해 사실·쟁점·준비할 일을 정리 | 현재 지원하는 설명 입력·준비/대응 선택 후 저장 |
| 질문 | 이미 저장한 답변을 사용하고 부족한 내용만 확인 | 실제 차례·차례 안 문항 수·모름/건너뛰기 |
| 대화 | 내 설명을 보완하고 자료/리포트로 확인 가능 | 보내기. 보조 질문은 기존 입력을 보존해 작성 준비만 수행 |
| 자료 | 업로드·추출 결과와 원문을 대조 | 자료 추가/처리 재시도/추출 검토/원문 확인 |
| 자료로 질문 | 어떤 자료를 다음 대화에 사용할지 확인 | 선택+작성 준비. 실제 메시지 전송은 별도 보내기 |

자료 `ready`를 검토 완료나 분석 전체 반영으로 표시하지 않는다. `materialState`가 증명하는
정확한 file revision의 사실 연결과 변경 후 재반영 필요를 표시할 수 있다. 검토를 읽기만 한
행동으로 저장/확인 receipt를 만들지 않는다. 상대 주장과 사용자 진술을 확인된 사실로 바꾸지 않는다.

## 작업 전환과 보존

총괄 방향에 따라 Workspace에 ReportReview를 처음 방문할 때 mount한 뒤 같은 React 트리에서
숨김/표시한다. 공통 내비게이션은 01의 callback을 소비한다. 새 router·전역 상태 라이브러리·
임시 저장 API·DB를 추가하지 않는다. 기존 직접 URL은 보존한다.

| 대상 | 같은 사건 작업 전환에서 유지할 것 | 전체 페이지/새로고침 한계 |
| --- | --- | --- |
| 대화 | 미전송 text, 조합 중 입력, 선택 자료 ID, File 객체, 업로드 접수 상태, 메시지/커서/스크롤 | 메모리 전용 미전송 내용의 영구 복구를 약속하지 않음 |
| 자료 | 업로드/처리 receipt, 원본 보기, 추출 교정 내용·검토 위치 | File 이름/오래된 URI로 기기 원본을 복원했다고 표시하지 않음 |
| 리포트·초안 | 한 ReportReview 인스턴스의 편집·사진·가림·초안·선택 위치 | 기존 저장/검토 완료 의미를 임시 저장으로 재해석하지 않음 |
| 보안 | owner/동의/삭제·늦은 응답 fence | 계정 변경에는 기존 purge 우선. 다른 사용자에게 이전 private 입력 노출0 |

외부/다른 사건/전체 페이지 이동은 현재 보관 가능한 범위를 사실대로 설명한다. 미업로드 File이
복구되지 않는 이동에는 머무르기·자료에서 업로드 준비·첨부 선택을 버리고 이동을 제공한다. 업로드/전송을
이동이 촉발하지 않는다. 자료 추가 실패에는 현재 선택과 메시지를 유지한다. 읽기만 한 이동에는
새 AI/법률 조회·검토 receipt·정본 저장이 없다. 충돌/부분 저장은 보존한 입력과 재시도·확인 경로를 표시한다.

비활성 작업의 viewport 측정·focus refresh·주기 polling은 active와 실제 작업 필요를 기준으로
조정한다. 숨김 때문에 서버 작업이 취소/완료된 것으로 간주하지 않고 복귀 때 현재 상태를 읽는다.
계정 변경과 beforeunload 가드는 비활성 상태에서도 유지한다.

## 참고한 토스 공식 원칙

[토스 제품 원칙](https://toss.im/tossfeed/article/tossproductprinciples)의 Value First,
Clear Action, Easy to Answer, Explain Why를 적용 대상으로 삼았다. BARO 적용은 입력 전에
얻을 결과를 설명하고, 문서에서 알 수 있는 내용의 반복 질문을 줄이며, 버튼에 다음 동작을
나타내는 것이다. 외형·브랜드·카드 구조를 복제하는 근거로 사용하지 않는다.

[토스플레이스 UX 라이팅](https://docs.tossplace.com/guide/front-integration/plugin/design/ux-writing.html)은
독자 상황, 행동을 예측할 수 있는 버튼, 오류 후 가능한 다음 행동을 강조한다. BARO에서는
실패 원인을 추정하지 않고 저장/미저장 범위와 재시도·원본 확인 같은 실제 행동을 안내한다.

## 검증 계획과 현재 증거

합성 데이터로 설명 시작·문서 API 한계·자료 없는 대응·추출 실패/재시도·긴 대화/이력·
원문 왕복·메시지 실패/충돌·리포트 편집·실제 File 유지·모바일/한글 IME를 검증한다.
owner 전환, 처리/응답 지연과 중복 실행0을 포함한다. 실제 외부 AI/OAuth·법률 인수와 구분한다.

- Bun 1.4.0 frozen `bun ci`: 1,079 packages, lock 변경 없음.
- `bun run work:next`: 그래프 56/no cycles, 읽기 전용 GitHub 조회 성공.
- 위 기준 SHA의 기존 집중 검사: `conversation-report-contracts`, `intake-followup-limit`,
  `evidence-state`, `conversation-upload`, `customer-processing-progress`: 43 PASS / 0 FAIL,
  202 assertions. 새 UI 구현의 인수 결과가 아니다.
- 구현 뒤 저장소 필수 quick·필요 build 및 실제 변경 브라우저 검사를 실행하고 정확 SHA를 기록한다.
- Workers·API 경계·비용 관측 전용·AI200/일·질문2×3·권한/보안·원장/hold는 유지한다.
