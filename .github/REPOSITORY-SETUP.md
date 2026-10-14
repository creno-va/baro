# GitHub repository setup

이 디렉터리는 main 직접 개발을 끝내고 이슈 -> 브랜치 -> PR -> CI -> preview -> production
흐름을 적용한다.

## 최소 CI와 수동 실행 (2026-10-11)

1. PR/main에는 `CI / Quality gate` 한 job이 `bun ci`와 `bun run validate:quick`을 실행한다.
2. 기능·브라우저·DB·Docker·보안·전체 검증은 필요할 때 로컬 `validate:*` 명령으로 수행한다.
3. main merge/CI 성공은 배포를 시작하지 않는다. `bun run deploy:preview`로 현재 main SHA를 수동 요청한다.
4. `bun run deploy:production --sha <full40sha>`로 preview에서 검증한 SHA를 요청한다.
5. production Environment 승인과 동일 SHA의 main CI·preview smoke/공개 조건을 그대로 확인한다.

`Full validation (manual)`은 명시적으로 요청할 때만 전체 검사를 원격에서 재현한다.
`AI runtime preflight`도 workflow_dispatch 전용이다. 자동 스케줄/배포 연쇄 실행은 없다.
시크릿은 기존 GitHub Environment에 보관한다. 로컬 CLI는 workflow 요청만 전송하며 배포 완료는
`bun run deploy:status`와 `gh run watch <run-id> --repo creno-va/baro --exit-status`로 확인한다.
[검증](../docs/quality/TEST-STRATEGY.md)과 [수동 배포](../docs/operations/DEPLOYMENT-OPERATIONS.md)의 준비/옵션을 따른다.

프리베타는 [비용 관측 전용](../docs/operations/PREBETA-COST-POLICY.md)이다.
`APPLICATION_COST_LIMITS_ENABLED=false`에서 금액·가격/FX/funding 누락/만료·월할당·수동
refresh·유지비·비용 IO를 workflow/배포의 승인 조건으로 만들지 않는다. 사용자 재지시 전
재도입하지 않으며 실제 binding/credential·schema·보안·정확한 SHA/운영자 승인은 유지한다.
공용 배포 action의 모델 capability 설정은 비용 관측 갱신과 별개다. `configuration_ready`를
실제 제품 성공으로 표시하지 않는다. 공개 저장소/표준runner 관측과 조직 budget 조회의
권한 한계는 위 정책 문서에 보존한다.

## 저장소 설정

GitHub Settings에서 다음을 설정한다.

### Environments

- `preview`: 고정 preview Worker용 secret
- `production`: production Worker용 secret과 보호 브랜치 규칙. 현재 필수 reviewer는 없으며 정확한 SHA의 지정 운영자 receipt로 배포 승인을 확인한다.

각 Environment에 `CLOUDFLARE_API_TOKEN` secret을 추가한다. 토큰은 대상 Cloudflare
계정의 BARO Worker와 필요한 D1/Workflow/KV/R2/Containers 리소스에만 권한을 제한한다. 로컬
`wrangler login` OAuth token을 복사하지 않는다.

Cloudflare account ID는 공개 식별자이며 workflow에
`9e844969d0c44b2449f3951d1f301654`로 고정했다.

### Main branch protection

- pull request를 통한 변경만 허용
- merge 전 `Quality gate` 성공 필수
- 새 commit이 추가되면 기존 승인 무효화
- 모든 대화 해결 필수
- force push와 branch deletion 금지
- 관리자 우회는 긴급상황 외 금지

첫 CI run으로 check 이름이 생성된 뒤 `Quality gate`를 required status check로 선택한다.
이전2026-10-05 확인: 위 보호 설정 적용됨, required approving review count=0,
CODEOWNERS review 강제 없음, 관리자 우회 방지 활성. production Environment reviewer는
당시 `hyunhomon`이었다. 현행 reviewer/승인 방식은 위 환경 설명과
[배포 운영](../docs/operations/DEPLOYMENT-OPERATIONS.md)을 따른다.
자동 merge가 켜져 있어도 사용자 작업 권한을 자동 부여하지 않는다.

## 앱 scaffold 계약

루트 `package.json`은 다음 script를 제공한다.

```json
{
  "scripts": {
    "lint": "...",
    "typecheck": "...",
    "test": "...",
    "build": "..."
  }
}
```

`bun.lock`과 `wrangler.jsonc`를 커밋한다. Wrangler 설정에는 `preview`와 `production`
환경을 선언하고 D1, Workflow, rate limiter 등 환경별 binding을 분리한다. Astro 6+
Cloudflare adapter는 build 시 환경을 고정하므로 각각 `CLOUDFLARE_ENV=preview`와
`CLOUDFLARE_ENV=production`으로 별도 build한 뒤 `wrangler deploy`한다. secret은
Wrangler 설정이나 Git에 쓰지 않는다.

현재 Cloudflare 리소스는 `baro-preview`/`baro-production` D1,
`baro-analysis-preview`/`baro-analysis-production` Workflow, 환경별 `SESSION` KV로
분리되어 있다. 계정 workers.dev 서브도메인은 `creno-va-baro`다.

## R2

v1의 R2 불필요 결정은 이전 범위다. 현행 v2는 환경별 private/public R2 binding을 사용하며
실제 자원·권한·물리 용량·writer·삭제 경계는 [자료 처리 운영](../docs/operations/FILE-PROCESSING.md)을
따른다. 비용 가격/재원 관측 만료와 물리 자원 미설정을 같은 blocker로 취급하지 않는다.

## 공급망 관리

Actions와 npm 생태계는 Dependabot이 매주 확인한다. 자동 merge는 사용하지 않으며 모든
업데이트는 CI와 PR 검토를 거친다.
