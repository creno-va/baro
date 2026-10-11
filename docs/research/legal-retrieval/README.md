# BARO 공식 출처 retrieval 성능 연구

요청 안에서 **identity와 기준일 검증에 성공한 같은 법령 목록 candidate를 재사용하는 개선 하나**를 선택했다. 2026-10-10 #63 후속 작업에서 제품에 적용했다. 겹치는 조문 plan에서 cold upstream 호출은 5→4회, warm 호출은 2→1회로 감소한다. source identity, SHA-256, 기준일, 24시간 TTL과 매 조문의 fresh DB cache 검증은 유지한다. [당시 후보 patch](./list-dedup.patch)와 아래 2026-10-06 측정 결과는 역사적 연구 자료로 보존한다. 이미 적용한 제품에 patch를 다시 적용하지 않는다.

## 기준과 재현

기준 main SHA는 `b6cfdfe3676506bf2b4880af0911138a9b3f107e`다. #63 구현 PR91의 main 병합 `f46424c59ed498ddb76163bf45fb1b2bdfd38b1e`와 성공 CI를 확인했다. 측정 환경은 Bun 1.3.14, macOS arm64이며 측정 시각은 2026년 10월 6일 21시 50분 KST다. 5회 측정의 중앙값과 최소·최대 경과 시간은 [결과 JSON](./results-2026-10-06.json)에 보존한다.

```bash
bun ci
bun test tests/legal-retrieval-benchmark.test.ts
BARO_BENCH_REPEATS=5 bun scripts/benchmarks/retrieval/run.ts
```

기본 결과와 patch는 `.wrangler/retrieval-benchmark/`에 생성된다. 보존할 결과 위치는 `BARO_BENCH_OUTPUT`으로 지정한다. baseline과 세 연구 후보는 기준 SHA의 source를 `git show`로 읽고, `product`는 현재 제품 source를 읽어 별도 비교한다. 따라서 기준 commit이 포함된 Git checkout이 필요하다(CI는 `fetch-depth: 0`). 후보는 source anchor를 확인한 뒤 임시 모듈을 만들어 실행한다. `candidateGeneratorSha256`과 `productSourceSha256`은 각각 현재 변환 코드와 제품 source의 hash다. 임시 모듈 import는 Windows에서도 유효한 file URL을 사용한다. 원래 source와 보존된 결과 JSON은 수정하지 않는다.

```bash
# 현재 제품의 요청 계약·캐시·권한·최적화 회귀 확인
bun test tests/legal-retrieval-v2.test.ts tests/legal-retrieval-benchmark.test.ts
bun run typecheck
```

## 작은 합성 입력과 측정 정의

법령 하나와 조문 셋 `598/600/603`만 생성한다. 원문은 합성 시험 문장이다. 실제 법률 API, 새 공식 응답 capture, 모델 호출, 전체 corpus 반복은 포함하지 않는다. Workers용 기존 v2 retrieval·transport·cache repository·workspace 권한 가드를 실행하고, DB는 기존 D1 시험 adapter의 실제 migration된 in-memory SQLite다. DB 숫자는 실행된 statement 수이며 원격 D1 latency나 실제 비용을 뜻하지 않는다.

`article` 응답은 JO별 조문 하나만 담는다. `full` 응답은 같은 법령의 세 조문을 매번 반환하는 합성 비교 조건이다. 이 두 조건으로 다른 JO의 응답이 항상 같은 전체 법령이라는 가정을 피한다. 완전히 같은 plan이나 같은 plan 안의 중복 조문은 기존 request schema가 거부하며, benchmark의 duplicate case는 0회 호출·0회 DB statement로 종료된다. 중복 조회 비교는 허용되는 두 plan `[598,600]`과 `[600,603]`을 사용한다.

cold는 cache가 없는 상태, warm은 동일 입력으로 priming한 fresh cache, expired는 24시간과 1ms가 지난 상태다. 단일 조문, 같은 법령의 다중 조문, 겹치는 plan, 429 두 번 뒤 성공, 실제 20ms deadline 한 번 뒤 성공, deadline 세 번 뒤 실패를 각각 실행한다. 모든 조합에서 본문·인용의 random citation ID만 제외한 결과와 availability/retrieval hash가 baseline과 같음을 확인한다.

- 호출 수는 실제 합성 transport 진입 횟수이며 retry도 포함한다. 성공 예약 수와 실제 호출 수를 정상 benchmark에서 대조한다. 별도 budget denial 검사는 발송되지 않은 예약 시도를 구분한다.
- DB reads는 실행된 SELECT, writes는 public cache 쓰기와 citation binding transaction statement다. 동의·소유권·revision 가드도 포함하며, setup·priming·측정 뒤 integrity 검사는 제외한다.
- upstream bytes는 합성 응답 본문의 UTF-8 길이다. 429 본문도 포함하고 응답이 없는 timeout은 0 bytes다. output bytes는 retrieval JSON의 UTF-8 길이이며 HTTP header는 제외한다.
- `wallMs`는 로컬 총 경과 시간이다. 합성 지연은 0ms/5ms 두 profile을 실행하고 실제 기다린 interval을 기록한다. `waitWallMs`는 합성 latency와 실제 timeout deadline 구간의 합집합이다. 동시 요청의 대기를 중복 합산해 총 시간에서 빼지 않는다.
- `nonWaitingWallMs`는 각 sample의 `wallMs - waitWallMs`다. CPU time으로 부르지 않는다. 대기 구간 밖의 합성 JSON·Response 생성, parser/hash/SQL/권한 처리와 scheduler overhead를 포함한다. 동시성 profile에서는 한 worker의 코드 실행이 다른 worker의 대기와 겹칠 수 있어 이 차이가 전체 CPU 실행량을 나타내지 않는다. 0ms 성공 profile은 fake wait가 없어서 총 경과 시간이 곧 실제 로컬 실행 경과 시간이다.
- retry backoff는 sleep 없이 virtualize하고 설정값 100ms/200ms, 누적 100ms/300ms를 별도로 기록한다. 따라서 timeout/retry 총 시간은 운영 기본 timeout 10초와 실제 backoff latency 예측치가 아니다. 시간 열의 중앙값은 각각 계산하므로 서로 더해 정확히 총 시간 중앙값이 되지는 않는다.

## 같은 법령과 cache 전후 수치

아래는 JO별 조문 응답, 합성 latency 5ms 조건의 중앙값이다. 화살표는 baseline→법령 목록 candidate 재사용이다. DB 열은 SELECT / write statement를 분리한다.

| 입력 | 호출 | DB SELECT | DB write | upstream bytes | output bytes | 총 경과 ms | fake latency와 timeout 제외 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cold-single | 2→2 | 12→12 | 4→4 | 607→607 | 3150→3150 | 12.364→12.048 | 1.036→0.768 |
| cold-multi | 4→4 | 26→26 | 12→12 | 1417→1417 | 8874→8874 | 24.271→23.943 | 1.738→1.838 |
| warm-multi | 1→1 | 20→20 | 12→12 | 202→202 | 8874→8874 | 6.954→6.876 | 1.312→1.286 |
| cold-overlap | 5→4 | 35→33 | 16→16 | 1619→1417 | 10375→10375 | 30.718→24.641 | 2.790→2.343 |
| warm-overlap | 2→1 | 29→27 | 16→16 | 404→202 | 10375→10375 | 13.892→7.332 | 2.665→1.820 |
| expired-cache | 4→4 | 26→26 | 12→12 | 1417→1417 | 8874→8874 | 25.688→24.613 | 3.073→2.117 |
| retry-429 | 6→6 | 30→30 | 12→12 | 1421→1421 | 8874→8874 | 36.832→36.193 | 2.985→3.055 |
| timeout-recover | 5→5 | 28→28 | 12→12 | 1417→1417 | 8874→8874 | 46.383→47.086 | 3.135→3.154 |
| timeout-terminal | 5→5 | 16→16 | 0→0 | 607→607 | 301→301 | 77.131→76.544 | 1.960→1.812 |
| duplicate-rejected | 0→0 | 0→0 | 0→0 | 0→0 | 0→0 | 0.033→0.033 | 0.033→0.033 |

겹치는 plan의 총 DB statement는 cold 51→49, warm 45→43이다. 목록 network 호출에 따라 실행하던 transport 권한 SELECT 일부가 줄어든 결과이며, public source cache 발견 조회·hash 검증·최신 tuple 재확인을 제거한 결과가 아니다. 각 plan의 authorize/authorizeQuery, 재사용 직전의 authorize, cache put/bind 직전·직후 및 최종 authorize는 남는다. 출력 bytes가 그대로인 이유는 기존 독립 citation 발급과 outcomes/final chunks 형식을 유지하기 때문이다.

## 세 후보 비교

아래는 같은 법령 세 조문을 cold 조회한 경우다. 0ms profile은 가짜 지연을 넣지 않은 실제 코드 경과 시간이고, 5ms profile은 총 경과 시간과 실제 대기 구간을 뺀 경과 시간을 함께 표시한다.

| 후보 | JO별 JSON parse | full JSON parse | 조문 schema와 hash 처리 | 호출과 DB statement | 0ms JO별 경과 ms | 5ms JO별 총 경과 ms | 5ms 대기 제외 ms | 최대 동시 호출 |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| baseline | 4 | 4 | 3 | 4 / 38 | 1.666 | 24.271 | 1.738 | 1 |
| list-dedup | 4 | 4 | 3 | 4 / 38 | 1.267 | 23.943 | 1.838 | 1 |
| json-reuse | 4 | 2 | 3 | 4 / 38 | 1.965 | 24.705 | 2.583 | 1 |
| concurrency-2 | 4 | 4 | 3 | 4 / 38 | 1.891 | 18.586 | 1.425 | 2 |

`list-dedup`는 단일 plan의 다중 조문에서는 호출을 줄이지 않는다. 같은 법령 title/ID/기준일로 여러 plan을 조회할 때만 성공한 candidate를 공유한다. URL의 전체 endpoint/query를 key로 사용하고 map을 `retrieve` 안에 한정한다. 다른 LID, 요청, 기준일이나 소유자로 재사용되지 않는다. 검증 실패 candidate는 저장하지 않는다.

`json-reuse`는 byte가 완전히 같은 JSON만 재사용하며 memo의 총 raw bytes를 2MiB로 제한한다. full 응답에서는 JSON.parse 4→2회지만 조문 schema·identity·hash 처리는 여전히 3회다. JO별 응답에서는 4회 그대로다. 이 작은 입력의 0ms profile에서도 실행 시간 개선이 확인되지 않았고 호출/DB/bytes를 줄이지 못해 채택하지 않는다. 다른 JO 응답의 root를 검증 없이 공유하거나 전체 법령 재조회로 바꾸는 최적화는 포함하지 않는다.

`concurrency-2`는 조문 두 개씩 실행하고 각 batch의 모든 worker가 settle한 뒤 순서를 복원한다. cold multi의 5ms 총 시간은 24.271→18.586ms지만 호출 4회·DB 38회·bytes는 그대로다. 이번 결과는 주로 합성 대기의 중첩 효과이며 실제 API throughput이나 CPU 개선 증거가 아니다. 소유자에게는 호출 자체를 줄이는 작은 목록 재사용 patch 하나만 전달한다.

시간 sample은 variant별 순서로 실행했고 짧은 로컬 측정에는 JIT·GC·scheduler 차이가 남는다. 0ms profile의 작은 차이를 운영 CPU 성능 향상으로 일반화하지 않는다. 호출·SELECT·write·bytes·parse count는 5회 모두 같음을 검사한다.

## 검증과 소유자 인계

2026-10-10 후속 작업: 최적화를 실제 제품에 적용하고, cache 변조·요청별 memo 분리·다른 LID·실패 재조회·동의 철회·취소·예약 제한 검사는 임시 후보 대신 실제 제품 factory를 실행하도록 전환했다. 현재 제품과 고정 기준의 출력 동일성 및 cold/warm 겹침 호출 수를 별도로 검사한다. 공식 요청 형식과 외부 승인 확인 한계는 [환경 readiness의 #63 진단](../../operations/ENVIRONMENT-READINESS.md#2026-10-10-63-공식-api-요청-진단)에 기록한다.

후속 검증은 Windows/Bun 1.3.14에서 집중 검사 97개·597 assertions, 도구 TypeScript, build, Worker dry-run, DB drift·migration 검사와 1회씩의 합성 benchmark 200개 조합을 통과했다. 전체 `bun run check`는 1,444개 통과·7개 실패이며, 실패는 main과 동일한 `scripts/development-checks.ts`/`.test.ts`의 Windows 경로 선택 검사다. 해당 수정은 열린 [PR #172](https://github.com/creno-va/baro/pull/172)의 범위이므로 중복 구현하지 않았다. 전체 check 성공으로 표시하지 않는다.

아래는 2026-10-06 연구 당시의 검증·인계 기록이다.

26개 신규 집중 검사는 원문 SHA-256과 source ID의 type/official ID/version/section/extractor hash, canonical URL, 시행일≤asOfDate, 24시간 expiry, exact span과 baseline 결과 동일성을 확인한다. 잘못된 법령 ID, 미래 시행일, schema 변경, cached body/URL/date 변조, query 승인 직후의 동의 철회·취소, 다른 LID, 요청별 memo 분리, 독립 citation 발급, 실패한 history의 재조회, timeout/retry 예약 sequence와 budget denial을 검증한다. expired 원문이 존재하더라도 upstream이 세 번 timeout이면 unavailable·빈 chunks이며 stale 원문을 내보내지 않는다.

후보 patch를 일시 적용해 기존 `tests/legal-retrieval-v2.test.ts` 65개·352 assertions와 tools TypeScript를 확인한 뒤 reverse apply했다. 신규 benchmark 집중 검사는 26개·189 assertions를 통과했다. `bun ci`, docs/work graph/boundaries/lint/typecheck와 build/Worker dry-run 결과를 인계한다. 기존 lint warnings 10개는 오류가 아니며 공유 UI/API 파일을 수정하지 않았다. `bun run check` 안의 전체 `bun test`/corpus 반복은 최신 사용자 범위에 따라 실행하지 않고 집중 검사로 대체했다. schema/DB 계약은 변경하지 않았다.

#63 시작 댓글에서 소유자 @hyunhomon에게 범위를 공개했고, 현재 UI 통합 중재 세션에 별도 연구 PR 및 unapplied patch를 알렸다. 제품 적용은 소유자가 후속 검토할 수 있도록 분리했다. 연구는 UI/API 통합의 새 선행 gate가 아니다. TTL 완화·stale 원문·출처 검증 생략은 후보로 채택하지 않는다. #63은 실제 외부 조건 때문에 OPEN으로 유지하며 P0.3/#70/#71·production·공개 gate는 보존한다.
