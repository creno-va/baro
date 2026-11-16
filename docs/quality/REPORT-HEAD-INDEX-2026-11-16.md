# 리포트 최신 행 인덱스 로컬 검증

기준은 새로 확인한 main `b54566f32d2d81f9c08ebc26acac0209623d3af1`이다.
UI 및 대화 이력 batching PR과 독립된 인덱스 변경이다. 새 경량 상태 API는 만들지 않는다.

## 변경 범위

[스키마](../../src/server/db/v2-schema.ts)의 `v2_reports`에 비고유 인덱스
`v2_reports_workspace_head_idx`를 추가한다. 키 순서는
`workspace_id, revision DESC, created_at DESC, id DESC`다.
[0023 마이그레이션](../../drizzle/0023_report_head_index.sql)과 Drizzle snapshot/journal은
생성 결과를 사용하며, 기존 방식대로 health의 `schema_version`만 새 tag로 갱신한다.
현재 버전을 요구하는 운영 스크립트와 fixture 기대값도 정확한 새 tag를 요구한다.
과거 0022를 직접 적용하는 검사는 과거 기대값을 유지한다.

다음 기존 조회의 SQL·파라미터·필터·응답은 바꾸지 않는다.

- [리포트 canonical head](../../src/server/modules/reports/service.ts): workspace로 제한한 뒤 export를 제외하고 revision·생성 시각·ID 내림차순으로 한 건을 선택한다.
- [분석 scope head](../../src/server/modules/rework/analysis-input.ts): 소유한 살아 있는 workspace, report tombstone, published review snapshot 검사를 함께 수행한다.
- [진행 상태 최종 fence](../../src/server/modules/rework/state.ts): source authority 및 현재 canonical report identity를 최종 확인한다.
- [리포트 review 읽기](../../src/server/modules/reports/service.ts): 같은 workspace의 canonical 최대 revision을 확인한다.

인덱스는 권한이나 최신성 증명을 대신하지 않는다. 세션·소유자·계정 유형·동의·삭제,
암호문·fragment/source 검증, CAS·lease·멱등 영수증과 검토한 PDF 보호는 기존 경로를 따른다.
report building/failure 같은 상태 갱신은 인덱스 키를 바꾸지 않는다. report 삽입·삭제에는
인덱스 유지 작업과 추가 저장 공간이 필요하다.

부분 `NOT LIKE` 인덱스 대신 전체 복합 인덱스를 사용한다. canonical/export 조회가 공유할 수
있고 SQLite LIKE 함수 설정 및 predicate implication에 의존하지 않는다. 인덱스는 고유하지
않으므로 기존 revision 중복 행을 거부하지 않는다.

## 실제 로컬 비교

Bun 1.4.0 / 내장 SQLite 3.54.0, 메모리 DB·실제 AES·합성 R2의 기존 report fixture로
실제 `getProgress`와 `peekReport`를 실행했다. 측정 대상 사건의 리포트는 실제 서비스로 생성했다.
다른 workspace에는 조회 비용 분리용 합성 헤더 0/100/1,000/10,000건을 추가했다.
이 잡음 행의 복사된 암호문 참조를 유효한 다른 사건 본문으로 주장하지 않으며 본문은 읽지 않는다.
인덱스 적용 전후 동일한 SQL과 바인딩을 실행하고 전체 진행 응답의 동등성을 확인했다.
외부 네트워크는 실행 중 거부했다.

| 다른 workspace 리포트 헤더 | 전체 진행 응답 | D1 method 전→후 | SQL 문장 전→후 |
| ---: | --- | ---: | ---: |
| 0 | 동일 | 57→57 | 61→61 |
| 100 | 동일 | 57→57 | 61→61 |
| 1,000 | 동일 | 57→57 | 61→61 |
| 10,000 | 동일 | 57→57 | 61→61 |

`EXPLAIN QUERY PLAN`에서 canonical head의 `SCAN v2_reports`와 임시 정렬은
`SEARCH ... USING COVERING INDEX v2_reports_workspace_head_idx (workspace_id=?)`로 바뀌고
해당 정렬이 사라졌다. 분석 scope의 리포트 전체 PK 인덱스 스캔도 workspace 인덱스 탐색으로
바뀌었다. review의 최대 revision은 workspace 범위 covering index를 사용했다.
진행 최종 fence의 리포트 탐색도 바뀌지만 **다른 하위 쿼리의 임시 정렬은 남는다**.
export archive의 `created_at DESC, rowid DESC`는 인덱스의 마지막 ID 키와 다르므로
그 조회의 정렬까지 제거했다고 표현하지 않는다.

참고로 헤더 10,000건에서 동일한 준비된 SQL을 25회씩 9묶음 실행한 묶음별 평균의 중앙값은
다음과 같았다. 인덱스 생성과 fixture 준비는 시간에서 제외했다.

| 조회 | 전 로컬 ms | 후 로컬 ms |
| --- | ---: | ---: |
| 분석 scope canonical head | 1.579777 | 0.000825 |
| 리포트 서비스 canonical head | 0.224190 | 0.000288 |
| review 최대 canonical revision | 0.282010 | 0.001473 |
| 진행 상태 최종 fence 전체 SQL | 0.276367 | 0.001475 |

이 시간은 같은 로컬 fixture의 관찰값이며 검사 임계값이 아니다. 실제 D1 `rows_read`,
원격 SQL 시간, HTTP 인증·네트워크, 브라우저 로딩 시간, 운영 p50/p95는 측정하지 않았다.
호출 수 감소나 운영 지연 개선으로 표현하지 않는다.

## 재현 및 인수

[전용 검사](../../tests/report-head-index.test.ts)는 실제 서비스에서 사용하는 SQL을 포착하여
인덱스 전후의 결과와 해당 계획을 검증한다. 시간 임계값을 두지 않는다. 아래 명령은 이 결정적
검사와 DB 적용을 재현하며, 별도 로컬 계측으로 얻은 위 시간표를 다시 출력하지는 않는다.

```sh
bun test tests/report-head-index.test.ts
bun run validate:db
```

기존 report/rework의 snapshot·session·source·삭제·publication 경합 회귀를 함께 수행한다.
전용 검사의 fresh/upgrade는 인덱스 키 방향·비고유성을 확인하고 기존 auth/domain 행·암호문·
snapshot·작업·영수증이 그대로인지 비교한다. 의도한 데이터 변경은 schema marker뿐이다.
로컬 최종 검사는 다음과 같이 통과했다.

- 전용 인덱스 검사: 6개·52 assertions.
- 기존 report/rework/source/session/repository 집중 검사: 122개·1,477 assertions.
- 현재 schema gate와 과거 0022 직접 적용 검사: 85개·536 assertions.
- `validate:db`: schema drift 없음, migration 검사 9개, 로컬 D1 적용과 두 번째 no-op 적용 성공.
- 최종 `validate:quick`: 새 인덱스 검사 포함 Bun 1,911 pass·기존 조건부 skip 4·실패 0,
  Jest 24 suites·108 tests 성공. Astro 574개 파일 errors 0·warnings 0·기존 hints 32.
- `validate:build`: production build, bundle 검사, Worker dry-run, 빌드된 Worker의 로컬 login·보호된 503 HTML 검사 성공.

PR의 정확한 SHA·CI 결과는 해당 PR에서 확인한다.
원격 마이그레이션·preview/production 배포·실제 제공자 검증은 이 기록에 포함하지 않는다.
