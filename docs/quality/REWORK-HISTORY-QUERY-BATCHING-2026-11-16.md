# Rework 대화 이력 본문 조회 batch 검증

- 로컬 검증: 2026-11-16 KST, Bun 1.4.0.
- 기준 main: `b54566f32d2d81f9c08ebc26acac0209623d3af1`.
- 범위: [rework state](../../src/server/modules/rework/state.ts)의 기존 메시지 본문 SELECT를 최대 4개씩 D1 batch로 실행한다.
- endpoint·DTO·schema·client·작업 writer·lease·CAS·멱등성은 변경하지 않는다. UI 기반 PR과 독립된 후속 변경이다.

## 재현과 측정 범위

```sh
bun ci
bun run validate:quick
bun test tests/rework-history-query-batching.test.ts
bun test tests/rework-intent-publication.test.ts tests/rework-state.test.ts tests/rework-state-concurrency.test.ts tests/rework-public-jobs.test.ts
```

[검사 fixture](../../tests/rework-history-query-batching.test.ts)는 실제 로컬 SQLite/AES와
admit→lease acquire→응답 commit 경로로 완료 메시지를 만든다. 같은 SELECT를 하나씩 실행하는
테스트 전용 sequential adapter와 batch adapter의 전체 `getProgress` 결과를 비교한다.
로컬 준비·쓰기 구간을 제외하고 [D1 메서드 계측](../../tests/helpers/d1-call-count.ts)으로 읽기 호출과 SQL statement 수를 센다.

| 완료 메시지 수 | sequential 전체 호출 | batch 전체 호출 | SQL statement 수, 양쪽 동일 | 본문 조회 호출, 전→후 |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 38 | 38 | 38 | 0 → 0 |
| 1 | 42 | 42 | 42 | 1 → 1 |
| 4 | 54 | 51 | 54 | 4 → 1 |
| 5 | 58 | 55 | 58 | 5 → 2 |
| 100 | 234 | 159 | 234 | 100 → 25 |

출력은 합성 개수와 계측값만 JSON으로 기록한다. 사건·계정 ID, 메시지, 토큰, SQL은 기록하지 않는다.
이는 실제 네트워크 지연·native D1 rows read·cloud 지연·p50/p95 개선 측정이 아니다.
다른 빈 이력 fixture의 37/57 호출 수와도 합산하거나 직접 비교하지 않는다.
4개로 묶는 기존 본문 조회의 왕복 수가 `N → ceil(N/4)`로 달라지며, 그 외 읽기·검증은 유지된다.
[Cloudflare D1 batch 문서](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)의 준비문 순서와 결과 배열 순서 계약을 사용한다.

## 검증한 보호 경계

- 기존 소유자·operation·완료 job·대상 revision header 조건과 본문의 ID/workspace/revision 조건을 유지한다.
- 순서·전체 projection·intent의 원래 발행 revision이 sequential 결과와 같다. 읽기가 operation/job/report를 생성하지 않는다.
- 다른 소유자와 완료되지 않은 job은 본문 조회를 시작하지 않는다.
- batch 도중 및 실제 비동기 복호화 뒤 workspace/account tombstone, 조회 중 context publication, header 뒤 메시지 삭제는 결과를 폐기한다.
- 두 번째 batch의 예외·누락/추가 결과·실패 응답·누락된 rows·중복 row도 부분 성공으로 반환하지 않는다.
- 암호문 손상과 복호화된 메시지 ID/operation/revision 불일치를 거부한다.
- 마지막 workspace revision·접근 확인과 기존의 bounded passive 재조회 경계를 보존한다.

새 회귀 22개와 기존 intent/state/concurrency/public-job 회귀 26개를 로컬에서 통과했다.
`validate:quick`도 성공했다. 여러 Bun 호출의 실행 합계는 1,927 pass·4 skip·0 fail이며,
Jest UI는 24 suites·108 tests를 통과했다. 이 합계는 중복 실행을 포함하며 고유 검사 수가 아니다.
4 skip은 quick 범위의 기존 실제 native/Docker 검사이며 해당 인수를 완료했다는 의미가 아니다.
`validate:build`의 production 빌드·번들 검사·Workers dry-run·로컬 built-runtime 검사도 통과했다.
운영 배포·실제 외부 서비스·UI·공급자 인수는 이 로컬 결과에 포함되지 않는다.
