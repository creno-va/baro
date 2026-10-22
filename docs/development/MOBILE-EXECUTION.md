# RN + Expo 모바일 실행 계획

- Status: M1 인수 완료; 전체 네이티브 앱화 #334 / M2 공통 client #335 진행
- Updated: 2026-10-22
- Tracking: 전체 [#334](https://github.com/creno-va/baro/issues/334), 계획 [#328](https://github.com/creno-va/baro/issues/328), M1 [#330](https://github.com/creno-va/baro/issues/330), M2 [#335](https://github.com/creno-va/baro/issues/335)
- Decision: [ADR-0017](../adr/0017-expo-mobile-and-shared-client-boundaries.md)
- Architecture: [공통 코드와 모바일 경계](../architecture/MOBILE-CLIENT.md)

## 1. 이번 요청과 완료 범위

사용자는 RN + Expo를 선택했고, 웹 UI 전면 개편은 다른 채팅에서 진행하므로 모바일의
공통 코드 구조와 단계별 실행 계획을 먼저 요청했다. 계획 PR329는 CI 성공 후 main
`e6401de9657f8fd062fb913fe7d3945adec068fd`에 병합했다. 이어진 직접 요청으로 M1
`apps/mobile`·Bun workspace·공통 계약 export를 #330에서 구현한다. 로그인·실기기·
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

현재 구현 이슈는 **#335 M2 공통 API client·client-core**다. #330은 두 OS native 개발
빌드 receipt와 quick/build/계약/UI 증거를 확인해 인수했다. M2 첫 단위는 공통 DTO·오류·
transport 및 session/consent·공개 디렉터리와 모바일 목록/검색이다. 다음 단위에서 사건·
workspace·자료·리포트·나머지 domain을 순차 추출한다. 첫 단위만으로 M2 전체를 종료하지 않는다.

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

## 참고

- [Expo workspace 구성](https://docs.expo.dev/guides/monorepos/)
- [Expo 개발 빌드](https://docs.expo.dev/develop/development-builds/introduction/)
- [Better Auth Expo 연동](https://better-auth.com/docs/integrations/expo)
- [Cloudflare Turnstile 모바일](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/)
- [기존 client API 계약](./CLIENT-API-CONTRACT.md), [기존 UI 시연 행렬](../product/UI-DEMONSTRATION.md)
