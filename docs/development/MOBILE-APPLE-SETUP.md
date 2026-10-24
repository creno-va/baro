# Apple 로그인 설정 인계

2026-10-24 / #346. 사용자가 Apple 로그인 추가와 Developer Program 회원 계정 보유를
확인했다. 실제 콘솔 설정·키 서명·provider 응답·로그인/삭제는 아직 미검증이다.
[승인 범위와 구현](./MOBILE-APPLE-LOGIN-DECISION.md)을 유지하며 production 공개 출시와
provider token 장기 보관은 포함하지 않는다.

## 콘솔에서 대조할 값

| 항목 | preview 기준 | 의미 |
| --- | --- | --- |
| 앱 Bundle ID | `site.baro.app.preview` | 현재 RN/Expo preview 앱 식별자 |
| Services ID | 운영자가 콘솔의 실제 값 확인 | 웹 OAuth의 client ID·client secret JWT의 subject |
| domain | `preview.baro.site` | scheme/path를 넣지 않는 웹 domain |
| return URL | `https://preview.baro.site/api/auth/callback/apple` | Apple의 HTTPS POST 반환 수신점 |
| 앱 내부 반환 | `baro-preview://auth/callback` | 서버 검증 뒤 native 앱 복귀용; Apple return URL 입력값과 구분 |
| Worker | `baro-preview` | 해당 환경의 credential 등록 대상 |

Services ID를 Bundle ID라고 가정하거나 이 문서에서 임의로 발급하지 않는다. 기존 primary
App ID/Services ID가 있으면 실제 연결·다른 앱의 사용 여부부터 확인하며 해제/삭제/재그룹하지
않는다. production 식별자 `site.baro.app`와 credential은 독립 확인 대상이다.

## Apple Developer 콘솔

[Apple 웹 인증 설정](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/)에
따라 Sign in with Apple을 켠 primary App ID에 Services ID를 연결한다. Identifiers에서
해당 Services ID의 Sign in with Apple→Configure에 위 preview domain/return URL을
등록하고 Save까지 완료한다. 이미 있으면 값의 일치만 대조한다. 앱 scheme이나 localhost를
HTTPS 반환점으로 바꾸지 않는다. 계정에서 항목을 수정할 권한이 없으면 권한 있는 담당자가
실행하며 회원 보유만으로 관리 권한을 가정하지 않는다.

[Apple private key 안내](https://developer.apple.com/help/account/capabilities/create-a-sign-in-with-apple-private-key/)대로
연결된 primary App ID용 Sign in with Apple key와 key ID를 관리한다. 기존 키를 재사용하는
경우 원래 용도와 회전 계획부터 확인한다. private key 원문·client secret·Apple 계정 암호·
2FA code는 채팅/PR/CI artifact나 앱/저장소에 넣지 않는다. 콘솔 값을 확인하는 단계에서
키 폐기나 다른 앱의 연결을 해제하지 않는다.

## 서버 credential 인계

현재 구현은 Worker의 세 값 `APPLE_AUTH_ENABLED`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`을
읽는다. `APPLE_CLIENT_ID`는 위 실제 Services ID다. client secret은 그 ID를 subject로
사용해 관리자가 private key로 서명한 ES256 JWT다. 서버의 `appleConfiguration`은 key/team
ID 형식·audience·subject·iat/exp·최대15,777,000초·서명 길이를 검사하지만, **Apple이 실제
서명을 수락했다는 검증은 아니다**. private key를 앱에 넣거나 Worker가 실행 중 생성하는
방식이 아니다. 키 관리/발급은 계정 담당자의 비공개 환경에서 수행한다.

Worker credential은 기존 환경별 secret 등록 절차로 `baro-preview`에만 인계한다.
값을 출력하는 명령·shell trace·로그·환경 파일 첨부로 검증하지 않는다. 만료 시각과 담당자,
영향 환경만 비민감 운영 기록에 남긴다. 기존 Google/네이버/카카오 credential·암호화 키·
세션을 덮어쓰거나 환경 간 키를 복사하지 않는다. 실제 인수 전 enabled 상태와 변경/복원
방법을 배포 담당자와 조율하며, preview release SHA/동일 SHA smoke를 별도로 남긴다.
production 활성화/서명/스토어 제출과 공개 승인은 이 문서의 설정 작업으로 대체하지 않는다.

## 설정 후 실제 인수 순서

1. 대상 preview API SHA와 현재 앱의 원본 source/build/hash를 각각 확인한다. 공개 capability
   GET에 기존3사와 Apple이 표시되는지 확인하되 credential 유효성/로그인 성공 증거로 쓰지
   않는다. Apple 누락 시 설정 담당자가 feature flag·Services ID/secret·만료를 비공개로
   대조한다. 기존3사를 막거나 임의 fallback/가짜 Apple 성공을 표시하지 않는다.
2. 계정 담당자가 통제하는 별도 검증용 계정으로 동의/취소, email 숨김/공유, warm/cold 복귀와
   실제 callback 교환을 수행한다. Apple login 화면·URL·쿠키·authorization code·token·사용자
   식별자/이메일·raw native 로그는 수집/공개 artifact로 남기지 않는다. 비민감 결과만 source,
   API SHA, OS/모델, 시각, 성공/실패 고정 단계로 기록한다.
3. 기존 계정의 명시적 연결/최근 재인증을 확인한다. 이메일이 같다는 이유로 계정을 자동
   합치지 않는다. 이전3사 앱/구버전 계약과 account 삭제 접근도 함께 확인한다.
4. 새 삭제 의도를 사용자 확인으로 시작해 linked Apple의 재인증→BARO 삭제 수락/복구와
   Apple revoke 결과를 각각 확인한다. revoke 오류·응답 유실은 미확인으로 보존하며 BARO
   삭제 성공과 Apple 해제 성공을 같은 상태로 표시하지 않는다. 테스트 성공을 위해 provider
   token 장기 보관을 추가하지 않는다.
5. 실제 결과를 #346과 원본 증거에 연결한다. 물리 기기·reader·전체 private 여정·보안 high2·
   최종 full/#71·서명/스토어 요구가 남으면 해당 이슈와 공개 gate를 열어 둔다.

설정 담당자의 상태 응답은 ‘등록 전 / 등록 완료 / 다른 담당자가 설정 중’ 정도면 충분하다.
키/secret 전송이나 콘솔 전체 screenshot을 요구하지 않는다.
