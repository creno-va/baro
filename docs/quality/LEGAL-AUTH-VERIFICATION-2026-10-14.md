# 법률 API·인증 검증 기록 — 2026-10-14

- 관련 이슈: #27 / #63 / #71. #20/#70은 정책 초안 인수 완료를 유지한다.
- 코드 검사 기준: `7a617b5acf08c7168482caa3e08ff07208416270`.
- 실행 환경: macOS 로컬 Bun 1.3.14, 격리 SQLite와 Chromium. 포털은 사용자가 로그인한 Safari.
- 이 기록은 관찰 보고서다. 배포 Worker 성공이나 정식 릴리스 receipt를 발급하지 않는다.

## 공식 포털 확인

2026-10-14 20:35~20:40 KST에 기존 신청의 수정 화면을 열어 읽었다. 저장·재신청·키 재발급은
하지 않았다. 계정 연락처·OC·인증 URL·원문 응답은 이 문서에 포함하지 않는다.

| 항목 | 확인 결과 | 해석·남은 범위 |
| --- | --- | --- |
| 신청 | 2026-10-05 신청, 시스템·도메인 `baro.site`, `연결 / 승인` | 승인 화면만으로 배포 환경의 실제 호출 성공을 판정하지 않는다. |
| 서비스 | 인터넷 접근, 대한민국 현행법령과 판례 모두 목록 JSON·본문 JSON 선택 | 공식 자가진단에서 `eflaw/JSON`, `prec/JSON`도 사용 가능으로 표시됐다. |
| 활용 목적 | 비어 있지 않음. 기존 B2C/B2B 기능·사업 모델 기재 | 현재 무료 MVP와 다른 유료 후보·예약/문의함 설명이 남아 있다. 서비스 책임자가 현행 범위로 정합화할 문안이며, 이번에 신청을 수정하지 않았다. |
| 네트워크 | 신청의 서버 IP 목록은 비어 있음. IP 접속이력의 등록 목록에 도메인 표시 | 도메인을 GitHub Actions/Cloudflare Workers의 출발 IP 허용 증거로 쓰지 않는다. |
| 접근 실패 이력 | 포털의 최근 7일 실패 목록 없음 | 포털이 보여 주는 범위의 결과다. 모든 외부 호출의 성공 또는 IP 제한 부재를 입증하지 않는다. |
| 현재 OC | 로그인한 신청 화면에서 현재 값 존재 확인 | GitHub/Cloudflare 저장값은 원문 재조회가 불가능하다. 값의 존재·갱신 시각만으로 동일하다고 표시하지 않는다. |

공식 [자가진단](https://open.law.go.kr/LSO/lab/selfDiagnosis.do)에 실제 코드의 공개 합성 검색
조건으로 법령·판례 목록을 각각 한 번 입력했다. 두 target 모두 사용 가능으로 표시됐고,
각각 `LawSearch`·`PrecSearch`와 레코드 식별자가 포함된 응답이 화면에 나타났다.
단, 법령 `display=100` 입력이 진단 결과에서 `20`으로 표시되어 진단기의 요청 재구성 가능성이
있고, 접근성 텍스트의 응답 노출도 512자로 잘렸다. 목록 전체·본문·날짜·hash·인용 span을
검증한 결과로 승격하지 않는다. 자가진단 입력 2회와 readiness의 최대 9회 예약 한도는 별도
기록이며, 이번에는 기존 readiness를 재실행하지 않았다.

20:42~20:46 KST에는 포털에서 확인한 현재 OC로 Safari 직접 호출을 제한 진단했다. 기존 코드와
같은 `eflaw` 목록 요청은 필수 입력 검증 오류가 재현됐다. 자가진단 응답의 상세 링크에 있던
`mobileYn=Y`를 추가하면 `LawSearch`가 나타났고, `mobileYn=N`에서는 같은 오류가 나타났다.
Y 응답 전체를 저장해 검증하려고 한 번 더 열었으나 로컬 저장 파일 생성은 확인하지 못했다.
직접 API 탐색은 합계 4회, 자가진단 입력은 2회다. 페이지 표시에서 확인한 결과이므로 HTTP
status·목록 완전성·정확한 본문 tuple/span의 성공을 주장하지 않는다.

이 결과는 현재 포털 OC에서도 기존 요청이 거부된다는 증거다. 저장 키 불일치를 유일한 원인으로
단정하거나 키를 덮어쓸 근거가 되지 않는다. `mobileYn=Y`는 응답 차이를 만드는 조건이지만,
신청은 인터넷 접근이고 포털은 모바일 본문 HTML 제공을 안내한다. 이 차이를 승인 범위·본문
JSON 지원과 대조하기 전 제품에 모바일 경로를 추가하지 않는다. 반복 검사 대신 담당기관에
인터넷 JSON 요청의 필수 변수와 자가진단 경로의 차이를 확인한다.

공식 [법령 목록 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=lsEfYdListGuide)의
OC는 신청 인증값이다. 등록 도메인·IP·목적·서비스 형식을 하나의 인증 조건으로 합쳐 추정하지 않는다.

## 이전 실패와 기관 안내

기존 [readiness 실행](https://github.com/creno-va/baro/actions/runs/38394216718)은
2026-10-13T12:00:51Z, SHA `198663992e835fc507856b5abb54cfdeeb049de0`의 preview credential을
사용한 CI adapter 검사였다. `runtimeWorker:false`, 법령·판례 `upstream-error`, 확인된 출처 0,
`claimIntegrity:null`이었다. [당시 진단 기록](https://github.com/creno-va/baro/issues/71#issuecomment-6145179670)을
보존한다. 이번 포털 관찰은 그 환경·SHA의 실제 출처 성공을 대체하지 않는다.

2026-10-14 공식 [기관 안내 원문](https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=734&ccfNo=3&cciNo=1&cnpClsNo=4)에
개정 사항 반영 예정 안내가 여전히 표시됨을 확인했다. 해당 문구는 본문 상단의 관련 법령 안내이며
기사 영역 바깥에 있다는 이유로 무시할 수 없다. 기존 `update_pending`을 유지하며 parser를
완화하거나 원문 최신성 통과로 바꾸지 않는다. 이 웹 관찰 자체는 source tuple/hash 검증이 아니다.

## 합성 인증·소유권 검증

실제 DB migration과 기존 `seedTestSession`의 서명 쿠키를 사용했다. 임의 JWT·localStorage
인증·공개 우회 endpoint는 추가하지 않았다. 외부 Google/Naver/Kakao의 토큰 교환·프로필만
대역으로 바꾼 검사는 실제 Better Auth state/callback/쿠키·DB 처리와 구분해 아래에 기록한다.

| 검사 | 종료 시각(KST) | 결과·검증 범위 |
| --- | --- | --- |
| 인증·동의·법률 출처 집중 Bun 검사 11파일 | 20:31 | 170 pass, 0 fail, 1,256 assertions. OAuth 성공/취소/state 불일치·만료·재사용, 서명 변조·만료·로그아웃, 동의, 정상/오류 법률 응답·식별자/날짜/hash/span·갱신 대기 |
| `auth/session/settings` 브라우저 | 20:31 | 19 pass. 실제 SQL 세션·서명 쿠키의 동의 저장/철회·로그아웃과 UI 계약. 일부 화면 응답 대역 포함 |
| `customer-real` 브라우저 | 20:34 | 6 pass. 서로 다른 두 사용자의 실제 API/SQL·쿠키 교체, 소유 사건 접근 차단, 390/640/1280px, 저장 응답 유실·오래된 응답·로그아웃 시 임시 내용 정리 |
| `account-session-recovery` 브라우저 | 20:35 | 15 pass. 실제 state/callback/SQL을 거치는 공급자 대역 검사 1개와 역할/계정 변경·세션 조회 장애/복구 화면 계약 |
| 사건·파일 소유권/세션 철회 Bun 검사 4파일 | 20:39 | 12 pass, 0 fail, 88 assertions. 소유권 검사·세션 만료/철회 중 원본 다운로드 차단 |

합계 집중 Bun 182개와 브라우저 40개가 통과했다. 브라우저 trace는 끄고 합성 데이터만 사용했다.
이 결과는 실제 공급자의 앱 승인·사용자 로그인·배포별 callback 성공이 아니다.

20:49 KST `validate:quick`도 통과했다(문서·작업 그래프·경계·lint·typecheck, 도구/워크플로
18 tests / 257 assertions). 제품 코드·API·schema·비밀값·정책/동의 버전은 변경하지 않았다.
`work:next`의 실제 GitHub 대조에서는 기존 #231의 `UNTRACKED`를 확인했으며 법률/인증 선행
구현 병합은 확인했다. 다른 담당의 작업 그래프 범위를 이 검사에서 수정하지 않았다.

20:49 KST preview의 Google 버튼에서 실제 Google 로그인 입력 화면까지 이동했다. 사용자
로그인·callback 복귀 전이므로 실제 OAuth 성공은 아직 pending이다. preview 실행
[38556937083](https://github.com/creno-va/baro/actions/runs/38556937083)의 Worker 반영 SHA는
`7a617b5acf08c7168482caa3e08ff07208416270`이며, 해당 실행의 AI 재원 검사 실패와 OAuth 증거는
구분한다. 실패한 배포 workflow를 배포 전체 성공 receipt로 승격하지 않는다.

재현 명령은 저장소의 기존 검사만 사용한다.

```sh
bun ci
bun test src/server/auth/oauth.test.ts tests/auth-lifecycle.test.ts tests/auth-readiness-api.test.ts tests/consent-api.test.ts tests/harness-d1.test.ts tests/page-access.test.ts tests/legal-retrieval.test.ts tests/legal-retrieval-v2.test.ts tests/legal-readiness-v2.test.ts tests/legal-source-integration.test.ts tests/reports-legal-sources.test.ts
bun test tests/cases-api.test.ts tests/v2-files-router.test.ts tests/files-session-revocation.test.ts tests/workspace-files-read.test.ts
bunx playwright test tests/browser/auth.e2e.ts tests/browser/session.e2e.ts tests/browser/settings.e2e.ts --trace off
bunx playwright test --config tests/browser/customer-real.config.ts --trace off
bunx playwright test --config tests/browser/account-session-recovery.config.ts --trace off
bun run validate:quick
```

## 남은 행동과 담당기관 문의 초안

| 담당 | 다음 행동 | 완료 증거 |
| --- | --- | --- |
| 법률 API·설정 운영자 | 현재 포털 OC와 각 환경에 주입된 값의 비공개 일치 확인. 확인된 설정 불일치만 수정 | 원문·해시 없이 환경별 일치/불일치 결과, 확인 시각과 방법 |
| 법률 API 담당 | 설정/조건 변경 뒤 기존 bounded readiness 1회. 별도로 배포 Worker에서 제한 검증 | 환경·정확한 SHA·시각, 목록/본문 ID·날짜·hash·span, CI adapter/Worker 구분. 실패한 원문·쿼리 URL은 제외 |
| 기관 안내 담당 | 원문 제공기관의 개정 반영 확인 후 기존 parser로 재검증 | source tuple과 검증 시각. `update_pending`을 수동으로 해제하지 않음 |
| 인증 담당·사용자 | 실제 Google/Naver/Kakao 로그인과 환경별 callback·앱 승인 확인 | 공급자·환경·배포 SHA·시각·성공/취소/복귀. 토큰/쿠키/실계정 상세 제외 |
| 서비스·정책 담당 | [내부 정책 점검표](../development/LAWYER-POLICY-HANDOFF.md)의 미확정 사실·초안 불일치 정리 | 현재 사실·근거·담당·다음 행동. 외부 법률 승인·정식 게시·동의 버전 변경은 별도 |

설정이 일치해도 실패 원인이 남는 경우, 아래 내용을 공식 문의용으로 사용한다. **발송하지 않았다.**

- 기존 신청은 연결/승인이고 인터넷·법령/판례 JSON 목록/본문이 선택돼 있다. 활용 목적은 입력돼 있다.
- 포털의 로그인한 사용자 자가진단은 두 target의 이용 가능과 목록 응답을 표시한다.
- 별도 GitHub Actions 실행은 HTTP 200 오류 envelope로 분류됐다. API 키 오류나 IP 제한으로 단정하지 않는다.
- 현재 포털 인증값으로 Safari에서 동일 인터넷 요청을 보내도 필수 입력 오류가 발생한다.
  같은 URL의 `mobileYn=Y`는 목록을 표시하고 `N`/생략은 오류다. 인터넷 JSON 목록/본문의
  현재 필수 변수가 무엇인지, 모바일 표시 경로를 인터넷 신청에서 이용할 수 있는지 확인한다.
- 도메인만 등록된 환경에서 GitHub Actions·Cloudflare Workers처럼 출발 IP가 달라지는 서버 호출에
  별도 등록/허용 조건이 있는지, 자가진단이 입력 URL의 host/HTTPS/변수를 어떻게 재구성하는지 확인한다.
- 담당기관이 요청한 경우에만 인증된 비공개 경로로 계정 참조·정확한 실패 시각·필요한 진단값을 제공한다.
  공개 이슈에는 OC·전체 인증 URL·사용자 사건·응답 원문을 넣지 않는다.

이번 기록으로 #27/#63/#71을 닫거나 미지원 릴리스 증거를 통과 처리하지 않는다.
