# GitHub repository setup

이 디렉터리는 main 직접 개발을 끝내고 이슈 -> 브랜치 -> PR -> CI -> preview -> production
흐름을 적용한다.

## 자동화된 흐름

1. 모든 PR(stack 포함)에 `CI / Quality gate`가 실행된다.
2. main에 merge된 commit의 CI가 성공하면 고정 `preview` 환경 배포가 실행된다.
3. production은 `Deploy production`에 확인 문자열, 검증된 target_sha, release_mode를 지정한다.
4. GitHub `production` Environment의 reviewer 승인을 추가하면 실제 배포 전 승인을 한 번
   더 강제할 수 있다.

현재 앱 scaffold가 존재하므로 CI는 `bun.lock`, `lint`, `typecheck`, `test`, `build`,
Wrangler dry-run을 요구한다. CD는 build/dry-run 뒤 D1 migration과 배포·SHA smoke를 수행한다.
public-beta는 실제 출시 증거 게이트를 추가로 통과해야 한다.

## 저장소 설정

GitHub Settings에서 다음을 설정한다.

### Environments

- `preview`: 고정 preview Worker용 secret
- `production`: production Worker용 secret과 required reviewer

각 Environment에 `CLOUDFLARE_API_TOKEN` secret을 추가한다. 토큰은 대상 Cloudflare
계정의 BARO Worker와 필요한 D1/Workflow/KV 리소스에만 권한을 제한한다. R2는 현재 불필요하다. 로컬
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
2026-10-05 확인: 위 보호 설정 적용됨, required approving review count=0,
CODEOWNERS review 강제 없음, 관리자 우회 방지 활성. production Environment reviewer는
`hyunhomon`이다. 자동 merge가 켜져 있어도 사용자 작업 권한을 자동 부여하지 않는다.

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

현재 Accepted 설계는 사건 데이터를 D1에 저장하며 R2 binding이 필요하지 않다. 이후
검증된 문서·대용량 artifact 저장 요구가 생기면 별도 ADR과 데이터 보존·삭제 정책을
승인한 뒤 R2를 추가한다.

## 공급망 관리

Actions와 npm 생태계는 Dependabot이 매주 확인한다. 자동 merge는 사용하지 않으며 모든
업데이트는 CI와 PR 검토를 거친다.
