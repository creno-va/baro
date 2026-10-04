# 배포 및 운영

## 환경

| 환경 | 목적 | 데이터·외부 연결 |
| --- | --- | --- |
| local | 개발·단위/통합 테스트 | local D1, 법률 fixture, 개발 OAuth 또는 mock |
| preview | 통합·실제 OAuth smoke | 전용 D1/Workflow/Gateway/OAuth, 실제 법률 API |
| production | 공개 베타 | 전용 리소스와 secret, 실제 법률 API |

환경 간 DB, OAuth client, 암호화 키, API key를 공유하지 않는다. preview는 고정 hostname을
사용한다. PR별 build는 가능하지만 OAuth callback을 동적으로 추가하지 않는다.

현재 고정 preview URL은 `https://baro-preview.creno-va-baro.workers.dev`다. Worker,
D1, Workflow, SESSION KV는 `preview`와 `production` 이름으로 각각 분리한다.

## 브랜치와 배포

- pull request: 정적·테스트·build, 필요 시 고정 preview 후보 배포
- `main`: 승인된 변경을 preview에 자동 배포
- production: preview smoke와 출시 체크 통과 후 GitHub Environment 수동 승인
- hotfix도 같은 테스트를 거치며 직접 콘솔 편집은 장애 봉쇄 외 금지

GitHub Actions는 최소 권한 OIDC 또는 환경별 제한 secret을 사용한다. production 승인자와
배포 실행자는 가능하면 분리한다.

## 배포 순서

1. 문서/계약과 migration 일치 검사
2. preview D1 backup 식별자 기록
3. additive migration 적용 및 검증
4. Worker/Workflow 배포
5. preview 실제 OAuth·Turnstile·법률 API smoke
6. production D1 backup 식별자 기록
7. 역호환 migration 적용
8. Worker/Workflow 배포 및 합성 smoke
9. 지표를 집중 관찰한 뒤 완료 선언

파괴적 schema 변경은 최소 두 번의 배포로 분리한다. 오래 실행 중인 Workflow가 이전
schema/prompt를 사용할 수 있으므로 호환 기간을 둔다.

## 설정 확인

- 모든 binding/secret이 환경별로 존재하고 placeholder가 아님
- OAuth callback과 allowed origin이 정확한 HTTPS URL임
- AI Gateway payload logging이 꺼짐
- production에서 법률 fixture adapter와 source map 원문 노출이 비활성화됨
- CSP가 OAuth와 Turnstile을 막거나 과도하게 열지 않음
- current policy version이 게시된 문서 버전과 일치함

## rollback

- 앱 문제: 직전 검증된 Worker deployment로 traffic rollback
- Workflow 문제: 새 instance 생성을 중단하고 호환되는 직전 Worker/Workflow 배포
- migration 문제: 앱을 이전 schema와 호환되는 버전으로 돌리고 backup/forward-fix를 우선
- 모델 품질 문제: 분석 시작을 feature kill switch로 중단하고 기존 결과를 무조건
  재생성하지 않음
- 인용 무결성 문제: 영향 citation/result 표시를 차단하고 재검증

D1에 대한 임의 역마이그레이션이나 데이터 덮어쓰기는 하지 않는다. 복구 여부는 row count,
FK, 암호화 복호화 표본, 삭제 tombstone/요청 목록으로 검증한다.

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
- [ ] 실제 Google/Kakao OAuth, Turnstile, 법률 API 검증
- [ ] 암호화 키 회전과 D1 복구 drill 완료
- [ ] 사건·계정 삭제 E2E 완료
- [ ] 경보 on-call 수신과 rollback 권한 확인
- [ ] 정책 초안 법률 검토 및 모든 publication blocker 해소
- [ ] 랜딩 콘텐츠 감사 항목 해소

## 공식 운영 참고

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Workers rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Turnstile 시작 가이드](https://developers.cloudflare.com/turnstile/get-started/)
