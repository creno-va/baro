# 모바일 Apple 로그인 결정안 (#346)

- 상태: **2026-10-24 사용자 직접 응답으로 Apple 로그인 추가 승인**.
  기존 Google·네이버·카카오와 기존 계정·이전 앱 호환을 유지한다.
  token 장기 보관·공개 출시는 이 승인에 포함하지 않는다. 구현/실제 인수 완료는 아니다.
- 검토: 2026-10-24 KST. 코드 기준 main `8480fa6cdc7da56d90814bf572f262bfcf40d381`.
- 범위: [모바일 실행 계획](./MOBILE-EXECUTION.md)의 M3 로그인 심사와 M8 제출 준비.
  기존 3사 검증·웹 UI 개편·원격 실행을 중단하는 조건이 아니다.

2026-10-24 사용자는 Apple Developer Program 회원 계정이 있다고 직접 확인했다.
이는 실제 Services ID·Team/Key·서명·callback 설정이나 실제 Apple 로그인 성공을 입증하지 않는다.
공식 버튼 자산은 Apple 제공 파일을 변경하지 않고 앱 UI 용도로 사용한다.

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

| 결정 당시 정본 | 관측한 제약 | 필요한 선행 작업 |
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
Apple Developer Program 회원 계정 보유는 사용자에게 확인했다. 실제 관리 권한·Services ID·키
설정은 미확인이다. private key·client secret을
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

## 서버 identity binding 선행

설치된 Better Auth/core1.7.7의 Apple raw adapter는 기본 authorization nonce 결합과
redirect callback의 ID-token 신원 검증 완료 증거로 간주하지 않는다. 합성 raw helper 관측을
전체 OAuth 우회/실제 계정 취약점 증명으로 해석하지 않는다. `apple-identity.ts`는 Apple만
감싸고 기존3사 provider object를 그대로 유지한다. 아직 실제 `socialProviders.apple` 설정이나
credential·가용성·native Apple 버튼은 추가하지 않는다. 이 선행 PR 자체는 freshness를 추가하지 않았다.

이 binding은 SDK가 생성해 OAuth state에 보관하는 nonce를 authorize URL로 전달하고,
callback token을 공개 SDK verifier로 먼저 확인한 뒤 profile decode를 허용한다.
issuer는 `https://appleid.apple.com`, audience는 고정 Services ID, algorithm은 RS256,
nonce는 exact match이며 exp/iat/sub를 필수로 검사한다. 최대16KiB token·유효한 서버 nonce가
없으면 key 조회 전에 거절한다. client-submitted idToken 로그인은 차단하고 custom verify
옵션이 이 경계를 우회하지 못하게 한다. product 런타임에 Node filesystem/process/Bun을 넣지 않는다.

합성 RSA 키와 실제 SDK callback/SQL을 사용하는 테스트는 서명 변조·issuer/audience/algorithm·
nonce 누락/교차 시도·만료/누락 claim, POST→GET state·만료/변조/재사용과 provider token DB
폐기를 검사한다. POST에 Lax cookie가 없고 다음 GET에 fixture cookie를 전달하는 구성은
실제 Safari/system browser 동작을 검증한 것이 아니다. Apple JWKS/token endpoint·실제 계정·
두 OS 복귀 성공도 아니다. 이 선행 PR 자체는 Apple freshness를 인정하지 않았다.

첫 이름/relay claim의 검증과 이후 email/name 누락을 신원 실패로 오인하지 않는 기초를
검사했으며, 동일 Apple subject의 계정 조회는 아래 보완으로 이어진다. 삭제 의도/요청 중 revoke·결과 분리·
credential 준비·Apple POST browser relay·native 소비는 다음 producer/실제 인수에 남는다.
이 선행을 정상 revoke나 전체 Apple 로그인 완료로 표시하지 않는다.

## 동일 Apple subject의 기존 계정 보존

JWT에 email이 없을 때에만 서명/nonce 검증 뒤 `account.provider_id='apple'`과 검증된 `sub`의
정확한 연결을 조회한다. 살아 있는 단일 owner와 유효한 저장 이메일만 사용하며 tombstone·
연결 해제·잘못된 저장값은 거절한다. Google 등 다른 provider의 같은 account_id나 이메일
유사성으로 owner를 찾지 않는다. 이름이 다시 오지 않아도 기존 이름·역할·필수 동의를 유지한다.
최초 가입의 정책/14세 동의는 Apple 성공으로 대신하지 않는다.

저장 이메일은 새로운 Apple email-verification claim이 아니다. fallback의 provider 정보는
emailVerified=false로 두고, 기존 local verification 값은 수정하지 않는다. 처음부터 제공된
Apple 이메일은 기존 verified local/provider 조건과 allowDifferentEmails=false를 그대로 따른다.
네 조합의 실제 SDK 합성 연결 행렬과 true/false 저장 상태를 각각 확인한다. relay 주소를 실제
주소로 추정하거나 다른 owner의 자료를 합치지 않는다.

검증/조회 뒤 SDK의 owner 선택 전에 연결 해제·owner 이동·삭제가 경쟁할 수 있다. SDK의
request-local OAuth state 객체를 키로 하는 WeakMap에 원래 owner/sub만 잠시 결합한다.
email fallback으로 새 user/account를 만들거나 user 정보를 갱신하지 못하게 한다. SDK가
요구하는 account 보안 필드 갱신과 session 생성 전에는 같은 살아 있는 연결을 다시 확인한다.
Apple callback 문맥이 없으면 실패로 처리하며 다른 인증 경로는 이
상태를 읽지 않는다. client additionalData나 persisted state 필드를 권한 marker로 신뢰하지
않고 provider token이나 새 durable payload도 저장하지 않는다. 실제 SDK/SQL 경쟁 검증에서
다른 owner 로그인·삭제 계정 재생성을 거절했다. 동시 callback은 정상 신규 가입을 유지하고
기존 owner marker가 다른 요청에 전파되지 않음을 확인했다.

이것은 합성 RSA/JWKS·SDK/SQLite 인수이며 실제 Apple·두 OS 기기 성공은 아니다. Apple
credential/provider/capability는 추가하지 않는다. 뒤의 삭제 producer가 검증된 callback freshness와
request-local revoke·결과 분리를 추가하며, 실제 설정과 native 소비는 남아 있다.

## 삭제 전용 callback·접근 철회 producer

`codex/346-native-deletion-revoke`는 기존 일반 재인증과 별도의 삭제 의도를 추가한다.
`POST /api/mobile/auth/deletion/prepare`는 같은 Origin·정확한 `x-baro-auth-contract: 2`,
현재 세션·연결 공급자·literal `DELETE`, 새 attempt UUID와 PKCE challenge를 요구한다.
삭제 전용 `purpose=delete-account` callback은 같은 owner의 새 fresh OAuth 세션만 인정한다.
일반 로그인/재인증 의도와 교환할 수 없으며, 기존3사·이전 앱의 일반 재인증 envelope/AAD와
응답 필드는 유지한다. Apple 준비는 아직 가용성이 없어503이며 합성 fixture에서만 직접 준비한다.

삭제 intent의 정확한 암호문·원래 세션·새 세션 freshness·현재 Apple 연결 snapshot을 D1에서
다시 확인한다. BARO user/session 삭제와 tokenless 완료 영수증 삽입을 기존 삭제 journal과
**같은 batch**에서 수행한다. 영수증 충돌/저장 실패는 전체 삭제를 rollback한다.
취소는 verifier로 증명한 intent의 CAS 삭제이며, 취소와 삭제 커밋 중 한쪽만 이긴다.
커밋 뒤 취소는 accepted 결과를 반환하고, 알 수 없는/만료된 intent를 cancelled로 꾸미지 않는다.
기존 삭제 worker·자료/발행 inventory·tombstone·복구 journal을 유지하며 migration은 추가하지 않는다.

서명·issuer/audience/nonce와 정확한 Apple subject 연결을 검증한 callback만 서버 OAuth
freshness를 부여한다. raw access/refresh token은 SDK의 요청별 state 객체를 키로 하는 WeakMap에
잠시 두며 DB·OAuth state payload·기기·로그에 저장하지 않는다. native/web/실패 callback의
종료 시 제거한다. 장기 token 보관 정책은 바꾸지 않는다.

**BARO 삭제 커밋 뒤에만** 요청 중 획득한 token으로 Apple revoke endpoint를 최대1회 호출한다.
[Apple revoke 명세](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens)의
고정 HTTPS POST·form body, refresh 우선/access 대체, 최대10초·redirect 거절을 적용한다.
문서의 empty HTTP200을 관측하고 삭제 직전 Apple 연결이 해당 subject 단1개였을 때에만
전체 철회를 confirmed로 올린다. token/설정 부재·오류·timeout·응답 본문·여러 Apple 연결은
unconfirmed다. 실패가 이미 커밋한 BARO 삭제를 취소하거나 재시도 token 저장을 만들지 않는다.

영수증은 issuer·attempt·purpose·만료에 AES-GCM/HKDF로 결합한10분짜리 결과다.
공개 값은 strict `{contractVersion:2,status:"accepted",ownerTag,appleRevocation}`이며
철회 상태는 `not_linked|confirmed|unconfirmed`다. 연결이 있으면 초기값부터 unconfirmed로
저장하므로 worker 중단/철회 결과 최종 저장 실패도 허위 성공이 되지 않는다. confirmed는
하향하지 않으며 새로운 receiptId에 이전 완료 응답을 적용하지 않는다. 별도 pending 성공 상태는 없다.

callback은 앱에 attemptId·일회용 완료 code만 반환하며 인증 grant를 발급하지 않고 서버 cookie를
만료한다. `deletion/exchange`는 verifier+code로 결과를 한 번 교환한다. 응답 유실·동시 CAS 충돌은
`deletion/status`로 같은 verifier가 결과만 재조회할 수 있다. 삭제 뒤에는 세션이 없어도
status/exchange/cancel의 verifier+Origin+v2 검증이 필요하며 인증이나 계정 접근을 재발급하지 않는다.
영수증 만료 뒤 unknown을 삭제 취소/실패/철회 성공으로 단정하지 않는 앱 소비가 후속 범위다.

합성 RSA/JWKS·실제 Better Auth/SQLite/Hono 회귀에서 Apple callback→동일 owner 삭제→
철회 요청 순서, 정확한 빈200/오류/token 부재, 모든 callback의 material 제거, DB token 미보관,
기존3사 callback과 쿠키 만료, 코드 재사용·암호문/issuer/attempt/clock 변조, 동시 완료와
취소·연결/세션 경합·원자 저장 rollback을 검증한다. 이것은 실제 Apple revoke/token endpoint
성공이나 Safari/system browser·두 OS 기기 인수가 아니다.

이 삭제 producer PR 자체에는 Apple credential/provider 등록·authorize proxy의 Apple allowlist·
POST browser relay·capability 노출을 포함하지 않았다. 선택적 서버 연결은 다음 절에서 인수하며,
모바일 UI/결과 복구/credential 제거·실제 계정/기기 검증은 후속이다.
기존 웹 UI 파일을 변경하지 않으며 #334/#346/#379/#339/#71은 OPEN으로 보존한다.

이번 producer의 로컬 검증: `bun ci` lock 변경 없음, `validate:quick`208개/29파일/2257 assertions,
새 삭제/철회·Apple 회귀80개/587 assertions, auth·삭제/journal 포함178개/1450 assertions,
`validate:build`·`validate:db`와 양 OS Metro export 통과. schema/migration 추가 없음.
Metro는 로컬 bundle 검증이며 기존 실제 source6201112의 OS 증거를 현재 변경에 전이하지 않는다.
raw audit high2건과 #339/#71 전체 gate·실제 OAuth/기기 인수는 별도로 유지한다.

## 선택적 Apple 설정과 POST callback 연결

후속 `codex/346-apple-callback-setup`는 Apple provider를 선택적으로 등록한다.
`APPLE_AUTH_ENABLED=true`와 Services ID·client secret이 모두 준비돼야 가용 목록에 추가하며,
기본값은 비활성이다. 실제 환경의 flag/키/계정·공개 운영 설정은 이 PR에서 바꾸지 않는다.
누락·부분 설정·형식 오류·만료는 Apple만 비가용으로 처리하고 기존3사 설정/인증을 유지한다.

[Apple client secret 명세](https://developer.apple.com/documentation/AccountOrganizationalDataSharing/creating-a-client-secret)에
맞춰 ES256·10자리 key/team ID, audience·Services ID subject·iat/exp·최대15,777,000초와
서명 길이를 구성 metadata로 검사한다. 이것은 개발자 서명 검증이나 Apple의 실제 credential
수락 증거가 아니다. 실제 signature/key/도메인·return URL은 Apple endpoint/계정 설정에서
별도 검증해야 한다. private key를 앱에 넣거나 실행 중 client secret을 생성하지 않는다.
환경 객체별 auth cache는 Apple secret 교체·만료/비활성화를 반영하며 다른 환경의 설정을 공유하지 않는다.

Apple의 정확한 `/api/auth/callback/apple` **POST**에만 `https://appleid.apple.com` Origin을
추가로 신뢰한다. 같은 Apple Origin으로 sign-in/sign-out 등 다른 endpoint를 호출하는 것은
거절하며 Origin·CSRF를 전역 해제하지 않는다. callback form은16KiB 이하, 단일 state/code,
query/body 중복·불명확한 성공/실패 조합을 거절한다. frontchannel `id_token`과 posted email,
raw provider error description을 SDK로 넘기지 않고 bounded 표시 이름만 보존한다.
실제 신원은 token 교환 결과의 서명·nonce·subject 검증으로 판단한다.

SDK의 form POST→고정 same-origin GET relay를 사용한다. POST에 Lax state cookie가 없어도
다음 GET의 SDK signed state/cookie가 반드시 일치해야 한다. native authorize proxy는 설정된
Apple의 정확한 authorize endpoint·같은 서버 callback만 허용한다. 모든 auth 응답에
`Referrer-Policy: no-referrer`와 private no-store를 적용한다. SDK의 중간 GET에는 짧은 OAuth
code/state·bounded 이름이 있을 수 있으므로 이를 로그/이슈/PR/artifact로 내보내지 않는다.
앱으로 최종 전달하는 값은 여전히 일회용 PKCE code·attemptId뿐이다.

합성 operator metadata와 RSA/JWKS, 실제 운영 provider 등록/SDK/proxy/POST/GET/Hono/SQLite
경로로 정상 로그인·이후 email 누락·같은 owner 유지, 삭제/revoke, 취소·cookie 부재·nonce
불일치, 설정 오류/만료·Origin scope·중복/크기/form 실패를 검사한다. 합성 developer secret은
Apple 수락 credential이 아니며 provider token exchange/JWKS/revoke의 합성 대역을 실제
Apple 성공으로 표시하지 않는다. 실제 Safari/system browser의 cookie 전달·cold/warm 복귀와
개발자 설정/두 OS 기기 인수는 여전히 별도다. 모바일 capability 소비·Apple 버튼·삭제 결과
복구 UI가 후속이며 기존 웹 UI는 변경하지 않는다.

선택적 설정/POST 연결의 통합 로컬 검증(main3e427aa 포함): frozen 설치 lock 변경 없음,
`validate:quick`243개/31파일/2528 assertions, Apple 설정·callback·identity63개/465 assertions,
auth·기존 삭제/복구 journal216개/1752 assertions와 `validate:build`/로컬 workerd 통과.
이 변경은 server/config만 다루며 native source·모바일 bundle·DB schema/query를 추가하지 않는다.
이전에 통과한 OS/DB 증거를 새 실제 로그인/기기·전체 security/#71 인수로 전이하지 않는다.

## 공통 모바일 v2 client 소비

`codex/346-mobile-auth-v2-consumer`의 공통 선행은 `createMobileAuthClient`다.
capability의 실제 HTTP404만 legacy3사로 선택하며, 503/401 본문의 NOT_FOUND·timeout·잘못된
성공 DTO·알 수 없는 버전/중복 provider는 downgrade하지 않는다. `ApiError.httpStatus`는
실제 응답 상태를 보존하는 선택적 관측 값이며 기존 code/message/retryable 의미는 유지한다.
현재 웹/이전 client의 `Provider`는3사 그대로이고, `MobileProvider`는 canonical v2 enum의
별도 type alias다. wire schema나 endpoint의 기존 응답을 바꾸지 않는다.

협상한 버전으로 삭제 접근·재인증 prepare/verify를 파싱하고, v2 삭제 prepare는 explicit
DELETE·지원 provider·원래 owner를 전달한다. 삭제의 exchange/status/cancel은 세션이 사라진 뒤
읽을 수 있도록 별도의 completion requester를 명시적으로 받는다. 결과 ownerTag는 원래 준비
영수증에 결합하며 invalid proof/tag는 전송 전에 거절한다. status/cancel의 unknown/401/404/503을
취소나 삭제 실패/성공으로 임의 확정하지 않는다. 이 공통 client는 cookie·verifier 저장이나
계정 자료 정리를 수행하지 않는다. 그 수명과 owner 전환 경합은 native adapter가 책임진다.

합성 대역의 응답 행렬과 기존3사 실제 Better Auth/Hono/SQLite callback을 결합해 삭제 후
무세션 결과 복구·one-use 재교환 거절을 검사한다. 실제 제공자 로그인이나 native 저장소/화면
성공은 아니며 다음 단계에서 capability UI·Apple 버튼·pending 저장소·credential 정리를 연결한다.

공통 client의 최신 maineb57a03 통합 검증: `bun ci` lock 변경 없음, quick source 회귀243개,
전체 로컬 unit3986개/371파일/170925 assertions, 새 shared mobile-auth19개/86 assertions,
production build/bundle/dry-run·실제 로컬 workerd와 양 OS Metro export 통과.
Metro 입력에 변화가 없는 AI server 통합은 실제 native/기기 증거로 승격하지 않는다.
모바일 화면·저장소·삭제 정리 adapter와 실제 Apple/기기 인수는 후속이다.

## 모바일 삭제 결과 전용 전송 준비

`apps/mobile/src/platform/auth/deletion-transport.ts`는 삭제 exchange/status/cancel의
정확한 same-origin POST만 허용한다. 인증·현재 owner scope에 의존하지 않으며
Cookie/Authorization/Expo cookie·origin을 포함한 입력 header를 폐기하고 고정 Origin,
JSON, contract2만 보낸다. fetch는 credentials omit·redirect error·no-store·no-referrer를
사용하며 응답의 Set-Cookie와 clone의 Set-Cookie도 제거한다. 삭제된 A 계정의 지연된
결과가 새 B 계정의 쿠키를 읽거나 덮어쓰지 않도록 별도 JsonRequester에 연결했다.
이 전송은 삭제 proof만으로 결과를 읽으며 새 인증 권한을 부여하지 않는다.

합성 포트 검증은 header·endpoint/version·redirect/abort 거절과 A→B 교체 중 지연 응답의
credential/사건 작업 저장 불변을 검사한다. 실제 OS cookie jar 전송/기기 로그인 성공이나
삭제 UI·pending 저장·owner별 정리까지 인수한 결과는 아니다. 후속 모바일 소비에서
삭제 pending을 일반 로그인 pending과 분리하고 결과를 확인한 owner만 정리해야 한다.

## native v2 인증·삭제 복구 포트

PR477 main33dd244·main CI40080412168 SUCCESS 뒤 `codex/346-native-provider-v2`에서
일반 로그인 factory와 조립을 공통 capability/재인증 client에 연결한다. 지원 확인 실패나
Apple 미광고를 기존 cookie/verifier 삭제보다 먼저 거절한다. 새 pending에는 협의한 v2를
저장하며 기존3사 pending의 field 집합/JSON은 보존한다. Apple pending에는 v2가 필수이고
알 수 없는 버전은 거절한다. cold return은 저장한 버전으로 검증한다. SDK가 credential
준비를 기다리는 동안 계정이 바뀌면 새 jar를 capture하거나 OAuth IO를 보내기 전에 중단한다.

새 `deletion-attempt.ts`와 `deletion.ts`는 **후속 UI/기기 조립용 포트**다. 일반 로그인
pending과 분리한 최대4개/1900 UTF-8 byte의 journal을 주입한 저장소에 보관한다.
이는 앱이 정한 항목 상한이며 플랫폼의 정확한 최대 용량을 측정한 결과가 아니다.
미확정 proof를 덮어쓰거나 만료/로그아웃/다른 owner 때문에 자동 제거하지 않는다.
다른 owner 기록은 함께 보존한다. accepted/cancelled만 최종 기록이 되며 accepted proof는
토큰 없는 결과로 바뀐다. 정리 완료/다른 owner 때문에 정리를 건너뛴 결과와 취소 결과는
사용자의 명시적 확인 뒤에만 제거할 수 있다. 저장·readback 실패/손상은 안전한 오류로
표시하며 원본을 삭제하지 않는다.

삭제 factory는 literal DELETE·v2·연결된 provider·현재 owner guard를 확인하고 proof를
저장한 뒤 prepare/브라우저로 진행한다. 돌아온 code는 **삭제** exchange에만 보낸다.
유실/사용된 code는 같은 proof의 status 한 번으로만 복구하며 인증 exchange나 삭제를
재전송하지 않는다. 브라우저 취소 뒤에도 서버 cancel의 accepted 승자를 보존한다.
401/404/503·영수증 만료·불명 nonce·복귀 유실은 삭제 성공이나 취소로 바꾸지 않는다.
서버 ACK 뒤 기기 저장/정리가 실패하면 접수 사실과 localSaved/cleanup 실패를 분리한다.
초기 unconfirmed 철회 관측은 confirmed로 갱신될 수 있으며 늦은 관측이 이미 확인한
철회를 지우지 않는다. 제공자 token/code는 journal에 저장하지 않는다.

검증은 frozen/quick(공통480/58files·RN90·server243), unit4032/375files/171569 assertions,
production build/local workerd와 양 OS Metro export다. native proof/기존 로그인 선택
회귀47/762와 설치된 실제 SDK를 쓰는 합성 Naver/Apple 요청·credential 대기 중 owner 교체
거절을 포함한다. 실제 OAuth·native SecureStore·callback/OS runtime 성공은 아니다.
화면은 여전히 기존3사이며 삭제 factory/SecureStore namespace·owner별 정리와 cold/warm
반환 분기·공식 Apple 버튼을 함께 조립한 뒤 capability 기반 UI를 노출한다. 미확정·만료
기록의 사용자 복구와 실제 설정/두 OS 기기 검증도 남아 있다.

## native UI 조립 — PR482 병합, 실제 제공자/기기 인수 전

`codex/346-native-apple-ui`는 선행 auth PR484/main65cc78c와 독립 웹 업로드 PR485/main
d3f4e49를 통합했다. 공식 Apple PNG 1x/2x/3x를
변경하지 않고 `AppleSignInButton`에서 사용하며, 자산 출처/DMG hash/라이선스는
`apps/mobile/assets/auth/APPLE-ARTWORK.txt`에 보존한다. 광고된 provider만 표시하고
공개 capability 조회는 credential/scope와 분리한다. 공개 조회 오류가 별도로 확인한
private session을 해제하거나 legacy 지원으로 바뀌지 않는다.

삭제 proof의 실제 SecureStore namespace와 시스템 브라우저/SDK·독립 completion
requester를 조립했다. cookie writer revision은 scope의 foreground 전환과 구분한다.
이전 삭제의 따뜻한 복귀는 같은 writer일 때만 정리하고, 새 owner는 cookie를 읽거나
쓰기 전에 정리를 건너뛴다. 앱 재시작으로 binding을 잃으면 삭제 접수와 기기 정리 실패를
구분하며, 실제 서버 조회로 비로그인이 확인된 상태에서만 사용자가 기기 정보를 직접
정리할 수 있다. 미확정 작업 저장소는 지우지 않는다. 정리 도중 새 로그인이 시작되면
중단하며 새 reset revision을 이전 요청의 것으로 잘못 재등록하지 않는다.

계정 삭제 화면은 provider 선택·literal DELETE를 인증 전에 요구하고, 접수/취소/미확정,
Apple 연결 해제와 기기 정리·저장 실패를 따로 표시한다. normal/deletion 반환은 journal로
분기하고, 비동기 lookup 중 startup refresh가 정상 로그인 교환을 덮지 않도록 막는다.
Expo Router에는 고정 화면 경로만 전달하며 code/verifier/owner ID를 route param에 넣지
않는다. 이전 서버와 이전 방식의 미확정 삭제 복구 수단은 유지한다.

초기 초안의 blocker였던 만료 미확정 proof는 PR484의 관측 계약을 소비해 복구한다.
새 삭제는 `deletionActivity: 1`을 실제 협의해야 한다. 기본 v2에 flag가 없으면 안전한
오류이며 legacy 삭제로 바꾸지 않는다. 공개 provider 로그인은 기존 capability를 따른다.
기존 OAuth/교환·영수증 TTL과 owner·PKCE 검증은 유지한다.

초기 초안의 검증은 frozen/quick(공통501/60files·RN102/24suites·server243),
production build/local workerd, 양 OS Metro export다. 설치된 SDK를 이용한 합성
coordinator 검증3건은 정상 정리·시스템 브라우저 중 owner 교체·cold 복구와 명시적
비로그인 정리를 다룬다. 실제 Apple/기기·최신 native compile/화면 인수·공개 출시를
완료한 결과가 아니며, source6201112 artifact를 이 새 JS/UI의 증거로 재사용하지 않는다.

## 만료된 삭제 인증 시도의 관측 계약

`x-baro-deletion-activity: 1`을 명시한 capability 요청에만 `deletionActivity: 1`을
추가한다. 같은 기능을 협의한 prepare에만 `activityProof`를 추가한다. 기본 응답과
contract2 header만 사용하는 기존 strict v2 응답은 기존 필드 집합을 유지한다.
공통 client는 협의된 signed receipt가 없으면 실패하며 기존 응답으로 재시도하지 않는다.

activity proof는 원래 issuer·삭제 목적·attemptId·challenge·ownerTag·서버 startedAt에
결합한 HKDF/HMAC이다. 원래 verifier와 함께 무세션 completion 전송으로만 사용한다.
로그인·세션·삭제 권한이나 제공자 토큰이 아니며 새 DB schema/보관 namespace를 만들지
않는다. 운영 secret 교체로 검증할 수 없으면 관측 실패로 남긴다.

`POST /api/mobile/auth/deletion/activity`는 서명을 먼저 검증하므로 불명 nonce를 임의로
조회할 수 없다. 유효한 원래 proof로 확인한 현재 시도가 없으면 `inactive`를 반환한다.
기한 안의 시도는 수정 없이 `active`다. 만료된 삭제 시도는 원래 암호문과 일치하는
행만 CAS로 정리한다. 이미 callback이 guard를 얻었어도 DB 삭제 batch와 정리가 하나의
승자를 갖도록 하며 CAS 충돌은 최대 두 번만 확인한다. 일반 재인증 행·실제 삭제 원장과
영수증은 정리하지 않는다. 인증·code·삭제 영수증의 기존 10분 TTL은 늘리지 않는다.

응답은 `observedAt` 당시의 인증 활동만 나타내며 `outcome`은 항상 `unknown`이다.
`inactive`는 계정 삭제 성공·실패·취소나 nonce의 영구 취소를 증명하지 않는다. 확인된
accepted/cancelled 결과가 있으면 그 결과를 보존한다. 실제 삭제가 먼저 완료됐지만
영수증이 만료된 경우도 `inactive/unknown`이며 성공을 추정하지 않는다.

후속 native 소비는 저장소 용량·중복·같은 owner pending을 먼저 검사하고, 새 UUID로
prepare한 signed receipt 전체를 durable 저장/readback한 뒤에만 OAuth를 시작한다.
prepare 응답 유실이나 저장 실패 때는 OAuth를 시작하지 않는다. 이미 저장한 미확정
기록은 만료·다른 owner 때문에 자동 제거하지 않는다. 명시적 결과 재확인 후 서버가
관측한 inactive 상태와 원래 시각을 보존하고, 새 UUID로 별도 삭제를 시작할 수 있게 한다.
서명 없는 과거 미확정 기록은 그대로 unknown이다. UI 조립은 별도 draft PR482에 있다.

합성 HTTP/실제 로컬 SQLite 검증은 기존 응답 호환, 서명·verifier·owner·환경 변조,
일반 재인증 보존, callback/만료 정리의 양쪽 승자와 rollback, DB 오류의 안전한 응답을
검사한다. frozen install, quick(공통487·RN90·server262), 전체 unit4071/377파일/
171751 assertions, production build/local workerd, 양 OS Metro export가 통과했다.
실제 Apple 로그인·SecureStore·OS callback 성공이나 공개 출시 증거는 아니다.

## native 관측 소비와 새 요청 순서

새 삭제는 일반 로그인과 별도 journal에서 중복 UUID·같은 owner pending·최대4개와
1900 UTF-8 byte 상한을 먼저 검사한다. signed pending이 나중에 inactive 관측을 저장할
공간까지 예약 계산하며, 임시 서명이나 가상의 관측은 실제 저장하지 않는다.
원래 owner guard로 prepare한 signed receipt를 받은 뒤 실제 startedAt·activityProof를
원래 verifier와 함께 저장하고 정확한 readback을 마쳐야 SDK authorize/브라우저를 연다.
준비 응답 유실·서명 누락·owner 교체·저장 실패는 OAuth 전에 중단한다. 이때 OAuth를
시작하지 않은 미저장 준비를 삭제 접수/취소나 복구 불능의 unsigned pending으로 꾸미지 않는다.

사용자가 결과 재확인을 누르면 같은 proof의 status 한 번, 서명이 있는 pending의 activity
한 번만 실행한다. active/오류/서명 없는 과거 기록은 미확정으로 보존한다. inactive이면
commit 경합 승자의 영수증을 한 번 더 확인하고, 긍정 결과가 없으면 원래 proof와 서버의
observedAt을 보존한 inactive 기록으로 저장한다. 조회는 cookie·현재 owner scope를 쓰지
않으며 OAuth/삭제 exchange를 재실행하지 않는다. 동시에 저장한 accepted/cancelled가
관측보다 우선하고, inactive에도 아직 유효한 영수증이 오면 실제 accepted로 복구한다.

inactive UI는 관측 시각의 활성 인증 부재와 **삭제 결과 미확인**을 함께 표시한다.
새 삭제는 별도 UUID·현재 계정 검증·새 DELETE 입력으로만 시작한다. 원래 createdAt과
서버 startedAt을 현재 시각으로 바꾸거나 만료만으로 결과를 확정하지 않는다. 기록 삭제는
사용자가 결과 재조회 불가 안내를 읽고 명시적으로 선택한 경우에만 가능하다.
accepted의 기기 정리/저장 실패와 Apple 철회 미확인도 별도 상태로 유지한다.

설치된 SDK와 실제 native 조립을 사용한 합성 포트 검증은 정상 정리·새 owner 보존·cold
정리·만료 관측 및 prepare 응답 유실/서명 누락을 검사한다. SecureStore는 주입한 대역이며
실제 Apple 계정 로그인·OS cookie jar·물리 기기·스토어 성공을 뜻하지 않는다.

PR484 exact head6586223의 CI40091147033와 병합 main65cc78c의 CI40091361352가
성공한 뒤 소비 코드를 구현했다. PR485/main d3f4e49·CI40091786099도 통합했으며,
최종 소비 검증은 frozen install, quick(공통523/60파일·RN106/24suites·server262),
전체 unit4117/379파일/172020 assertions, production build/local workerd와 양 OS Metro
export다. 새 signed 순서·관측·모델/저장소 회귀38건/597 assertions와 실제 SDK 조립/
화면 회귀10건도 포함한다. 웹 UI 소유 경로는 수정하지 않았다. 새 JS/자산의 native
컴파일·runtime 검증은 후속이며 이전 source6201112 앱을 이 변경의 증거로 쓰지 않는다.

PR482는 exact head6ddc1ee·CI40092177537 성공 뒤 main9436e77에 병합됐고,
main CI40092440802도 성공했다. 이 새 소스의 내장 제품 번들 컴파일은 Android
[40092725450](https://github.com/creno-va/baro/actions/runs/40092725450)와 iOS Simulator
[40092729846](https://github.com/creno-va/baro/actions/runs/40092729846)로 요청했다.
결과가 나오기 전 native 컴파일·실행 성공으로 간주하지 않는다.

배포된 preview d3f4e49에서 무세션 GET3회로 기본 strict capability 응답과 명시적
activity1 협의·private/no-store·Set-Cookie 부재를 확인한
[공개 계약 관측](../quality/mobile-native-9436e77/public-capabilities-d3f4e49.json)을 보존한다.
현재 광고된 provider는 Google·네이버·카카오이며 Apple은 광고되지 않았다. 원인이
미설정인지 특정 key 조건인지는 이 공개 응답으로 판단하지 않는다. 실제 인증·native IO나
preview를 앱 소스9436e77로 배포했다는 증거가 아니다.

Android compile40092725450은 SUCCESS다. 원본 APK57,219,314bytes·SHA256
`a7b048e099ca9cf64a9865370ea035685c4f3f21505ab870628998c387ea5d30`와
내장 Hermes3,653,896bytes·SHA256
`b1da81a67fb09010906988367e3e877132cd18eb5edf368fc152958d3f413afe`를
다운로드한 전체 원본에서 대조했다. CI compiler provenance·엄격한 receipt schema와
폰트 byte, 공식 Apple PNG3종의 투명 여백 포함 RGBA pixel을 확인한
[독립 원본 검사](../quality/mobile-native-9436e77/android-local-original-verification.json)와
[원래 영수증](../quality/mobile-native-9436e77/receipt-android.json)을 보존한다.
Android packaging은 PNG container byte를 바꾸므로 이 검사는 source PNG와 decoded pixel
동일성이지 압축 PNG 전체 byte 동일성 주장이 아니다. 기존 verifier의 runtime 입력을 이
artifact12560156134·원래 receipt SHA d74ee221…로 고정한다. 재컴파일/재서명은 하지 않았다.
앱 실행·실제 제공자 로그인·물리 기기·store 성공은 아직 검증하지 않았다. iOS 결과는 별도다.

iOS Simulator compile40092729846도 SUCCESS다. 원래 receipt SHA256
`7eca8b6ba896923f55c9f376c3bdd0818f60a3595dc994699dab8a67e771b5b0`와
앱 ZIP21,580,352bytes·SHA256
`4d7303fdd7bb2224dc3c3ef7ad28ff57c588bc9bc7053769dfc3623c6d0a51b0`,
내장 Hermes3,665,732bytes·SHA256
`654e59f889e83dd77a94ddb026ad4f2feafe38911cccb0f40f78f38bd0998c1b`를
전체 원본에서 대조했다. 엄격한 compiler receipt와 provenance·폰트 byte 및 공식 Apple
PNG3종의 원본 byte/RGBA pixel을 확인한
[iOS 독립 검사](../quality/mobile-native-9436e77/ios-local-original-verification.json)와
[원래 영수증](../quality/mobile-native-9436e77/receipt-ios.json)을 보존한다.
artifact12560595376의 accepted 앱만 후속 verifier 입력으로 고정하며 별도로 보존된
unaccepted compile ZIP을 바꿔 쓰지 않는다. 제품 bundled inputs는 source9436e77과 같다.
재컴파일/재서명·source map 재생성이나 실제 실행/Apple 로그인·물리 기기·store 인수가 아니다.
