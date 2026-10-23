# RN + Expo 모바일 실행 계획

- Status: M1/M2·M8 local native runtime/내부 전달 독립 인수; M3~M7 구현 통합 / 전체 실제 여정·기기·릴리스 #334 진행
- Updated: 2026-10-24 KST
- Tracking: native 인증 [#346](https://github.com/creno-va/baro/issues/346), 전체 [#334](https://github.com/creno-va/baro/issues/334), 계획 [#328](https://github.com/creno-va/baro/issues/328), M1 [#330](https://github.com/creno-va/baro/issues/330), M2 [#335](https://github.com/creno-va/baro/issues/335), M7 토큰·primitive [#379](https://github.com/creno-va/baro/issues/379)
- Decision: [ADR-0017](../adr/0017-expo-mobile-and-shared-client-boundaries.md)
- Architecture: [공통 코드와 모바일 경계](../architecture/MOBILE-CLIENT.md)

## 1. 이번 요청과 완료 범위

사용자는 RN + Expo를 선택했고, 웹 UI 전면 개편은 다른 채팅에서 진행하므로 모바일의
공통 코드 구조와 단계별 실행 계획을 먼저 요청했다. 계획 PR329는 CI 성공 후 main
`e6401de9657f8fd062fb913fe7d3945adec068fd`에 병합했다. 이어진 직접 요청으로 M1
`apps/mobile`·Bun workspace·공통 계약 export를 #330에서 구현·인수했다. 로그인·실기기·
스토어 출시 인수와 구분한다.

이후 사용자가 모바일 네이티브 앱 전체 완성을 지속 목표로 지시했다. #334에서 M2~M8의
전체 기능·기기·배포 인수를 추적한다. 단계 일부나 합성 테스트 통과를 전체 목표 완료로
축소하지 않는다. 독립 구현을 계속하며 실제 외부·서명·스토어 결정은 구체적인 결과물과
필요 필드를 마련해 요청한다.

후속 목표는 기존 BARO 고객/변호사 기능의 iOS/Android 제공이다. 고객 핵심 흐름을 먼저
완성하고 기본 UI로 기능을 검증한 뒤 모바일 시각 디자인을 정교화한다. push 알림,
오프라인 편집 동기화, 생체 인증, 새로운 결제/구독, 팀 공동 편집은 초기 범위에 추가하지
않는다. 이후 요청 시 별도 범위를 정한다.

기존 Workers API·자료 처리·공급자 경계와 v1 읽기/삭제를 유지한다. AI200/일·질문2×3·
소유권/동의/CSRF·revision·삭제·실제 기술 상한은 모든 단계에 적용한다. 비용 관측
unknown/stale·가격/재원/월할당·수동 refresh·비용 IO 예약으로 기능이나 배포를 막지 않는다.
[현행 비용 정책](../operations/PREBETA-COST-POLICY.md)을 그대로 적용한다.

## 2. 실행 순서와 단계별 인수

아래 M 번호는 계획 식별자이며 GitHub 이슈 번호가 아니다. 각 단계 착수 때 실제 이슈와
소유 경로·선행 PR·검증을 등록한다. 기존 작업이 있으면 재사용한다. 여러 에이전트나 새
채팅을 자동 생성하지 않으며 실제 선행 구현의 CI 성공/main 병합 후 의존 코드를 시작한다.

| 단계 | 선행 | 구현 산출물 | 단계 완료 기준 |
| --- | --- | --- | --- |
| M0 구조·범위 | 사용자 RN/Expo 결정 | ADR, 코드 공유·소유권, 실행 계획 | 문서 검토와 링크/형식 검사; 앱 구현 완료와 구분 |
| M1 앱 기반·계약 | M0 문서 통합 | Bun workspace, `apps/mobile`, contracts package export, 환경·router·기본 UI·독립 typecheck | 기존 웹 quick/build와 iOS/Android 개발 빌드, 계약 import·bundle 경계 확인 |
| M2 공통 client | M1 | transport 주입 API client, 순수 client-core, 웹 facade의 점진적 연결 | 웹/모바일 adapter의 동일 wire·오류·멱등성·revision fixture 회귀 |
| M3 인증·보안 실연결 | M1 + M2 transport | Better Auth Expo, 세션 IO·로그인 복귀·역할/동의, mutation guard, Turnstile adapter | 두 OS 로그인/복귀/만료/전환·동의 저장·사건 생성; 합성 통과와 실제 제공자별 결과 분리 |
| M4 고객 핵심 | M2 + M3 연결 | 사건 목록/생성·질문·요약 확인·workspace 채팅·타임라인·행동 | 앱 종료 후 서버 저장분 재개, 실패·재시도·충돌·계정 전환·v1 읽기/삭제 |
| M5 첨부·리포트 | M2 + M3; 통합은 M4 | 사진/파일 선택·upload/job 복원·자료 교정/제외·PDF 열기/공유 | 실제 파일 byte/hash·처리 상태·출처/coverage·리포트 선택·취소/삭제·메모리 한계 검증 |
| M6 기존 기능 범위 완성 | M4 + M5 | 판례 탐색/원문, 변호사 목록/프로필/직접 연락·본인 편집/공개, 사용량·설정·계정 삭제 | 고객/변호사 역할별 시연표, 소유권/동의/공개철회·재인증·삭제 회귀 |
| M7 모바일 UI 정교화 | M4~M6 + 디자인 인계 | 토큰 정본 전환, RN 컴포넌트·화면/탐색·키보드/접근성 정교화 | 대표 화면·모든 상태·한글 입력·글자 확대·VoiceOver/TalkBack·회전/화면 크기 검증 |
| M8 통합·배포 인수 | M1~M7 구현 통합 + 실제 외부 조건 | 서버/앱 호환표, 내부 배포·기기 행렬, 스토어 제출 준비와 릴리스 기록 | 정확한 앱 build·대상 API SHA별 회귀/실제 smoke, 서명/정책/스토어 요구 확인 후 수동 배포 |

M3의 실제 OAuth가 미완료여도 M4~M6의 독립 model·fixture·기본 화면 구현은 가능하다.
해당 화면을 실제 API로 연결하기 전에는 M3의 구현 선행을 통합한다. M5의 파일 IO 실험은
M2 이후 별도 합성 입력으로 진행할 수 있다. M7의 primitive·토큰 의미 설계도 M1부터
가능하며, 최종 디자인 인수는 기능 상태를 모두 렌더할 수 있게 된 뒤 한다.

첫 내부 시연은 M4에서 로그인→사건 생성/재개→질문/요약→채팅을 끝까지 제공한다.
M5를 합치면 사진 첨부→처리 확인→리포트 공유까지 이어진다. M6 전에는 앱 전체 기능
완료로 표현하지 않는다. 외부 검증이 남은 이슈는 OPEN으로 보존하되 그 이슈의 종료를
독립 구현 선행으로 요구하지 않는다.

## 3. 단계별 작은 PR 분할

### M1: 웹 이동 없이 앱 추가

1. 최신 main·열린 PR·`bun run work:next`·선행 CI를 확인한다. 웹 UI 담당이 수정 중인
   root `package.json`·lockfile·공유 계약 변경을 먼저 통합한다.
2. `src/contracts` package export와 workspace/독립 tsconfig를 한 기반 PR로 도입한다.
   공통 라이브러리는 DOM·React·Workers 타입 없이 검사한다. 기존 Astro 타입 검사가
   RN 코드를 잘못 포함하거나 반대로 RN 검사가 빠지지 않도록 검사 경로를 분리한다.
3. Expo 앱 shell·Expo Router·개발 환경·test composition·기본 RN UI를 추가한다.
   SDK/RN/React·native library 조합은 이때 공식 호환표와 실제 빌드로 고정한다.
4. 모바일 개발 빌드/단위·컴포넌트 검사와 기존 quick/build를 CI에 구분해 연결한다.
   `validate:native`는 기존 파일 처리기 검사이므로 모바일 빌드 증거로 사용하지 않는다.

M1 구현 명령은 `contracts:check`, `mobile:check`, `mobile:bundle`, `mobile:native`다.
자동 quick은 타입·import 경계·계약/환경·RN 컴포넌트만 검사한다. native 컴파일은 별도
수동 `Mobile native builds (manual)` workflow에서 정확한 main SHA로 실행한다.
[앱 개발 안내](../../apps/mobile/README.md)를 따른다. EAS 계정·유료 서비스·자동 배포를
필수 전제로 만들지 않는다. 기존 `validate:native`는 서버 자료 처리기용이다.

### M2: 공유 코드는 한 모듈씩

먼저 오류/DTO/상태 변환과 session transport를 분리한다. 그 뒤 사건·workspace·자료·
리포트·디렉터리를 각각 작은 PR로 추출한다. 하나의 거대한 API 이사 PR을 만들지 않는다.
초기 M3은 필요한 session/consent/case-create transport만 선행하면 시작할 수 있다.

웹은 기존 `src/client/api` facade를 유지해 새 패키지를 소비한다. 모바일은 browser facade를
직접 import하지 않는다. 동일 fixture로 response schema, 동일 key/body 재시도, revision
충돌과 stale 응답 거절을 검증한다. 앱 instance의 cache/key가 다른 계정으로 넘어가지
않음을 검사한다. UI 데이터와 서버 권한 정본을 구분한다.

### M3: 첫 기술 검증과 별도 결정

| 확인 항목 | 증거 | 실패 시 다음 행동 |
| --- | --- | --- |
| Google/Naver/Kakao OAuth | 제공자·OS·build·서버 SHA, 취소/cold/warm 복귀 결과 | callback/등록 설정과 재현 조건 기록; 키 없는 fixture 구현은 계속 |
| auth 외 Hono API의 cookie 갱신 | session→동의/역할 mutation→만료/로그아웃 왕복 | transport/guard 계약 수정; Origin/CSRF 전역 해제 금지 |
| 실제 최근 OAuth와 재인증 | 서버에서 확정된 freshness로 계정 삭제 경계 검사 | callback 방식에 맞춰 서버 hook 조정, client 시각 신뢰 금지 |
| Turnstile 새 사건 생성 | 두 OS 제한 challenge 화면→server verify, 만료/취소/재사용 거절 | WebView/domain/CSP 조건 수정; 앱 전용 무검증 우회 금지 |
| iOS 로그인 심사 요구 | 현행 Apple 4.8과 BARO 로그인 흐름 대조 | 별도 결정 항목으로 기록; 새 공급자는 직접 승인 전 추가하지 않음 |

기존 소셜 로그인 구성으로 App Store 요구를 충족하는지는 인증 단계에서 확인한다.
Apple 4.8의 추가 로그인 선택지 요구와 예외를 검토하고, 필요 시 Sign in with Apple 등
구체적인 변경안을 준비한다. 이를 막연한 모든 개발 중단 조건으로 사용하지 않는다.
[Apple App Review Guidelines 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)

### M4~M6: 기본 화면으로 실제 흐름 완성

- loading/empty/error/offline/consent/permission/pending/conflict를 각 화면의 fixture로 둔다.
- 저장 전 draft와 서버 revision을 분리한다. 전송 응답 유실 후 중복 AI/자료 작업을 만들지 않는다.
- 앱 foreground에서 fresh 세션·owner·동의·현재 job을 조회한다. background polling은 중단한다.
- 자료는 선택·업로드·처리·검토·분석 제외·삭제를 구분하며 미처리/누락을 완료로 보이지 않는다.
- 리포트는 사용자가 확인한 사진/마스킹/제외와 실제 서버 결과를 따른다. 외부 공유는 사용자가 수행한다.
- 변호사 역할 선택을 자격 확인으로 표시하지 않는다. 공개/철회·직접 연락과 기존 프로필 범위를 따른다.
- v1 사건의 읽기/삭제를 지원하고 앱 진입을 이유로 자동 재분석하지 않는다.

M5는 우선 사진·문서의 전체 흐름을 연결하고 기존 지원 음성·영상/대용량은 별도 측정
항목으로 완료한다. 작은 fixture 성공을 현재 최대 크기 처리 성공으로 확대하지 않는다.
기존 자료·리포트 API의 미완료 실제 인수는 해당 이슈와 #71에 그대로 남긴다.

### M7: 기능 로직을 보존하며 UI 교체

웹 개편 담당의 토큰/브랜드 인계 commit, 대표 화면, 상태 의미를 받아 모바일에 맞춰 적용한다.
웹 컴포넌트를 복제하지 않고 모바일 `ui`/`theme`/feature `ui`를 바꾼다. layout·navigation
개선이 model 조합을 바꿔야 하면 API 변경과 분리해 검증한다. 최초 토큰 정본 전환만
웹 담당과 함께 확인하고, 이후 색상/간격 변경은 동일 정본에서 두 출력을 생성한다.

완료 검사는 실제 기기에서 긴 한글 문장/키보드·첨부 바·스크롤·safe area·뒤로가기,
큰 글자·screen reader·대비·reduced motion을 포함한다. screenshot만으로 기능 또는
접근성 인수를 대신하지 않는다. M4~M6의 같은 시나리오가 UI 교체 전후 통과해야 한다.

## 4. 검증과 릴리스

M8 내부 전달은 기존 수동 native preview 빌드에서 APK/Simulator app ZIP과 실제 binary
metadata/signature·전체 byte/hash receipt를 남긴다. 설치/Metro 연결은 [앱 안내](../../apps/mobile/README.md)의
내부 preview 개발 앱 절차를 따른다. 앱 source와 패키징 시점 API health SHA 관측을 분리하고
`runtime-smoke-required`로 유지한다. Simulator/개발 client를 물리 iPhone/standalone/store 앱으로
표현하지 않으며 실제 물리 기기·원격 API/OAuth·#339/#71의 인수를 생략하지 않는다.

공통 변경은 repository 기준의 `bun ci` → `bun run validate:quick`과 관련 실패 회귀를
수행한다. 웹 bundle에 영향이 있으면 `validate:build`, schema 변경이 실제로 있을 때만
기존 DB 담당과 `validate:db`를 수행한다. 전체 브라우저·처리기 native 검사를 모바일의
단순 화면 수정마다 반복하지 않는다. CI에는 유료 모델/실제 개인정보 호출을 넣지 않는다.

| 변경 | 필요한 추가 검증 |
| --- | --- |
| 공유 패키지/계약 | 웹·모바일 타입/번들, DOM/서버 import 경계, 지원 중인 이전 앱 fixture |
| 인증/guard | 기존 웹 OAuth/CSRF/역할/동의/삭제 회귀 + native 세션 HTTP + 두 OS 복귀 |
| 첨부·PDF | 실제 파일 byte/hash, 단위 chunk, 메모리, 중단/재개/삭제/공유 후 cache 정리 |
| 모바일 UI | 컴포넌트 상태, 기기 키보드·글자 확대·접근성, 변경 흐름 E2E |
| 최종 후보 | 통합 서버 SHA의 기존 수동 full, 앱별 native release build, 실제 환경의 제한 smoke |

모바일 릴리스 기록에는 source SHA, 앱 version/build number, OS·기기, Expo/RN 조합,
대상 API 환경/SHA, API 계약 호환 범위, 검사 결과와 미완료 항목을 적는다. 두 플랫폼이
같은 시점에 스토어 승인된다고 가정하지 않는다. 앱 업데이트 전후와 이전 앱/새 서버
조합을 검사하고 서버 rollback이 지원 앱을 깨지 않는지 확인한다.

서버 변경은 기존 동일 SHA preview→production 및 #71 운영자 receipt를 유지한다.
모바일 배포는 별도 수동 절차이며 앱 식별자·서명/개발자 계정·개인정보 표시·권한 설명·
계정 삭제·스토어 로그인 요구를 확인한다. 제출 준비 완료, 내부 기기 검증, 스토어 승인과
공개 출시는 서로 다른 상태다. 앱 OTA는 초기 필수 범위에 넣지 않고 향후 도입 시 native
runtime 호환과 롤백/수동 배포 기준을 먼저 정의한다.

## 5. 작업 소유권과 다음 착수 단위

웹 UI 담당은 `src/pages`, `src/components`, `src/layouts`, `src/styles`를 계속 소유한다.
모바일 담당은 `apps/mobile/**`를 소유한다. `src/contracts`, `packages`, root package/lock,
CI, 기존 client facade는 한 공유 기반 PR 담당이 순서대로 통합한다. 인증/자료/DB는 기존
모듈 소유권을 유지한다. 같은 파일에 열린 PR이 있으면 먼저 통합하고 그 main을 기준으로
작업한다. 다른 채팅에 자동 메시지를 보내지 않고 이 문서를 인계 자료로 제공한다.

M1 #330과 M2 #335는 인수·종료했다. M3~M7의 인증/기능 model·공유 client·native adapter와
모바일 화면 구현은 main에 통합됐고 M8 local runtime·내부 전달을 독립 인수했고 현재 잔여는 실제 여정·전체 UI/기기·릴리스다.
구현 통합을 실제 역할별 사용자 여정·물리 기기·전체 접근성·스토어 인수 완료로 확대하지 않는다.
아래는 2026-10-24 KST의 관측 범위이며 실행별 최신 증거는 [실행 기준](./EXECUTION.md)과
연결된 원본 receipt/이슈를 따른다. 아래 M0/M1 조사·이전 실행 기록은 당시 사실로 보존한다.

| 범위 | 인수한 사실 | 남은 실제 인수 |
| --- | --- | --- |
| 공통 기반 M1/M2 | workspace·순수 wire/schema·client-core/API client·플랫폼 IO 경계와 회귀, 두 OS 개발 빌드 | 새 앱/기존 서버의 실제 인증된 전체 여정과 최종 후보 호환표 |
| 인증 M3 / #346 | 기존 계정을 보존하는 native session/credential·역할/동의·로그인/재인증/로그아웃·challenge 연결. [현재 preview HTTP 진입](../quality/MOBILE-NATIVE-AUTH-2026-10-24.md)은 세 제공자별 시작200·canonical authorization·프록시302/동일 목적지/browser state 설정 확인 | 제공자 페이지/실제 계정 인증·두 OS cold/warm 복귀·만료/전환·두 역할/동의·실제 Turnstile. HTTP 진입 관측은 실제 OAuth 성공이 아님 |
| 기능 M4~M6 / #354/#361/#369 | 사건/workspace·자료/리포트·판례/공개 탐색·본인 프로필/설정의 model·HTTP·RN·native adapter 구현/합성 회귀 | 실제 인증 계정의 저장/재개·처리/공유/열기·철회/삭제와 실제 기기 picker·장애/취소 |
| 모바일 UI M7 / #379 | 웹 정본 토큰/primitive/폰트/브랜드와 source171989e의 실제 두 OS Home·글자 확대·Guide 왕복/교정 문구 인수. iOS40009294558 Home5/Guide6 scroll·hittable tap, Android40014252649 font2·Home/Guide 각1회 scroll/tap·캡처 차단·Metro0. 후속 iOS40020635912는 Home4/Guide6 조작 및 최대 글자 네 viewport의 [일곱 OS audit 요청·보고 issue0](../quality/mobile-internal-ios-2026-10-23/accessibility-90a2f58.json) | 해당 홈/안내 viewport 밖의 전체 역할/화면/상태·키보드/회전·VoiceOver/TalkBack·물리 기기와 실제 인증된 여정 인수 |
| 앱 IPC/IO M8 / #385 | Android c2fa3f2/39916204937와 iOS local9a369bc/39996169996의 실제 계측 Home·100MB upload/1GB download 전체 byte/hash·native IPC/SDK/SecureStore·취소/owner/401/Origin·파일0개 정리. 별도 source·RSS·signing/PNG 실물 대조 | 독립 local runtime 범위 인수. 실제 picker/공유·원격 API/OAuth·전체 제품 여정/접근성·physical/store/#339/#71/#334는 별도 |
| 내부 전달 M8 / #397 | 기존 dedcd0e/ff5c208의 인수를 보존하고 새 source171989e 두 OS Release compile/원본 hash 인수. iOS actual40009294558은 Home/최대 글자/Guide 왕복 성공. Android actual40014252649도 Home/font2/Guide 왕복 성공. 이전40011547920의 final receipt 실패는 별도 보존 | 독립 내부 전달 범위 인수. 두 OS 실제 폰·전체 private 여정·store 서명/승인과 #334/#379/#346/#339/#71은 별도 |
| 보안/전체 릴리스 / #339/#71 | 원본 version/SRI/LICENSE를 보존한 CJS 보완·실제 consumer/회귀·배포 증거의 분리 | raw node-forge high1건과 browser dist/map 잔여·최종 후보 full/preview/운영자 승인·법률/외부/스토어 인수 |

iOS full runtime의 [이전 실패](../quality/mobile-runtime-2026-10-23/failure-ios-80e538c.json)와
[별도 SDK 성공](../quality/mobile-ios-host-2026-10-23/sdk-80e538c.json)을 함께 보존한다.
원본 바이너리와 tooling/JS source를 구분하고 HTTP bundle 수신만으로 앱 실행을 인수하지 않는다.
준비된 전달물은 [내부 preview 절차](./MOBILE-INTERNAL-PREVIEW.md)를 따르며 Simulator ZIP은
iPhone IPA/스토어 앱이 아니다. 실제 폰 모델/OS·기존 개발자/배포 계정은 사용자 확인 대기 중이며
부재로 단정하지 않는다. 현재 M8 검증은 웹 UI·제품/native 입력을 유지한다.

2026-10-24 KST [보안 후속 관측](https://github.com/creno-va/baro/issues/339#issuecomment-6368313820)에서
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)의 철회 시각
2026-10-23T12:53:02Z를 확인했다. 이는 patch release나 기존 depth guard 제거 근거가 아니다.
[node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)는 active/first_patched_version=null,
원본 audit는 high1건/exit1이다. 과거 full39926453700/f912441의 당시 high2건 실패는 수정하지 않으며
동일한 보안 blocker에서 변경 없는 full 재실행이나 raw gate 우회를 하지 않는다.

## 6. M0 계획 당시 조사·검증 기록

- 작업 브랜치: `codex/328-mobile-architecture-plan`.
- 조사/분기 기준: clean `origin/main` = `bdc50a0af2f9adb3a6864f7cccf0983dcac771ee`.
- GitHub 연결로 열린 PR과 mobile/Expo 관련 이슈를 확인했다. Expo 이슈는 없었으며
  별도 웹 개편의 존재는 사용자 지시를 따른다. 검색 결과만으로 다른 작업이 없다고 단정하지 않는다.
- `bun run work:next`는 Bun 미설치로 실행 실패했다. GitHub 쓰기 연결도 403으로 거절되어
  기존 GitHub CLI로 #328을 만들고 시작/브랜치를 기록했다.
- `bun ci`, `bun run validate:quick`도 `bun: command not found`로 실행 실패했다.
  Python으로 전체 Markdown 106개의 상대 링크·끝 개행·후행 공백·ADR metadata를 검사해
  오류 0건을 확인했다. `git diff --check`도 통과했다. 이는 repository quick 성공을 뜻하지 않는다.
- 기준 SHA의 GitHub Quality gate는 성공, 별도 Full validation은 실패 상태였다.
  이 문서 작업에서 기존 full 실패를 수정/성공 처리하지 않으며 제품 코드도 시작하지 않는다.
- 기능 구현·SDK 버전 확정·native build·실제 OAuth/파일·스토어 제출·배포는 아직 수행하지 않았다.

## 7. M1 구현과 검증 기록

- 브랜치 `codex/330-expo-foundation`, 기준 main `e6401de9657f8fd062fb913fe7d3945adec068fd`.
- PR329는 최신 main 통합 head `e680cc533a615a1a6375b5506b50cb66b1550479`의
  [Quality gate](https://github.com/creno-va/baro/actions/runs/39770609573) 성공을 확인하고 정상 병합했다.
- Bun 1.4.0과 Node 24.22.1을 임시 도구 경로에 준비한 뒤 `bun ci`, `bun run work:next`를
  실행했다. 기존 작업 그래프 56개·cycle 없음. 열린 모바일 구현 PR이 없어 #330을 등록했다.
- Expo SDK 58.0.17, RN 0.88.0, React 19.3.0을 고정했다. React 버전은 기존 웹과 동일하다.
  workspace의 이전 isolated 설치를 정리한 hoisted 설치에서 Expo doctor 20/20 통과했다.
- 웹 번들러의 상대경로 directory import를 보존하기 위해 package `main`은 기존 `index.ts`를
  유지하고 public package export는 `/v1`, `/v2` 등 명시적 subpath만 제공한다. bare package
  root와 pipeline은 공개하지 않는다. 기존 웹/서버 import 142곳을 일괄 수정하지 않는다.
- 구현 PR331은 [PR head CI](https://github.com/creno-va/baro/actions/runs/39772663202) 성공 뒤
  main `d75701860f3809b20e1ec5456a947f2b77fae1a9`에 병합했다.
  [수동 full](https://github.com/creno-va/baro/actions/runs/39772951000)은 단위·DB·웹 build 뒤
  Playwright의 workspace directory import 해석에서 실패했다. 이를 재현하고
  `src/contracts.ts` 호환 barrel로 기존 호출부를 보존했다. 수정 후 테스트 수집 437개/44파일
  통과. full 재검증은 수정된 main SHA에서 수행하며 실패 이력을 성공으로 덮지 않는다.
- 현재 로컬 검증: 독립 typecheck, public 계약 19개 모듈의 transitive 경계, 계약/환경 회귀
  5개와 RN 컴포넌트 4개, iOS/Android Metro bundle 통과. 최종 커밋의 quick/build·CI 증거는
  #330 및 구현 PR에 기록한다. bundle 통과를 native 컴파일로 표현하지 않는다.
- 로컬에는 전체 Xcode·Android SDK·JDK가 없어 native 컴파일은 수동 GitHub workflow로
  인수한다. native 성공 receipt 전까지 #330을 OPEN으로 유지한다. 실제 기기·외부 로그인·
  자료 처리·스토어 제출·공개 배포는 이 단계에서 수행하지 않는다.

## 8. M1 인수와 M2 진행

- [native39772947035](https://github.com/creno-va/baro/actions/runs/39772947035)는 앱 source
  `d75701860f3809b20e1ec5456a947f2b77fae1a9`의 iOS simulator Debug·Android debug 모두 성공.
  두 receipt의 SHA/preview/Expo58.0.17/RN0.88.0을 확인했다. 스토어 서명·배포는 수행하지 않았다.
- 호환성 PR333은 main `6e6fd9c2c59f291ed388b321ecf6aaad5f14936d`에 병합, main CI 성공.
  앱·공개 계약 실행 소스는 native 검사 SHA와 동일했다. #330은 M1 범위로 종료했다.
- [full39775420895](https://github.com/creno-va/baro/actions/runs/39775420895)는 브라우저
  161개 통과 뒤 production workerd 시작 시 schema chunk 초기화 순서 오류로 실패했다.
  검증된 선행 PR338(main `6a60587`)의 같은 phase enum common 추출을 통합해 files의
  workspace/job 초기화 의존을 제거했다. wire 값은 보존한다. M2는 `validate:build`에 실제 로컬 workerd
  시작/익명 로그인 HTML 검사를 추가해 dry-run만 통과하는 회귀를 잡는다.
- 브랜치 `codex/335-shared-client-foundation`, 기준 main `6e6fd9c`.
  공통 DTO/progress·안전한 오류·주입 HTTP·session/consent·directory를 추출하고 기존 웹
  facade가 소비한다. 모바일 공개 목록은 실제 API adapter를 사용하며 취소·새 검색·cursor
  오류·재시도·페이지 추가를 model에서 처리한다. 인증/사건 연결은 M3~M4에서 계속한다.
- 추가 `bun audit`는 upstream 미패치 advisory 3건으로 실패했다. npm 최신 버전에도 수정이
  없음을 확인했으며 [#339](https://github.com/creno-va/baro/issues/339)에서 artifact 도달성·
  검증된 보완/patch와 release 보안 인수를 추적한다. audit 실패나 전체 보안 인수를 성공으로
  바꾸지 않고 독립 기능 구현을 계속한다.
- 공통 기반 PR340은 main `0d5b984393744a271f6ef6a0d4df651fbc7327ec`에 통합했다.
  [native39782039545](https://github.com/creno-va/baro/actions/runs/39782039545)의 iOS·Android
  개발 빌드와 두 receipt를 확인했다. 실제 기기/OAuth 성공과는 구분한다.
- 다음 `codex/335-shared-cases-client`는 사건/list·intake 질문/답변·요약 저장/확인을
  `createCasesClient`로 추출한다. 웹 facade와 DOM challenge는 유지하고 해시·UUID·저장·
  challenge를 port로 주입한다. 동일 쓰기는 합치고 저장 실패 전 쓰기 차단, 재시작 후 동일
  key/revision 재사용, owner별 격리, 계정 전환 시 HTTP/challenge 취소를 검사한다.
  frozen install·quick·build(실제 workerd 시작)·두 OS Metro bundle·mobile check가 통과했다.
  사건/intake 회귀 31개와 기존 웹 저장/사건 회귀 25개를 검사했다.
  실제 native SecureStore/challenge 연결과 고객 화면은 M3~M4에서 계속한다.

- 사건/intake PR341은 CI39789064504(head `bfdbacb`) 성공 후 main
  `6a2b5008c3b1092a0cc60d3b1af08b8204199f8a`에 squash 병합했다.
- `codex/335-shared-workspace-client`는 `createWorkspaceClient`로 채팅·행동·타임라인과
  projection/pagination/revision readback을 분리한다. metadata 목록·비동기 job ID 힌트를
  주입하고 상태/멱등성 key를 instance에 격리한다. 동일 쓰기 병행 합치기·계정 전환 취소·
  저장 장애 후 서버 최신 job 복구를 검사한다. 원문은 복구 저장소에 넣지 않는다.
  관련 domain 회귀190개·브라우저 초안/복구35개·frozen install/quick/build/두 OS bundle가
  통과했다. 같은 계정에서 메서드를 감싼 참조는 유지하고, 계정 변경 시 새 instance로
  전환하도록 공통 binding 회귀도 보완했다. 앱 재시작 시 workspace 쓰기의 durable key
  복구와 실제 native IO는 후속 단계다.

- 작업공간 PR342는 CI39790764136(head `8b66c4a`) 성공 뒤 main
  `9e33f8df702cd33ac95242b177f210d4bd04b994`에 병합했다.
- `codex/335-shared-files-client`는 metadata/coverage·교정·처리/삭제·chunk 업로드를
  `createFilesClient`로 추출한다. 브라우저 File/stream hash는 facade에 남기고 generic
  source·reader/hash/part/close·download를 주입한다. 크기/해시·같은 source 병행 업로드·
  계정 전환 후 hash/원본 응답 취소를 검사한다. native picker/cache/byte IO와 앱 재시작
  업로드/교정 복구는 M5 연결 단계에서 계속한다. 관련 domain/바이트 회귀140개·웹 첨부/검토
  41개·frozen install/quick/build(실제 workerd 시작)/두 OS Metro bundle이 통과했다.

- 자료 PR343은 CI39792089726(head `969cdac`) 성공 후 main
  `a7f1601225b3759c400e7b9be500dfb1546d9f40`에 병합했다.
- `codex/335-shared-reports-client`는 리포트 생성/검토·revision·immutable ZIP 선택과
  PDF/ZIP header·HTML marker 검증을 공통화한다. platform artifact reader/discard를
  주입하고 계정 전환 중 byte/JSON 응답을 차단한다. 응답 유실 후 metadata refresh나
  선택 왕복도 원래 key/body/basis로 복구한다. source/서명 SQL/바이트 회귀75개·웹 revision
  5개/통합3개/실제 SQL PDF 다운로드1개와 frozen/quick/build/두 OS bundle이 통과했다.
  PDF 검증은 번들 Python(pypdf)을 사용했다. native cache/열기/공유·재시작 복구는 M5다.

- 리포트 PR344는 CI39793983093(head `2a2d1c8`) 성공 후 main
  `eefe3ff2aadaa117f42eaebcb248d215838ad1dc`에 병합했다.
- `codex/335-shared-account-precedents`는 사용량·삭제·서버 OAuth freshness와 재인증
  port, 판례 canonical topic/revision/read-proof client를 공유한다. 로컬 marker는 실제
  서버 freshness를 대체하지 않으며 mock 삭제 readiness는 명시 fixture만 허용한다.
  성공한 삭제는 private scope를 즉시 폐기하고 캐시 정리 실패가 삭제 재요청을 만들지 않는다.
  판례 요청도 계정/화면 전환 후 실행·응답을 차단하며 법률 upstream 호출 경계는 보존한다.
  공통/실제 SQL 삭제·사용량/판례 회귀69개·웹 설정5개/판례4개와 frozen/quick/build/
  두 OS Metro bundle이 통과했다. 사건 삭제의 과거 ZIP 응답은 새 scope 폐기에 따라
  UNAUTHENTICATED로 거절하며 원본을 새 화면으로 전달하지 않는다.

- 웹 UI PR336의 계정별 사건 요청 검사를 보존하고, 브라우저 쿠키 변경 알림 전의
  workspace/자료/리포트/삭제 요청이 이전 사용자의 pending promise에 합쳐지는 회귀를
  보완한다. 기본 쓰기는 서버 권한을 각각 확인하고, credential 교체를 scope와 원자적으로
  제어하는 adapter만 병행 합치기를 선택한다. 사건 생성은 challenge 전 owner를 실제
  서버 세션과 대조한다. hint는 거절만 가능하며 다른 계정의 권한 부여/세션 폐기는 못 한다.
  합성 두 계정의 실제 SQL/Hono challenge 전환과 네 모듈 회귀를 quick/mobile 검사에 유지한다.

## 9. M3 native 인증 기반

- #346의 server bridge PR347은 head `0a7255a` CI39806771230 성공 후 main
  `a1ad098288037f62ea0356a08d91d74f9b1ceb64`에 정상 병합했다. 기존 3사 OAuth를
  유지하고 callback에는 세션 cookie 대신 60초 일회용 code와 attemptId만 전달한다.
  verifier/S256·issuer·실제 session/owner·만료를 검사하고 app_metadata의 분리 namespace에
  암호화 저장한다. 삭제/복원/cron 정리와 기존 cookie 갱신을 보존한다. schema 변경은 없다.
- native grant 14개/실제 Better Auth·Hono·SQL 6개, quick40·빌드·DB drift/fresh/upgrade·
  두 OS Metro/Doctor20개와 기존 웹 인증/세션/설정24개를 검사했다. provider HTTP만 합성
  대역이며 실제 외부 OAuth/실기기 성공으로 표현하지 않는다. SecureStore/Network/브라우저/
  제한 WebView 의존성의 native 컴파일을 수동 workflow에서 확인한다.
- SecureStore cookie jar·cold/warm 복귀·foreground/로그아웃 coordinator와 로그인/역할/
  동의/challenge UI는 후속 구현이다. M2 프로필/자산과 M3 전체 인수를 열어 둔다.
  두 OS 개발 빌드 native39809756054는 a1ad098의 Android Debug/iOS simulator Debug 모두
  성공했다. receipt의 SHA/preview API/Expo58.0.17/RN0.88.0과 서명/배포 없음을 확인했다.
  raw audit 미패치3건은 #339에 유지한다.
  PR345의 과거 Actions success/Check Run in_progress 불일치 증거는 보존하며 실제 계정 격리
  보완·main 통합의 새 head를 다시 검사한다.

- 사용량/삭제·판례와 ambient-cookie 권한 확인 보완 PR345는 head `b89da6c`
  CI39810149876 완료를 확인하고 main `e51d4db179bb3ef48b374c4ae70ece6b3a5a1e4d`에
  정상 병합했다. 관련 domain155개·추가 공통54개·웹41개와 전용 판례4개, quick42/
  build/두 OS Metro가 통과했다. 일반 dev 설정의 판례 fixture 누락 실패는 전용 mock
  integration 설정으로4개 통과해 구분했다. M2 프로필/자산은 잔여다.
- `codex/346-native-credentials`는 환경별 SecureStore·고정 API Origin·Cookie/Set-Cookie
  갱신/만료를 연결한다. SDK 공개 codec/분할 저장을 그대로 쓰고 HTTP를 cookie의 단일
  writer로 삼는다. reset은 scope 폐기 후 인증 jar/cache만 지우며 이전 응답·저장 분할 IO가
  새 계정에 쓸 수 없다. SDK가 삼킨 저장 오류와 silent write도 readback/오류 상태로 거절한다.
  저장소가 잠겨도 공개 목록은 익명으로 조회한다. 실제 SDK 분할/expiry/중단 정리와 합성
  native transport 경계를 검사하며 브라우저 로그인/coordinator/기기 증거는 다음 단계다.

- 독립 M2 `codex/335-lawyer-public-contract`는 웹에서 사용하던 변호사 self-profile의 순수
  schema/DTO·준비/중복 저장 helper를 `@baro/contracts/v2/self-profile` 정본으로 옮긴다.
  기존 서버 경로는 호환 re-export하고 JPEG metadata byte 처리는 기존 adapter에 둔다.
  웹 facade/mock은 공개 계약만 import한다. wire·서버 의미와 웹 UI를 보존하며 이 계약을
  먼저 통합한 뒤 프로필/자산 공통 client를 추출한다. M2 전체는 아직 인수하지 않는다.
- Credential adapter PR348은 head `99dff82` CI39812154878 성공 후 main
  `86c94b2b2e2c686ff0dd72681d36161fa0303f03`에 정상 병합했다. mobile69개·RN/실제 SDK7개·
  quick42·빌드·두 OS Metro를 통과했다. native ABI 의존성/plugin은 위 a1ad098과 동일하다.
- `codex/346-native-auth-flow`는 SecureStore pending attempt/verifier의 필수 저장/readback·
  10분 만료·조건부 삭제, 엄격한 복귀 URL·nonce/code, native entropy/S256과 수동 SDK 로그인을
  연결한다. 브라우저는 고정 BARO proxy와 base return URI만 사용하며 SDK 자동 cookie 복귀와
  기본 redirect hook은 끈다. 중복 code 교환·브라우저 취소·cold 복구·계정/역할 재검증과 응답
  유실 후 새 서버 세션 확인을 port/model에서 처리한다. 실제 SDK authorization fixture를
  검사했다. 새 auth protocol14개·모바일 공통83개·RN/실제 SDK8개·quick42·production
  workerd 시작·두 OS Metro가 통과했다. 앱 복귀 routing/foreground·로그인/역할/동의 화면·
  reauth/challenge는 후속이다.

- 로그인 protocol PR349는 head `3627761` CI39815218470의 필수 check 완료를 확인하고
  main `c4f85cca65ea4c98367f17f25465221c619c915f`에 정상 병합했다. 화면/lifecycle는
  후속 검증 단위로 보존하며 실제 제공자·기기 인수로 확대하지 않는다.

- 변호사 계약 PR350은 head `5555911` CI39818163285 성공 후 main
  `8dce35dace2e3e0d0b6a8f05ec5aea371e57b5bc`에 정상 병합했다. 관련54개·main 통합
  frozen/quick/build/두 OS Metro가 통과했다. 이 계약을 소비하는 profile/assets client가 M2 잔여다.
- `codex/346-native-session-ui`는 선행 protocol의 실제 main에서 로그인·고객/변호사 선택·
  필수 정책/14세 확인·내 계정·로그아웃과 cold/warm routing/foreground를 연결한다.
  URI의 query/fragment는 route에 넘기지 않고 최대4개 임시 handoff에서 matching nonce만
  소비한다. 오래된 세션/동의/로그인 결과를 거절하고 인증 브라우저 전환이 현재 교환을
  취소하지 않게 한다. 공개 목록은 auth scope와 독립된 익명 요청으로 유지한다.
- 로그아웃은 기기 cookie를 검증해 먼저 지우고 캡처한 세션만 실제 Hono에서 폐기한다.
  실패한 원격 acknowledgement/로컬 저장은 구분하고 새 계정에 과거 응답 cookie를 적용하지
  않는다. 실제 SDK의 silent chunk+marker 손실로 orphan이 남는 회귀를 재현하여 각 raw
  쓰기를 즉시 읽어 확인하고 첫 누락 뒤 추가 fragment 쓰기를 멈추도록 보완했다.
  설치된 Expo58 native fetch와 RN의 legacy Response 생성자 조합에서도 본문 재구성 시
  JSON이 유실됨을 재현해, 원본 native receiver/clone/stream을 유지하며 cookie header만
  가리는 방식으로 수정했다. Node 응답만의 성공으로 native 응답 호환을 주장하지 않는다.
- 제공자 HTTP/브라우저만 합성 대역인 3사 통합은 실제 Better Auth·code/PKCE·Hono·SQL·
  warm 중복 복귀·role/consent/logout을 확인한다. 로컬 frozen/quick(공통/모바일102개·
  RN/실제 SDK14개·필수서버42개), production workerd 시작과 두 OS Metro가 통과했다.
  실제 제공자·실기기, reauth/challenge와
  M3 전체 인수는 잔여이며 이 단위의 체크/PR receipt를 #346에 기록한다.


- 로그인 UI PR351은 head `f8e72e4` CI39820802132 성공 후 main
  `c57761246a0841aad56307c673363b6aa88766ed`에 정상 병합했다. 해당 SHA의 native
  run39821350045 Android Debug/iOS simulator Debug가 모두 성공했다. 두 receipt의
  sourceSha/preview API와 서명·배포 없음도 확인했다. 실기기 인수는 아니다.
- `codex/346-native-challenge`는 별도 Hono HTML과 제한 WebView를 연결한다. 웹 UI와
  Astro CSP를 바꾸지 않고 응답별 nonce, 고정 위젯 action·현재 시도·private bridge secret을
  사용한다. auth cookie/사건 입력은 WebView에 전달하지 않으며 secret/token은 저장하지
  않는다. scope/feature 취소·120초 만료·실패·늦은 메시지를 폐기한다. Android의 frame/출처
  정보 한계를 secret+상위 URL 확인으로 보완하고 라이브러리 자동 외부 Linking을 막는다.
- 새 model/HTML/실제 Hono-SQL 사건 admission 9개, RN host·실제 WebView navigation helper
  4개와 제품 HTML/CSP 브라우저 4개를 합성 제공자로 검사했다. 기존 siteverify의
  hostname/action/만료·재사용/실제 공급자 실패 guard를 유지하며 실제 Cloudflare/기기
  성공으로 표현하지 않는다. frozen install·quick(모바일/공통111개·RN18개·서버42개),
  기존 사건/인증/동의48개·production build/workerd 시작·두 OS Metro를 통과했다.
  사건 화면의 port 소비는 M4, reauth와 M3 실제 인수는 잔여다.

- challenge PR352는 head `5b92068` CI39825256288 성공 후 main
  `1cd9aa59067a27787e2d89d89567e3ddacca8a31`에 정상 병합했다. M3 reauth/실제 기기 및
  M4 사건 화면의 challenge port 소비는 잔여다.
- `codex/335-shared-lawyer-client`는 M2의 남은 프로필/자산 client를 공유한다. 프로필
  공개/본인 조회·저장·공개 전환, 자산 목록/삭제·예약/원본 전송·응답 유실 복구를 추출하고
  웹 File/Blob/hash/sessionStorage만 adapter에 둔다. 모바일 프로필 JSON은 기존 native
  transport와 공통 factory를 소비한다. 실제 파일 선택/캐시/공유 IO와 모바일 편집 화면은
  M5/M6이며 이번 공통 client 인수와 구분한다.
- 업로드의 현재 소유권은 합치기 전 매번 조회하고 예약의 profile hint는 실제 인증 owner의
  SQL profile과 대조해 거절만 한다. 이전 key/revision의 멱등 replay와 asset별 실제 권한은
  유지한다. 새 불확실 기록 key는 fingerprint로 만들고, 브라우저의 기존 v1 기록은 원래
  요청 key로 복구한 뒤 성공/확정 거절에서만 정리한다. required native storage는 write/readback
  실패를 예약 전에 거절한다. scope 간 늦은 저장 IO를 직렬화하며 미해결 기록을 보존한다.


- 이 M2 단위는 frozen install·quick(모바일/공통122개·RN18개·필수 서버42개), 관련 실제
  SQL/도메인·공통 client74개와 웹 편집/복구/디렉터리37개, production build/workerd 시작,
  두 OS Metro를 통과했다. 디렉터리 취소가 일반 연결 오류로 바뀌던 추출 회귀를 기존 검사에서
  재현해 호출자의 AbortSignal을 우선 전파하도록 보완했다. 패키지/웹 facade의 공통 소비는
  session/directory/cases/workspace/files/reports/account/precedents/lawyers 전체를 대조했다.
  M2 인수는 이 순수 client/adapter 경계이며 실제 파일/기기/전체 화면 인수는 M3~M8이다.

## 10. M4 고객 사건 연결

- M2 최종 PR353은 head `1a9dce2` CI39827918942 성공 후 main
  `e49c76e88fd0d3d1b1331a423be0bfa453785ca8`에 정상 병합했다. #335의 모든 공통
  client/adapter 인수 항목을 파일·회귀로 대조해 종료했다. 실제 파일 IO/화면/기기는 후속이다.
- #354의 `codex/354-native-cases`는 인증 jar와 다른 SecureStore service/namespace에
  fingerprint key·UUID·owner/revision metadata만 저장한다. allowlist 밖 payload/손상/
  잠김/silent write/delete 손실을 거절하고 IO를 직렬화한다. 앱 사실/대화/token을 저장하지
  않으며 auth reset이 불확실 작업 key를 지우지 않는다.
- `/cases`는 고객/fresh owner/동의 gate를 통해 목록·보안 확인 생성·기존 서버 저장분 재개,
  차례별3개 답변·모름/건너뛰기·요약과 사실 text/미확인 내용 수정·확인을 연결한다. 처리
  중에만 활성 화면에서 조회하고 background/blur에서 이전 IO/조회를 중단한다. 동의/로그인
  오류는 세션을 재확인한다. 임시 중단 시 입력은 메모리에서만 보관하며 같은 owner의 fresh
  gate에서만 복원한다. 화면을 완전히 나가거나 앱을 종료할 때 미저장 내용은 사라질 수 있다.
- 사건 생성 acknowledgement 뒤 질문 조회가 실패해도 저장된 detail에 남아 새 생성을
  반복하지 않는다. POST 응답 유실은 같은 durable key로 실제 Hono/SQL에서1건만 생성함을
  확인했다. 다른 revision이 있으면 입력을 덮어쓰지 않고 명시적인 최신 내용 사용을 요구한다.
- native 모델/저장/실제 Hono·SQL 생성11개와 RN 화면2개, 기존 사건/질문/소유권38개,
  frozen/quick(공통·모바일134개·RN20개·필수 서버42개), production build/workerd·두 OS
  Metro가 통과했다. 실제 provider/Turnstile/기기 성공으로 확대하지 않는다.
- 이번 단위는 작업공간 채팅/타임라인/행동, v1 분석 상세·삭제를 아직 연결하지 않는다.
  UI에 준비 중을 표시하며 #354를 OPEN으로 보존한다. 이 후속과 M3 reauth·M5~M8을
  계속한다. native 컴파일 receipt와 실제 기기 인수는 별도로 기록한다.

- 사건/intake PR355는 head `1b838d1`의 필수 Quality gate Check Run/유일 CI job 성공 후
  main `a0d2deb9955bbb3e9fecda6f6fc00e7bc9a47aa2`에 정상 병합했다. workflow aggregate
  상태와의 차이는 #354 receipt를 따른다. 같은 SHA의 두 OS native39831543461을 요청했고
  진행 중인 기존 실행을 계속 추적한다. native ABI·스토어 서명·배포 변경은 없다.
- `codex/354-workspace-recovery`는 UI 소비 전 공통 선행이다. native가 `recovery` port를
  선택하면 현재 owner·정확한 path/body/method의 fingerprint로 UUID key를 필수 저장하고
  readback한 뒤 전송한다. 새 client도 원래 body/revision/key를 복원하며 scope 사이의
  늦은 IO를 직렬화한다. 미확인 전송을 새 revision으로 자동 재전송하지 않는다.
- 검증된 서버 acknowledgement는 후속 화면 조회 전에 `onAcknowledged`로 알리고,
  전체 조회가 성공한 뒤 key를 정리한다. 응답/후속 조회 유실은 key를 유지하고 확정된
  acknowledgement 뒤 cleanup 실패는 작업을 실패로 돌려 중복 전송하지 않는다. native
  action 편집은 선택적인 entity revision 노출과 명시적 원래 revision을 사용한다.
  기본 웹 경로/DTO와 HTTP 즉시 dispatch는 유지한다. 실패 job 재시도도
  명시적 원래 revision을 선택해 새 client의 최신 job 조회 뒤 같은 key/body로 복구한다.
- 기기 저장 allowlist는 workspace 요청 UUID·opaque job hint만 추가한다. 채팅/사건 내용은
  저장하지 않는다. 새 복구 회귀는 실제 Hono·암호화 SQL의 채팅/일정/행동과 다른 계정 거절을
  확인한다. 채팅 readiness/admission만 명시적 합성 대역이며 실제 AI/외부 인수는 아니다.
  RN 작업공간 UI와 v1 분석 상세/삭제는 이 공통 선행을 main에 통합한 뒤 계속 구현한다.
- 이 공통 단위의 frozen/quick(공통·모바일146개·RN20개·필수 서버42개), 기존 domain/client
  회귀135개, 신규 workspace 복구11개와 native storage 확장 검사가 통과했다. production
  build/workerd 시작·두 OS Metro와 웹 shared2개·draft/자료 snapshot23개도 통과했다.
  최초 일반 conversation 설정의 shared2개는 의도된 opt-in skip이었으며, 해당 fixture 설정과
  `BARO_WORKSPACE_SHARED_UI=true`로2개 실제 실행 성공을 확인했다. 실제 외부 인수가 아니다.
  a0d2deb native39831543461의 Android는 성공했고 iOS는 기록 시점 컴파일 중이다.

### RN 작업공간 연결

- 공통 복구 PR356은 정확한 head `12d650b` CI39834804297 성공 후 main `51d2c9d`에
  정상 병합했다. 기존 사건/intake main `a0d2deb`의 native39831543461은 두 OS 모두
  성공했다. 이 컴파일은 새 작업공간 UI나 실제 기기/OAuth/AI 성공의 증거가 아니다.
- `codex/354-native-workspace`는 `/cases`에서 `/workspace`로 이어지는 RN model/화면을
  연결한다. fresh 고객 owner/동의 gate와 blur/background 취소를 유지하며 대화·실패/
  명시적 재시도·사실/모순/자료 근거·타임라인 추가/수정·행동 완료·기록 추가 조회를 제공한다.
- mutation의 원래 body/revision을 메모리에 보존하고 불확실 응답에는 같은 요청 재시도만
  제공한다. 확정 acknowledgement는 후속 조회 전에 해당 editor를 비우며, 조회 실패가
  새 전송으로 이어지지 않는다. 다른 계정·익명·역할 변경에서 이전 입력을 버리고, fresh
  동일 owner일 때만 background 대기의 메모리 입력을 복원한다. 화면 이탈은 입력을 버린다.
  이탈 중 구독하지 못한 로그아웃 후 같은 계정으로 돌아와도 과거 입력을 복구하지 않는다.
  미저장 내용은 기기 디스크/로그/URL에 쓰지 않는다.
- 새 요약이 생기면 서버가 intake 검토 상태로 되돌리는 실제 Hono/SQL 계약을 따른다.
  기존 cases client의 summary stage를 그대로 사용해 편집/확인 화면으로 이어지며 확인 전
  다음 메시지를 막는다. 서버의 처리/실패·quota·권한과 관측 전용 비용 정책을 보존한다.
- 파일 목록의 공통 metadata reader는 기존 files client와 같은 pagination/상태 매핑을
  사용한다. native 업로드/download 가짜 port를 만들지 않고 이름·상태·선택만 연결한다.
  M5의 업로드·처리 범위 검토·리포트 저장은 잔여이며 v1 분석 상세/삭제와 함께 후속 추적한다.
  웹 pages/components/layouts/styles·서버·DB schema는 수정하지 않는다.
- frozen install·quick(모바일/공통163개·RN24개·필수 서버42개), 추가 domain 회귀66개,
  production build/workerd와 두 OS Metro가 통과했다. 웹 shared2개·draft/자료23개도
  실제 실행해 통과했다. 첫23개 묶음은 draft 보존1건이 실패했으나 제품/테스트 수정 없이
  단독1개 및 같은 전체23개 재실행이 통과했다. 원인은 확정하지 않고 초기 실패를 보존한다.
  실제 OAuth/AI/기기·서명·배포 증거가 아니며 새 UI의 native 컴파일은 통합 SHA로 별도 추적한다.

### 기존 사건 읽기·삭제 연결

- 선행 RN 작업공간 PR357은 head `523f967` CI39838256020 성공 뒤 main `00c9969`에
  정상 병합했다. 같은 SHA native39838641046은 두 OS 성공이며 이 source의
  native 컴파일과 이후 v1/삭제 source·실제 기기 증거를 구분한다.
- `codex/354-native-legacy-cases`는 공통 cases client에서 이미 검증한 v1 CaseDetail을
  native 선택형 `legacyDetail`로 노출한다. 기본 웹 DTO는 유지한다. 저장된 사용자 진술·
  AI 정리·미확인·타임라인·쟁점/한계·자료/행동·당시 출처와 정책 안내·질문 대기/실패를
  RN에서 읽는다. GET 이외의 분석/답변/재시도 요청을 자동 실행하지 않는다.
- 계정 client의 기존 사건 삭제를 독립 공통 factory로 공유한다. native는 빈 DELETE 본문과
  owner/path/method별 opaque UUID를 필수 저장/readback하고 feature 재생성 뒤 같은 key로
  재시도한다. 다른 signed owner·취소 뒤 늦은 응답·잠김/저장 실패·잘못된 ACK는 성공을
  알리지 않는다. 확정 삭제 뒤 cleanup 실패는 성공을 실패로 돌리지 않는다.
- RN은 DELETE 직접 확인과 결과 불확실/같은 요청 확인을 제공한다. ACK에서 선택 사건과
  분석/입력을 비운 뒤 scope를 폐기하고 세션/목록을 다시 읽는다. 후속 목록 실패·삭제된
  사건의404·계정 변경에서 이전 개인 내용을 되살리지 않는다. 물리 cleanup 완료를 접수로
  대신하지 않으며 비용 원장/hold·다른 미해결 key를 지우지 않는다. 계정 탈퇴/reauth는 별도다.
- frozen install·quick(모바일/공통175개·RN28개·필수 서버42개)·production build/workerd·두 OS Metro가 통과했다. 추가 삭제/server
  회귀21개와 웹 세션 복구15개·legacy11개·settings5개도 통과했다. 실제 Hono/암호화 SQL에서
  저장된 guidance 읽기(자동 재분석 없음), v1/v2 삭제의 ACK 유실·같은 key/빈 본문 재시도,
  다른 signed owner 및 실제 DB 역할 변경의 거절·fresh session, RN model의 선택 사건 제거를
  검증했다. 합성 fixture 성공이며 실제 OAuth/AI/기기·서명/배포 인수를 의미하지 않는다.

### M3 재인증의 원래 계정·새 세션 증거

- 고객 v1/삭제 PR358은 head `5dbff4f` CI39842058806 성공 뒤 main `f854061`에 정상
  통합했다. 해당 source의 native39842510191은 두 OS 성공이며 receipt에서 정확한 SHA·
  preview API·development-debug·서명/배포 없음을 확인했다. 실제 제공자/기기 인수와 구분한다.
- `codex/346-native-reauth`는 RN 소비 전 서버 선행 계약이다. signed native 원래 세션이
  `/api/mobile/auth/reauth/prepare`로 nonce/PKCE challenge와 연결된 기존 provider를 준비한다.
  app_metadata의 별도 `native-reauth:v1` namespace에 암호화하며 쿠키·제공자 token·verifier·
  사건 내용은 저장하지 않는다. 원래 세션의 새 준비는 이전 준비를 폐기하고 보안 TTL은10분이다.
- callback의 `purpose=reauthenticate`는 실제 OAuth 사용자·provider·nonce/challenge와 현재
  활성 원래 세션을 대조한다. 같은 계정의 새 OAuth 세션이어야 하며, 준비 이후의 실제
  oauth_authenticated_at을 확인한다. 기존 로그인 callback/wire는 기본값으로 유지한다.
- 일회용 교환은 재인증 purpose와 signed 원래/new 세션 owner를 추가 대조한다. 목적을
  빼거나 다른 계정으로 교환해도 grant를 소비/전달하지 않는다. 브라우저에서 다른 계정을
  선택하면 native grant가 발급되지 않으며 기존 native 세션과 peer 세션을 폐기하지 않는다.
- `/api/mobile/auth/reauth/verify`는 signed 새 세션과 nonce/verifier가 같은 준비를 가리키는지
  확인하고 기존 삭제 client와 같은 ownerTag/startedAt을 반환한다. 기존 로그인 쿠키의 존재나
  단순한 recentOAuth만으로 응답 유실을 성공으로 간주하지 않는다. 새 교환 응답을 잃었어도
  실제 새 쿠키가 저장된 경우에만 이 증거를 다시 확인할 수 있다.
- TTL/폐기·변조·동시 callback·다른 owner/provider·목적 변경과 실제 Hono/SQL callback을
  합성 공급자 대역으로 검증한다. 계정 삭제·journal/복원·정기 정리는 이 owner의 namespace도
  제거하며 다른 owner·비용 원장/hold·미해결 사건 key는 보존한다. schema/migration 변경은 없다.
  native SecureStore proof/취소·cold/warm 복귀·UI는 이 계약 통합 뒤 연결한다.
- 근거는 기존 [RFC8252](https://www.rfc-editor.org/rfc/rfc8252) 외부 브라우저/PKCE와
  [RFC9700](https://www.rfc-editor.org/rfc/rfc9700) 보안 지침이며 새 공급자/결제·CORS 완화는 없다.
- frozen/quick(모바일/공통175개·RN28개·필수 서버56개), 관련 인증/삭제54개, production
  build/workerd·두 OS Metro·validate:db의 drift/마이그레이션 회귀와 웹 settings5·세션 복구15개가
  통과했다. 신규14개는 합성 제공자와 실제 Hono/암호화 SQL이며 실제 OAuth 성공은 아니다.
- preview `/api/health/live`가 보고한 API SHA는 `57121d2378cb5fd8d0e8761899672be00dcaf59f`다.
  native auth 선행 `a1ad098`은 그 SHA의 ancestor가 아님을 확인했다. 현재 앱 compile과 API의
  실제 호환 인수를 혼동하지 않는다. native API를 포함한 검증 SHA의 preview 배포와 두 OS
  실제 흐름은 #71/M8·#346·#354에서 별도로 추적하며 기존 공개/운영 gate를 우회하지 않는다.

## 2026-10-23 전달물·toolchain 보완 관측

- PR389의 실제 SDK preflight39915601362는 Build Tools37.0.0에서 AOSP 정상/손상 APK의
  검증/거부와 소유 AVD discovery를 확인했다. Home 계측 overlay는 두 OS 실제 Metro export를
  통과했다. 이는 emulator boot나 제품/IPC 성공이 아니며 mainc2fa3f2 runtime39916204937의
  Android15 실제 Home/IPC·SDK100MB/1GB IO 성공 receipt를 실물 대조했다. iOS는 compile 뒤
  Home 대기 terminal FAILURE이며 raw openurl과 Expo CLI의 소유 Simulator schemeapproval 준비
  차이를 보강하고 실제 실행으로 확인한다. 이전 runtime의 AVD_INVALID/Home 대기 실패는 보존한다.
- preview39916208240의 Android job은 sourcec2fa3f23394a349bf7cf7d33dee64a433d29e634에서
  성공했다. [실제 개발 APK](https://github.com/creno-va/baro/actions/runs/39916208240/artifacts/12485482082)는
  162,497,066bytes/SHA256 `636c11b03079ab5ddfedc6ce7dcc9a0941c9990ff577ba195a4db761889a98b9`다.
  전체 파일 hash·ZIP native arm64-v8a/x86_64·포함 TTF hash를 실제 다운로드와 독립 대조했다.
  SDK aapt/apksig가 applicationId site.baro.app.preview/version0.1.0/build1/minimumAPI24와
  실제 debug certificate를 검증했다. Metro 필요 앱이며 설치 대상의 실제 동작은 별도다.
  iOS/workflow도 성공했으며 ZIP51,547,245bytes·Info.plist/실제 Mach-O x86_64·arm64·ad-hoc와
  포함 TTF·전체 hash를 실제 다운로드와 대조했다. [지속 증거](../quality/MOBILE-NATIVE-RUNTIME-2026-10-23.md)에
  두 OS preview receipt와 Android 실제 runtime receipt·합성 화면을 보존한다.
- API health 관측2026-10-23T07:22:39.444Z는57121d2이며 native auth 이전 SHA다. 이 앱의
  원격 로그인·API 호환 성공으로 표현하지 않는다. 실제 원격·물리 기기·스토어/#71은 남아 있다.
- PR390은 원래 registry version/SRI/LICENSE를 보존한 CJS patch와 전체 설치 tree/실제
  consumer resolution·원본/수정본 Node 회귀를 main1a6c54d에 통합했다. CI39917339321과
  main CI39917819068이 성공했다. [patch 범위](../../patches/README.md)와
  [#339 receipt](https://github.com/creno-va/baro/issues/339#issuecomment-6359737994)를 따른다.
  현재 웹/Worker3개 출력 module graph와 Android1455/iOS1464 sources에 advisory 패키지가
  없고 제품15개 route가 모두 포함됐음을 확인했다. 실제 Expo 인증서 라이브러리의 합성
  검증·서명/Node 독립 검증, 실제 offline Expo HTTP manifest/JS bundle 두 OS200도 인수했다.
  이 증거는 c2fa3f2 이전 source native 실행을 패치 후 native 성공으로 바꾸지 않는다.
  raw audit high2건과 forge browser dist/map 미패치·실제 native/SDK/full 보안 인수는 OPEN이다.

## 참고

### M8 로컬 실행 증거의 범위 (#385)

PR384 main77ecb45/CI39900023599 SUCCESS 뒤 실제 RN→native module→SDK 파일/credential IO의
검증 공백을 잇는다. `mobile-runtime.yml`은 immutable main SHA·별도 임시 worktree·새 소유
Android Emulator/iOS Simulator에서 local 개발 앱을 빌드한다. 제품 home에는 임시 layout
계측만 추가하고 원본/overlay hash와 스크린샷을 남긴다. 후속 native probe는 임시 manifest의
별도 entry에서 실행하며 정본 router·웹 소유 파일·server/schema를 바꾸지 않는다.

실제 SDK private source snapshot/hash/readback·SecureStore·native 100MB PUT/1GB download·
401/Origin fence·owner 변경·source clear 취소/cleanup과 미확정 key 보존을 합성 loopback에서
대조한다. fixture는 native로 받은 전체 byte/hash를 별도로 검증하며 receipt는 다른 SHA/OS,
누락된 IO/cleanup·확장된 인수 주장을 거부한다. 메모리는 process RSS의 관측 표본이며 전체 peak/
JS heap 한도 증명이 아니다. raw runtime 로그/개인 자료/토큰을 artifact에 올리지 않는다.

이 절차의 구현/offline 성공과 실제 OS 실행 결과는 구분한다. native compile/font receipt는
compiled-resource-only이고, 계측된 home mount도 전체 제품 사용자 여정 인수가 아니다.
실제 OAuth/원격 API·기기 DocumentPicker/공유/열기·물리 기기/접근성·스토어 및
#339/#71의 기존 조건은 OPEN으로 유지한다. 실제 workflow 성공/receipt 실물을 확인한 SHA만
후속 issue 기록에 추가하며 실패 원인/조건 변경 없이 같은 외부 실행을 반복하지 않는다.

PR417/main9a369bc·CI39995718447 뒤 iOS39996169996 SUCCESS와 기존 Android39916204937의
source별 원본 receipt/PNG·메모리·실행 범위를 [실제 증거](../quality/MOBILE-NATIVE-RUNTIME-2026-10-23.md)에
인수했다. 독립 #385의 두 OS local native 실행/내부 전달은 완료하며 원격/API/OAuth·실제 picker와
전체 UI/기기·스토어·#339/#71/#334는 위 표의 별도 잔여다.

- [Expo workspace 구성](https://docs.expo.dev/guides/monorepos/)
- [Expo 개발 빌드](https://docs.expo.dev/develop/development-builds/introduction/)
- [Better Auth Expo 연동](https://better-auth.com/docs/integrations/expo)
- [Cloudflare Turnstile 모바일](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/)
- [기존 client API 계약](./CLIENT-API-CONTRACT.md), [기존 UI 시연 행렬](../product/UI-DEMONSTRATION.md)
