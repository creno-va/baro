# 모바일 Apple 로그인 결정안 (#346)

- 상태: **2026-10-24 사용자 직접 응답으로 Apple 로그인 추가 승인**.
  기존 Google·네이버·카카오와 기존 계정·이전 앱 호환을 유지한다.
  token 장기 보관·공개 출시는 이 승인에 포함하지 않는다. 구현/실제 인수 완료는 아니다.
- 검토: 2026-10-24 KST. 코드 기준 main `8480fa6cdc7da56d90814bf572f262bfcf40d381`.
- 범위: [모바일 실행 계획](./MOBILE-EXECUTION.md)의 M3 로그인 심사와 M8 제출 준비.
  기존 3사 검증·웹 UI 개편·원격 실행을 중단하는 조건이 아니다.

## 승인한 결정

**권고: 기존 Google/Naver/Kakao를 유지하면서 Sign in with Apple을 모바일 로그인 선택지로 추가한다.**
iOS 심사 대응과 같은 계정의 Android 접근을 함께 설계하되, 먼저 공통 계약/서버 선행 PR,
그 뒤 모바일 소비·실제 Apple 설정/기기 검증을 순차 수행한다. 웹 로그인 화면을 이 작업에서
변경하지 않는다. 공개 출시·법률/개인정보 정책 승인·Apple 계정 구매/서명 권한은 별도다.
키/계정이 준비됐다고 가정하지 않고 기존에 질문한 개발자 계정 상태와 연결한다.

대안은 공급자 추가 결정을 보류하고 기존 3사 내부 검증을 계속하는 것이다.
그 경우에도 앱 전체 목표와 iOS 제출 준비는 미완료로 유지한다. 3사를 숨기거나
심사 때만 다른 로그인 동작을 보여 주는 방법은 선택하지 않는다.

## 현행 공식 기준과 BARO 대조

[App Review Guidelines 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)은
소셜 로그인으로 주 계정을 만드는 앱에 데이터 최소 수집, 이메일 비공개 선택,
동의 없는 광고용 이용 추적 방지를 갖춘 동등한 다른 로그인 선택지를 요구한다.
Sign in with Apple만이 유일한 허용 구현이라고 쓰지는 않는다.

BARO는 사건 저장·고객/변호사 계정을 세 소셜 제공자로 인증한다. 자체 계정만 사용하는 앱,
기존 학교/기업 계정 전용 앱, 공적 전자 신분 인증 앱, 특정 외부 서비스의 콘텐츠 전용 client나
대체 marketplace라는 근거가 현재 PRD/구현에 없다. 일반 고객의 기업 사건을 지원한다는 사실만으로
기업 전용 예외를 적용하지 않는다. 따라서 **현행 3사만으로 예외 또는 동등 선택지 요건을
입증하지 못했다**는 것이 이 저장소의 기술적 판단이다. Apple의 실제 심사 결론이나 법률 승인은 아니다.

## 단순 버튼 추가로 끝나지 않는 이유

| 현재 정본 | 관측한 제약 | 필요한 선행 작업 |
| --- | --- | --- |
| `packages/client-core/src/types.ts` | Provider가3사 union | Apple 소비 가능 범위와 이전 client 호환 계약 |
| `src/contracts/mobile-auth.ts`, `src/contracts/deletion.ts` | 재인증 provider enum3사·삭제 접근 providers 최대3 | 선행 서버/계약 PR·새 앱과 이전 앱 응답 행렬 |
| `src/server/auth/index.ts` | socialProviders·OAuth freshness 허용 목록3사 | 실제 완료한 Apple callback만 서버 freshness로 인정 |
| `src/server/auth/native-expo.ts` | authorization proxy provider origin/path3사 allowlist | Apple의 정확한 endpoint/callback만 추가·기존 PKCE/nonce/Origin 유지 |
| `src/server/auth/env.ts` | 기존3사 credential만 구성 | Apple 설정을 별도 가용성으로 다루고 미설정 시 기존3사 유지 |
| `src/server/auth/index.ts` account hooks | 모든 provider access/refresh/id token을 DB 저장 전에 폐기 | Apple 삭제/revoke를 함께 설계하고 장기 token 보관을 몰래 추가하지 않음 |
| 모바일 Session/Settings UI | 현재3사 버튼·label·reauth 선택 | Apple 디자인/이메일 비공개와 기존 계정 안내·역할/동의 보존 |

설치된 `@better-auth/core`1.7.7의 `social-providers/apple.mjs`는 Apple authorize endpoint와
`response_mode=form_post`, `response_type=code id_token`을 사용한다.
기존 SDK 지원이 있다는 사실은 BARO의 native bridge·POST callback·상태 cookie·서명/audience/nonce
검증이 이미 Apple과 맞는다는 증거가 아니다. 이 경로를 독립 회귀로 먼저 검증한다.
Origin/CSRF를 전역 해제하거나 WebView 안에 로그인 자격 증명 폼을 복제하지 않는다.

## 권고 구현 경계

1. **계약/호환성 선행:** 이전 앱의 strict3사 응답을 그대로 보존한다. 새 버전의 명시적
   capability/응답 계약으로 Apple을 노출하고, 지원하지 않는 이전 client에 네 번째 enum을
   무조건 반환하지 않는다. 이전 앱/새 서버·새 앱/이전 서버를 fixture와 실제 호환표에 추가한다.
2. **서버 인증 선행:** 기존 시스템 browser→서버 callback→기기 verifier에 묶인 일회용 코드
   교환 구조를 우선 재사용한다. Apple의 POST callback, signed state, issuer/audience/nonce,
   유효/변조/재사용/만료, 취소와 같은 계정 재인증을 검증한다. 새 native SDK가 필요해지면
   Expo 호환 버전·실제 양 OS 빌드를 먼저 검증한다. credential은 server에만 둔다.
3. **기존 계정 보존:** verified local/provider email 조건과 `allowDifferentEmails=false`,
   서버 owner·freshness 정본을 유지한다. private relay 이메일을 실제 이메일로 역추적하거나
   서로 다른 계정을 이메일 추정으로 합치지 않는다. 기존 사건은 처음 사용한 로그인 수단으로
   접근할 수 있음을 안내한다. 명시적 계정 연결/데이터 이관은 별도 인수 전 제공한다고 표시하지 않는다.
4. **이름/메일/동의:** 최초에만 오는 이름·메일과 이후 누락, relay 메일을 검증한다.
   BARO의 필수 정책/14세 이상 동의를 Apple 로그인 성공으로 대체하지 않는다.
5. **삭제/revoke:** 아래 경계를 먼저 인수하고 로그인을 공개하지 않는다.
6. **모바일 소비/실제 인수:** 서버 capability가 확인된 환경에만 Apple 선택지를 노출한다.
   Apple 버튼 가이드·취소/cold/warm·두 역할/동의·삭제·기존3사와 두 OS 회귀를 확인한다.
   기존 웹 UI 소유 파일은 읽기 전용으로 유지한다.

## Apple 삭제/revoke와 현재 token 폐기 정책

[Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)는
프로그램 방식 revoke에 유효한 access/refresh token이 필요함을 설명한다.
token/code가 없어도 서비스 계정 삭제를 이행하고 Apple 접근 해제 안내와 비로그인 복귀를
수행하는 경로도 명시한다. [계정 삭제 지원 안내](https://developer.apple.com/support/offering-account-deletion-in-your-app/)는
불필요하게 어려운 삭제 절차를 만들지 않도록 요구한다.

권고 기본안은 현재의 provider token 장기 미보관을 유지하는 것이다. 사용자가 확인한 삭제
의도와 같은 owner의 최근 Apple 재인증을 결합해 획득한 token을 server 요청 처리 중 revoke에
사용하는 경로를 설계한다. token이 없는 경우에도 기존 fresh owner 검증을 충족한 BARO 삭제를
거부하지 않고, provider 해제 미확인과 공식 수동 해제 안내를 별도 표시한다.
revoke 실패/응답 유실을 성공으로 표시하지 않으며 BARO 데이터 삭제와 provider 해제 결과를 구분한다.

이 방식의 실제 Apple 검증과 재시도/멱등성·기존 삭제 worker 인수가 필요하다.
정상 revoke를 지원하지 못한 채 항상 수동 해제로 대체하는 구현을 완료로 취급하지 않는다.
추가적인 지속 token 보관이 필요하다고 판명되면 보관 범위/암호화/삭제·정책 영향을 담은 별도
결정을 먼저 받는다. 이 제안의 승인을 token 장기 보관 허가로 해석하지 않는다.

## 실제 설정·승인 뒤 실행 순서

[Apple의 웹 설정 안내](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)에 따라
Sign in with Apple을 활성화한 primary App ID와 Services ID, 등록 domain/return URL을 조율한다.
Apple Developer 관리 권한·키가 실제로 있는지는 사용자 확인 대기다. private key·client secret을
채팅/이슈/PR/artifact에 올리지 않는다. preview/production 환경과 app identifier·callback을 각각 대조한다.

사용자가 **Apple 로그인 추가 승인 (권장)**으로 응답했다. 위1→2/5→3/4/6 순서로
계약·서버·모바일 PR을 인수한다. 실제 계정 설정과 배포는 기존 권한/preview·최종 full/#71
게이트를 따른다. 이 승인 기록과 계약 선행 PR만으로 Apple을 가용 공급자로 노출하지 않는다.
현재3사 테스트와 진행 중인 native 입력 검증은 계속하며 #334/#346/#339/#71을 닫지 않는다.

## v2 계약 선행 구현

`GET /api/mobile/auth/capabilities`는 strict `{contractVersion:2, providers}`를 반환한다.
이 단계의 가용 providers는 기존3사다. Apple은 서버 callback·계정·삭제/revoke 인수 후에만
가용 목록에 추가한다. credential 유무를 전체 기존 인증 중단 조건으로 삼지 않는다.

`GET /api/me/deletion`과 `POST /api/mobile/auth/reauth/{prepare,verify}`는
`x-baro-auth-contract: 2`로 새 계약을 명시한다. 헤더 없음/`1`은 이전 strict3사 계약이고,
알 수 없는 버전/중복 결합값은400이다. v2 삭제 응답은 `contractVersion:2`와 최대4개
중복 없는 공급자를 포함한다. 이전 응답에는 새 필드/Apple enum을 보내지 않는다.
가상 미래 Apple account row가 있는 합성 DB에서도 이전 앱의 삭제 접근 파싱을 유지한다.

새 앱의 이전 서버 대응은 capability404일 때에만 명시적으로 legacy3사 모드를 선택하는
후속 소비 계약이다. timeout/503/잘못된 응답을 Apple 지원 또는 성공으로 해석하지 않는다.
이번 선행 구현에는 새 앱 소비나 실제 Apple 설정/로그인이 없다. Origin·owner·linked account·
fresh OAuth·PKCE grant·token 폐기·삭제 worker는 계속 서버 정본이며 migration은 추가하지 않는다.

결정 근거는 [AGENTS.md](../../AGENTS.md)의 “새 모델/공급자, 공개 정책 법률 승인, 사업자 정보,
새 결제/자동 충전, production 공개 전환은 별도 결정이 필요하다”와
[ADR-0017](../adr/0017-expo-mobile-and-shared-client-boundaries.md)의 새 로그인 공급자 미결 항목이다.
