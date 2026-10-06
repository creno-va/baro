# 배포 및 운영

- v1 실제 배포와 v2 구현 목표를 구분한다. #53은 문서 변경이며 리소스/공개 상태를 바꾸지 않는다.
- v2 자원·파일 처리·예산은 [자료 처리](./FILE-PROCESSING.md), [비용 통제](./COST-CONTROLS.md),
  [삭제/복구](./DELETION-RESTORE.md)를 함께 따른다.

## 환경

| 환경 | 목적 | 데이터·외부 연결 |
| --- | --- | --- |
| local | 개발·단위/통합 테스트 | local D1, 법률 fixture, 개발 OAuth 또는 mock |
| preview | 통합·실제 OAuth smoke | 전용 D1/Workflow/Gateway/OAuth, 실제 법률 API |
| production | 현재 foundation; 승인 후 공개 서비스 | 전용 리소스와 secret, 실제 연동은 별도 검증 |

환경 간 DB·KV·암호화/세션 서명 key는 분리한다. OAuth client는 2026-10-07 사용자 명시
승인으로 Preview/Production에서 같은 Google/Naver/Kakao 앱을 공유한다. 두 환경의 callback과
tester/audience 권한은 각각 확인하며 소셜6필드만 각 GitHub Environment에서 Worker에 적용한다.
`BETTER_AUTH_SECRET`은 이 sync에 포함하지 않는다. preview는 고정 hostname을 사용한다. PR별 build는 가능하지만 OAuth callback을 동적으로 추가하지 않는다.

고정 preview URL은 `https://preview.baro.site`다. Worker,
D1, Workflow, SESSION KV는 `preview`와 `production` 이름으로 각각 분리한다.

공식 Custom Domain은 production `https://baro.site`, preview
`https://preview.baro.site`다. `workers.dev` 주소는 장애 확인용 보조 endpoint로만
유지하고 OAuth callback과 사용자 공개 URL은 Custom Domain을 기준으로 등록한다.

## 브랜치와 배포

- pull request: 정적·테스트·build (stacked PR도 CI 실행), PR에서는 고정 preview를 덮어쓰지 않음
- `main`: 승인된 변경을 preview에 자동 배포
- production: preview smoke와 출시 체크 통과 후 GitHub Environment 수동 승인
- hotfix도 같은 테스트를 거치며 직접 콘솔 편집은 장애 봉쇄 외 금지

GitHub Actions는 최소 권한 OIDC 또는 환경별 제한 secret을 사용한다. production 승인자와
배포 실행자는 가능하면 분리한다.

현재 GitHub 설정: main은 Quality gate·최신 base·대화 해결·linear history를 요구하고
승인 review 수는0이다. production Environment에는 `hyunhomon` 승인자가 있다.
CODEOWNERS 알림은 별도 강제 승인과 같지 않다. 에이전트의 merge 권한은 사용자 지시를 따른다.

production dispatch에는 `confirmation=production`, `target_sha=<full40sha>`,
`release_mode=foundation|public-beta`를 지정한다. 기본 foundation은 API 공개를 닫는다.
성공한 main push CI와 해당 SHA의 preview Deployment success가 없으면 실패한다.
preview success 기록은 동일 RELEASE_SHA의 health/ready smoke 뒤에만 만든다.
foundation smoke는 캐시 없는 read-only 요청으로 배포 전파를 최대 7회 기다린다.
대기 간격은 2/4/8/16/16/16초, 요청별 timeout은 최대10초, 전체 deadline은90초다.
매 시도에서 live와 ready 둘 다 정확한 full SHA·환경·서비스·상태·correlation을 확인하고,
ready의 schema version은 checkout한 candidate의 Drizzle journal 마지막 tag와 정확히
일치해야 한다. 새 Worker SHA와 이전 DB schema가 섞이면 검증된 배포로 기록하지 않는다.
서로 다른 시도의 부분 성공을 합쳐 통과시키지 않는다.
실패 출력은 endpoint·유한 오류 코드·시도 수만 포함하며 응답 원문이나 stack을 남기지 않는다.
public-beta는 `bun run release:check`로 정책 Approved 상태와 release-evidence를 확인한다.
향후 #18/#19의 실제 eval/E2E/live smoke artifact를 해당 증거 URL에 연결해야 하며
boolean 수동 변경만으로 실제 검증을 대신하지 않는다.

## 2026-10-07 사용자 명시 공개 승인 예외

사용자가 공개 조건을 모두 검증했다고 진술하고 운영을 즉시 공개하라고 명시했다.
이 직접 승인은 독립 외부 receipt/법률 검토자·사업자 원문 검증과 구분해 기록한다.
기존 `public-beta`의 `release:check`, 정책 Draft 및 미완료 release evidence는 수정하지 않는다.

이번 공개는 `release_mode=operator-authorized`와 #71의 지정 운영자 `hwangeunchan`이
기록한 직접 사용자 승인 receipt를 사용한다. `launch_authorization_comment`는 해당 댓글의
숫자 ID이며 실행 script가 GitHub에서 읽어 issue/author/직접 사용자 지시·정확한 targetSHA·
최대24시간 유효기간을 검사한다. 독립 external 완료와 혼동하는 receipt는 거부한다.
SHA의 main CI/preview deployment, production Environment의 hyunhomon 승인은 그대로 필수다.
사람 승인 없이 이 예외를 만들거나 future SHA에 재사용하지 않는다. 운영자가 공개를 승인한
사실과 실제 OAuth/사건/프로필 및 외부·정책 증거의 확인 범위는 각각 journal에 기록한다.

## 배포 순서

1. 문서/계약과 migration 일치 검사
2. preview D1 backup 식별자 기록
3. immutable SHA의 offline 검사·build/dry-run 성공 후 additive migration 적용 및 검증
4. Worker/Workflow 배포, health/ready의 SHA 확인
5. preview 실제 OAuth·Turnstile·법률 API smoke
6. production D1 backup 식별자 기록
7. 역호환 migration 적용
8. Worker/Workflow 배포 및 합성 smoke
9. 지표를 집중 관찰한 뒤 완료 선언

현재 자동 smoke는 foundation health/ready·SHA·candidate schema다. 단계5/8의 전체 제품 smoke와
backup/bookmark 기록·복구 drill 자동화는 #19에서 완료한다. migration 검증 없이 build보다
먼저 remote DB를 바꾸지 않는다. preview migration/deploy는 cancel하지 않고 순차 실행하며
적용 직전에 main SHA와 비교해 뒤늦게 끝난 오래된 CI 배포를 거부한다.

같은 커밋에 공개 기능을 추가할 때 필요한 env/binding/secret이 준비되지 않았으면 공개
전환을 하지 않는다. 실제 등록 상태는 [실행 기준](../development/EXECUTION.md)와 #27을 따른다.

파괴적 schema 변경은 최소 두 번의 배포로 분리한다. 오래 실행 중인 Workflow가 이전
schema/prompt를 사용할 수 있으므로 호환 기간을 둔다.

## 설정 확인

- 모든 binding/secret이 환경별로 존재하고 placeholder가 아님
- OAuth callback과 allowed origin이 정확한 HTTPS URL임
- AI Gateway payload logging이 꺼짐
- AI Gateway Unified Billing credit 잔액과 Gateway·사용자·모델 spend limit이 설정됨
- production에서 법률 fixture adapter와 source map 원문 노출이 비활성화됨
- CSP가 OAuth와 Turnstile을 막거나 과도하게 열지 않음
- current policy version이 게시된 문서 버전과 일치함

## 이미 공개된 production의 누락 runtime 설정 복구

`Recover production runtime`은 main의 검증된 복구 코드로 현재 공개 중인 production SHA의
누락 설정만 복구한다. `confirmation=production`, `expected_live_sha=<현재 full40 SHA>`를
지정하고 기존 production Environment 승인을 받는다. 일반 배포와 같은
`cloudflare-production` concurrency를 사용하며 공개 gate, Worker 코드, migration은 변경하지 않는다.
새 production 배포 성공 증거를 만들지 않으며 이후 코드 배포는 기존 release 절차를 따른다.

- `CASE_DATA_KEY_V1`은 GitHub production에 이미 보관된 동일 키만 사용한다. 생성·회전·다른
  환경 키 복사는 하지 않는다. `LAW_API_OC`도 승인된 production secret을 사용한다.
- `baro.site` 전용 Managed/no-clearance Turnstile widget을 재사용하거나 없으면 생성한다.
  공유·중복 widget과 잘린 조회 결과는 거부하며 기존 widget secret을 회전하지 않는다.
- 적용 직전마다 현재 release·origin·공개 gate·binding을 재확인하고 이미 있는 secret은 보존한다.
  Cloudflare PUT은 원자적인 create-if-absent가 아니므로 복구 중 Dashboard/외부 API에서
  같은 Worker 설정을 동시에 수정하지 않는다. 실패한 쓰기는 자동 재시도하거나 삭제하지 않는다.
- artifact에는 공개 sitekey와 고정된 적용 상태만 기록한다. sitekey를 GitHub production의
  `PUBLIC_TURNSTILE_SITE_KEY`에 등록한 뒤 승인된 공통 파이프라인으로 재빌드해야 client에 반영된다.
- 완료 시 기존 SHA/schema와 익명 GET 9개를 확인한다. 실제 사용자 OAuth·Turnstile challenge·
  법률 API·암호화 복호화 성공은 별도 검증이며 metadata 존재만으로 완료 처리하지 않는다.

API 계약: [Worker secret 등록](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/),
[Turnstile widget 생성](https://developers.cloudflare.com/api/resources/turnstile/subresources/widgets/methods/create/).

## rollback

- 앱 문제: 직전 검증된 Worker deployment로 traffic rollback
- Workflow 문제: 새 instance 생성을 중단하고 호환되는 직전 Worker/Workflow 배포
- migration 문제: 앱을 이전 schema와 호환되는 버전으로 돌리고 backup/forward-fix를 우선
- 모델 품질 문제: 분석 시작을 feature kill switch로 중단하고 기존 결과를 무조건
  재생성하지 않음
- 인용 무결성 문제: 영향 citation/result 표시를 차단하고 재검증

D1에 대한 임의 역마이그레이션이나 데이터 덮어쓰기는 하지 않는다. 복구 여부는 row count,
FK, 암호화 복호화 표본, 삭제 tombstone/요청 목록으로 검증한다.
새 배포의 candidate schema smoke를 이전 Worker rollback의 완료 증거로 재사용하지 않는다.
additive DB는 최신 marker를 유지하므로 rollback drill은 현재 DB marker·이전 Worker SHA와
read/write·삭제 호환성을 함께 기록한다. 구 Worker의 schema 기대값을 맞추려고 DB를 downgrade하지 않는다.

## 운영 runbook

### 모델 또는 Gateway 장애

새 분석은 retryable 실패로 닫고 기존 결과 조회는 유지한다. 상태 페이지 확인, request ID
표본, rate/5xx를 확인한다. 검증하지 않은 모델로 자동 전환하지 않는다.

### 법률 API 장애

최신성 조건을 만족한다고 검증된 cache만 정책에 따라 사용할 수 있다. 조건을 확인할 수
없으면 새 분석을 실패시킨다. fixture나 모델 기억으로 대체하지 않는다.

### OAuth 장애

기존 유효 세션은 정책에 따라 유지하되 새 로그인 실패를 명확히 표시한다. 다른 공급자로
동일 이메일 계정을 자동 병합하지 않는다.

### 삭제 실패

P0 incident로 분류하고 신규 삭제 요청을 기록 가능한 안전한 큐에 유지한다. 운영자가
원문을 열지 않고 ID로 재실행하며 완료를 검증한다.

### 키 노출 의심

분석 쓰기를 중단하고 영향 환경의 secret과 세션을 회전한다. 키 버전별 영향 행을 확인,
새 키로 재암호화, 법률·개인정보 통지 의무를 평가한다.

## 공개 베타 체크리스트

- [ ] P0 기능·보안·AI eval 모두 통과
- [ ] 실제 Google/Naver/Kakao OAuth, Turnstile, 법률 API 검증
- [ ] 암호화 키 회전과 D1 복구 drill 완료
- [ ] 사건·계정 삭제 E2E 완료
- [ ] 경보 on-call 수신과 rollback 권한 확인
- [ ] 정책 초안 법률 검토 및 모든 publication blocker 해소
- [ ] 랜딩 콘텐츠 감사 항목 해소

## 공식 운영 참고

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Workers rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Turnstile 시작 가이드](https://developers.cloudflare.com/turnstile/get-started/)

## v2 지속 배포와 공개 게이트

사용자는 검증된 PR 병합·preview/production 코드 배포·승인 요건 충족 후 최초 공개를 허용했다.
이를 production Environment 보호 규칙 삭제나 법률 승인으로 해석하지 않는다. P0.3 #19/#20/#27은
실제 인수 조건 완료 전 OPEN이다. 구현 가능한 선행 기술 작업 이후 human/account 조건만 남으면
독립 v2 구현·preview·production foundation 배포는 계속할 수 있다. #19의 runtime 통합은
#27 완료/선행 PR 병합 후이며 문서/독립 계약 준비와 구분한다.

새 서비스 전체 완료는 #71과 milestone5의 **모든 역할·기능을 실제 UI에서 시연 가능**한 상태다.
새 API/page/storage를 점진적으로 배포하되 feature gate는 제품·AI·업로드·공개 디렉터리별로
명시하고 아직 준비되지 않은 기능을 가짜 성공·placeholder 버튼으로 공개하지 않는다. 실제
가상 변호사/테스트 계정은 preview에만 두며 production bundle/seed/환경에 섞이지 않게 검증한다.

각 수직 기능의 배포 순서:

1. #53 문서와 해당 계약/DB/구현 선행 PR이 병합됐는지 확인하고 immutable full SHA를 선택한다.
2. `bun ci`, `bun run check`, `bun run build`, `bun run cf:dry-run`과 이슈별 UI/E2E/fixture를 수행한다.
   DB 변경은 생성 drift·fresh/upgrade/FK·기존 v1 데이터 보존 검증을 추가한다.
3. schema·file envelope·API·prompt/job version 및 이전 Worker/Container image와 호환성을 확인한다.
   같은 버전 tag를 덮어쓰지 않고 Container image digest를 고정한다.
4. 대상 D1 bookmark, DB 밖 최신 삭제 journal, R2 object inventory와 키 복구 상태를 확인한다.
   R2가 D1 Time Travel로 함께 복구된다고 가정하지 않는다.
5. build/dry-run 성공 후 additive migration→환경별 Worker/Workflow/Container 배포 순서를 지킨다.
   준비되지 않은 binding/secret/자원/모델 capability는 gate를 닫아 실패를 명확히 표시한다.
6. preview health/ready SHA/schema/image 및 실제 사용자·변호사·심사자 흐름과 실패 복구를 시연한다.
   public edit 심사 중 approved revision 유지, 사건 원문 운영자 접근 거부, download 파일 내용을 확인한다.
7. CI/preview 증거와 같은 SHA로 production foundation을 Environment 승인 후 배포하고 health/ready를
   확인한다. 화면/링크가 떠 있다는 사실을 production 사용자 API 공개 성공으로 표현하지 않는다.
8. 공개 전환은 #70의 실제 사업자/법률/정책/국외 처리 근거와 #71의 same-SHA live/UI/drill/cost
   증거를 trusted gate가 확인한 뒤 진행한다. 공개 직후 역할별 smoke와 비용/삭제/오류를 관찰한다.

legacy `check-release.ts`의 boolean 문서는 실제 receipt가 아니다. #19/#71 통합 전 public-beta를
수동 true로 통과시키지 않는다. 새 candidate는 repo/workflow/event/SHA/환경/완료/success/해시/
check/critical-zero를 검증한 artifact와 policy 승인 문서 hash·version을 연결한다. 기존 release
증거는 역사적 회귀 기록으로만 유지하며 최신 코드 전체의 통과를 대신하지 않는다.

## v2 rollback·장애 조치

Container 오류면 새 processing admission을 중단하고 실패/고립 attempt의 durable 상태와
비용을 먼저 확인한다. 이전 digest로 돌아가도 불명확한 원격 작업을 다시 실행하지 않는다.
private 자료 leak 의심은 download/upload capability revoke와 해당 경로 봉쇄, 로그/cache/
공개 copy 점검을 우선한다. 공개 프로필 오게시에는 approved pointer 철회·cache purge·객체
삭제를 수행하되 사건 private 자료를 운영자가 열어 조사하지 않는다.

Worker/Container rollback은 DB·R2·정책·job schema를 되돌리지 않는다. 이전 버전이 v2 object
manifest/키/revision을 읽지 못하면 해당 기능을 닫고 forward-fix한다. 파일·리포트를 자동 재생성하거나
기존 사건을 자동 재분석하지 않는다. 법률 source 실패 시 검증되지 않은 법률 행동은 닫되 사용자가
확인한 사실 정리·자료/리포트 접근은 유지할 수 있다. [삭제/복구](./DELETION-RESTORE.md)의 차단
조건이 남으면 traffic을 다시 열지 않는다.

## Preview / production 배포 동등성

두 환경은 `.github/actions/deploy-worker/action.yml`의 동일한 절차로 배포한다.
같은 immutable SHA에 대해 real API 빌드 → bundle/dry-run 검증 → 생성된 Worker 환경 확인 →
D1 migration → 환경별 OAuth 6개 secret 동기화 → release/schema/API smoke를 수행한다.
production의 CI·preview 증거, GitHub Environment 승인과 공개 모드 검증은 이 공통 절차 전에 유지한다.
`sync_oauth` 선택지는 제거했으며 각 Environment의 credential을 매번 사용한다.

두 GitHub Environment 모두 `PUBLIC_TURNSTILE_SITE_KEY` 변수가 필요하다. 해당 환경의
hostname에 등록된 실제 widget site key여야 하고 Worker의 `TURNSTILE_SECRET_KEY`와
같은 widget이어야 한다. 누락·테스트 키는 원격 migration 전에 배포를 중단한다.
빌드에는 `PUBLIC_API_MODE=real`을 명시하며 mock fixture를 배포하지 않는다.
DB/KV/R2/Workflow/Container/OAuth/Gateway의 환경별 식별자와 키는 계속 분리한다.
배포 전 Worker의 secret 이름만 조회하여 `BETTER_AUTH_SECRET`, `CASE_DATA_KEY_V1`,
`TURNSTILE_SECRET_KEY`, `LAW_API_OC` 존재를 확인한다. 기존 암호화 키를 자동 생성하거나
덮어쓰지 않는다. 누락된 키는 해당 환경의 기존 보관본/담당 절차로 복구해야 한다.

API smoke는 인증 cookie 없이 session, 공개 변호사 목록, 사건/자료/리포트/사용량의
읽기 경로를 검사한다. open 모드에서는 정상 공개 응답 또는 `401 UNAUTHENTICATED`를,
production foundation에서는 `503 BETA_NOT_OPEN`을 요구한다. health 성공만으로
API가 열렸다고 판정하지 않으며, 이 검사는 실제 OAuth callback·Turnstile·AI 처리의
성공을 대신하지 않는다. API 노출 모드는 승인된 production release mode로만 결정한다.
