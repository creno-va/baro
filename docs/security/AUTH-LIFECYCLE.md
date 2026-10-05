# 인증 수명과 offline 검증

## 서버 계약

- Better Auth D1 세션은 기본 7일, 마지막 갱신 기준 1일 간격으로 갱신한다. 쿠키 cache는 사용하지 않는다.
- Hono API는 `getSession(context)` helper를 사용해 갱신/폐기 `Set-Cookie`를 클라이언트 응답에 전달하고 개인화 응답에 `Cache-Control: no-store`를 설정한다. DB 만료와 브라우저 쿠키 만료가 함께 갱신되어야 한다.
- `session.oauth_authenticated_at`는 Google/Naver/Kakao의 검증된 callback으로 새 세션을 만들 때만 기록한다. 세션 갱신은 이를 바꾸지 않는다. 클라이언트 입력은 허용하지 않는다.
- `hasRecentOAuthAuthentication(session, now)`는 유효한 세션과 현재부터 10분 이내의 OAuth 시각을 요구한다. 없음·미래·잘못된 날짜·만료는 false다. 계정 삭제 #17은 이 helper를 사용하고 재인증 후에도 명시적 삭제 확인을 다시 요구한다.
- 계정의 access/refresh/ID token과 expiry는 create/update 모두 null 처리한다. IP 수집을 끄고 User Agent/IP도 session create/update에서 null 처리한다. provider 계정의 암묵적 이메일 연결을 허용하지 않는다.
- Origin/CSRF 검사는 테스트 환경에서도 명시적으로 켠다. 필수 동의는 인증 자체의 조건이 아니며, 조회·로그아웃·삭제를 정책 버전 변경으로 막지 않는다. 사건 쓰기 gate 적용은 #11이 소유한다.

## 정리와 rollout

`0002_oauth_session_security`는 nullable 시각 필드만 추가하고 기존 세션·계정을 보존한다.
기존 세션은 OAuth 시각이 null이므로 민감한 동작 전에 실제 재인증이 필요하다.
기존 IP/User Agent 값은 세션 갱신 또는 정리까지 남을 수 있다. 기존 provider token은 계정 갱신에서 제거되며, 이 migration은 과거 데이터를 일괄 덮어쓰지 않는다.

Worker의 일일 UTC 00:00 cron이 `cleanupAuthData`를 호출한다. 만료한 session/verification,
또는 생성 후 29일이 지난 보안 레코드를 지워 정상적인 일일 실행 시 30일 상한 이내로 정리한다.
sliding 갱신도 원래 세션 생성 후 29일을 넘기지 않는다. 계정·동의 데이터는 이 정리의 대상이 아니다.
cron 실패는 실패한 invocation으로 보고되며 성공으로 삼키지 않는다. #19의 운영 게이트는 일일 cron 실행 여부·실패를 감시하고 실패 시 정리를 재실행해야 한다.
cleanup 테스트는 반복 호출, 만료 경계, 보존 상한과 유효 데이터 보존을 검증한다.

## 재현

```bash
bun ci
bun run check
bun run build
bun run cf:dry-run
bunx playwright install chromium
bun run test:ui
```

`tests/helpers/oauth.ts`는 공급자의 토큰 교환·프로필 응답만 합성 대역으로 바꾼다.
실제 Better Auth route/state/cookie/hook과 SQLite SQL은 그대로 실행해 세 공급자의 성공,
취소, state mismatch, cookie 누락, state 만료·재사용, 세션 만료를 확인한다.
추가 테스트는 token create/update 제거, metadata 최소화, 최근 인증 불변성, 7일/1일 수명,
CSRF, 로그아웃 폐기, 정책 변경·만 14세 gate, fresh/upgrade migration과 drift를 확인한다.

Playwright는 로컬 페이지의 API 응답만 합성하여 network/provider/callback/loading 오류와
Tab/Space/Enter 흐름, 제출 중 비활성화, 재시도 초점 복귀를 검증한다. 실제 OAuth 성공을
주장하는 증거가 아니며 콘솔 승인·실제 callback smoke는 외부 gate #27에 남는다.
