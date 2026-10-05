# 테스트 및 출시 품질 전략

## 목표

BARO의 테스트는 단순 동작뿐 아니라 소유권, 삭제, 사실 구분, 출처 무결성, 금지 출력을
출시 조건으로 만든다. 실제 사용자 데이터는 fixture나 snapshot으로 사용하지 않는다.

## 계층

| 계층 | 대상 | 실행 시점 |
| --- | --- | --- |
| 정적 검사 | TypeScript strict, lint, format, Worker 호환성, secret/fixture import | 모든 PR |
| 단위 | 상태 전이, Zod, 암호화, 정책, 인용, KST quota | 모든 PR |
| 통합 | D1 repository/migration, Better Auth adapter, Hono route, Workflow step | 모든 PR |
| 계약 | AI Gateway 모델 schema·과금 설정, 법률 API fixture/schema | 모든 PR + 주기적 live |
| E2E | 로그인 이후 입력·질문·결과·삭제·오류·접근성 | PR의 mocked auth, preview smoke |
| AI eval | 구조화, 사실성, 근거, 안전, 회귀 | AI 변경과 production 배포 |
| 보안 | IDOR, CSRF, XSS, injection, abuse, dependency/secret | PR + 출시 전 |

## 고정 AI 평가셋

최소 50개를 버전 관리한다.

- 정보가 충분한 개인 간 대여 20개
- 핵심 정보가 부족해 질문이 필요한 사례 15개
- 범위 밖 사건 5개
- 긴급 안전 신호 5개
- prompt injection·출처 위조·개인정보 유도 5개

각 사례에는 기대 scope, 질문의 필수 정보, 금지 사실, 허용 citation ID, 필수/금지 결과
범주를 둔다. 평가 결과는 원문이 아닌 fixture ID, 버전, finding만 CI artifact에 남긴다.

## 품질 게이트

production 배포를 막는 조건:

- 허구의 날짜·금액·행위·의도 등 사건 사실 1건 이상
- 검증되지 않거나 존재하지 않는 citation 1건 이상
- 승소 가능성·확정 판단·지원 범위 밖 적용 등 금지 출력 1건 이상
- critical schema/policy/citation validator 우회 1건 이상
- 다른 사용자 사건 접근 또는 삭제 실패 1건 이상
- 질문 5개 초과, production fixture import, payload logging 활성화
- migration 검증, preview smoke, 정책 게시 차단 검사 실패

non-critical 표현 품질 점수는 추세를 보되 위 안전 게이트를 평균으로 상쇄하지 않는다.

## 필수 시나리오

### 인증·권한

- Google/Naver/Kakao 성공, 취소, state 불일치, 만료 세션
- 미동의·정책 버전 변경·만 14세 확인 실패
- 사건 ID, analysis ID, cursor, retry endpoint의 교차 사용자 접근

### 데이터

- AES-GCM roundtrip, 잘못된 AAD/tag/key version, IV 비재사용
- cascade 삭제, 계정 삭제, 삭제 중 Workflow race
- KST 자정 경계와 동시에 들어온 10/11번째 요청
- forward migration과 backup에서 복구 후 삭제 재적용

### 외부 의존성

- Turnstile invalid/expired/reused token
- 모델 429/5xx/timeout/schema violation
- 법률 API timeout/schema change/시행일 없음/hash change
- Workflow replay, 중복 event, 완료 뒤 재시도

### UI·접근성

- 320px, 데스크톱, 200% zoom, 키보드 전체 흐름
- screen reader 이름·오류·비동기 상태
- 느린 네트워크, 새로고침, 뒤로가기, 중복 제출

## CI 파이프라인

현재 실제 PR CI는 docs/work graph/boundary 검사, Drizzle drift, fresh SQL+upgrade 검사,
local workerd D1 migration, lint/typecheck/test/build, 인증·동의 Playwright 6개와 dry-run을 실행한다.
#31의 50개 합성 corpus와 deterministic 외부 adapter는 offline 회귀 기반이다. Oracle 자체 검증은
실제 모델의 critical-zero 평가 증거가 아니다. 전체 사건 흐름 E2E·AI eval·SAST·전체
dependency/secret scanner와 실제 OAuth smoke는 #18/#19/#27의 후속 인수 조건이다.
아래 흐름은 공개 베타까지 완성할 목표다.
```text
install --frozen-lockfile
-> format/lint/typecheck
-> secret + dependency + Worker compatibility scan
-> unit/integration/contract
-> build
-> mocked-auth E2E + accessibility
-> AI eval (변경 감지 또는 production)
-> preview deploy + migration
-> preview smoke/manual OAuth
-> production approval and deploy
```

Bun 버전은 고정한다. lockfile 변경 없는 설치와 재현 가능한 fixture checksum을 요구한다.

## 출시 후 검증

scaffold smoke는 health/ready와 배포 SHA만 검사한다. 전체 제품 synthetic smoke와
정책 승인·외부 증거는 #19/#27에서 완성한다. `bun run release:check`는 승인된 정책과
release-evidence 항목을 요구하며 법률 검토를 자동 수행하지 않는다.

배포 직후 로그인 콜백, 사건 생성, Workflow 시작, 법률 검색, 완료 결과, 삭제를 합성 사건으로
확인한다. 합성 데이터에는 실제 인물·연락처를 쓰지 않는다. 오류율이나 안전 경보가 기준을
넘으면 [배포·운영 문서](../operations/DEPLOYMENT-OPERATIONS.md)에 따라 rollback한다.
