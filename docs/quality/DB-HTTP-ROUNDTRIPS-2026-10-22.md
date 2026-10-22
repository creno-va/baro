# DB·HTTP 왕복 축소 검증 (#317)

기준은 선행 UI·법률·모델·첨부·리포트 PR 통합 main
`c2258b88fb62a4570755e548d2e2288e2108e778`이다. Bun1.4.0의 실제
Hono/client/AES/SQLite 경로를 동일한 합성 입력으로 변경 전후 측정했다.
공급자와 R2는 합성 대역이다. 아래 HTTP 수에는 하네스의 앞뒤 실제 세션 검사가
포함되며 원격 D1 SQL 시간·브라우저 응답시간·실제 OAuth/공급자 성공을 뜻하지 않는다.

| 경로 | HTTP 전→후 | D1 호출 전→후 | SQL 문장 전→후 |
| --- | --- | --- | --- |
| 행동 저장 | 12→8 | 87→51 | 99→62 |
| 타임라인 추가 | 12→8 | 85→49 | 97→60 |
| 타임라인 수정 | 12→8 | 86→50 | 98→61 |
| 요약 focus/재조회 | 6→6 | 34→30 | 41→37 |
| 요약 저장 | 9→9 | 83→77 | 131→125 |
| 요약 확인 | 9→9 | 58→52 | 74→68 |
| 사건 cold focus | 12→12 | 77→73 | 84→80 |
| 사건 warm focus | 7→7 | 33→33 | 39→39 |
| 자료 페이지 focus | 6→6 | 27→27 | 33→33 |
| 빈 공개 목록 index | 해당 없음 | 5→4 | 5→4 |

공개 목록은 같은 빈 DB에서 main 구현과 변경 구현을 직접 실행했다.
두 pivot 범위와 마지막 epoch/철회 fence를 유지하며 후보가 하나뿐인 lead sample만
생략한다. 기존 compatibility 목록의 hydration 및 최종 확인은 유지한다.

## 구현과 검증 범위

행동·타임라인 응답의 `committedWorkspaceRevision`은 원자적 쓰기와 멱등
영수증의 revision이다. 저장 전 snapshot N과 영수증/새 workspace N+1이 일치할
때만 변경한 목록을 다시 읽는다. 파일 metadata, 마지막 workspace 및 UI 세션
검사는 유지하며 peer 변경·영수증 없는 응답·조회 중 변경 시 전체 조회한다.
재시도는 원래 영수증 revision을 사용한다. 사건·계정 삭제 시 보유 private
목록을 반환하지 않는다. pagination 범위를 유지하며 새로운 공유 캐시·replica는 없다.

intake·summary는 repository의 최초 owner/tombstone 조회와 복호화 후 또는
fragment별 fence를 보존하고 중복 service workspace 조회만 제거한다.
schema/migration·새 공급자/모델·비용 정책·원장·hold·기술 quota 변경은 없다.

검증 명령과 최종 exact PR SHA·CI 결과는 [#317](https://github.com/creno-va/baro/issues/317)에
기록한다. 변경 범위의 API·source/owner·삭제·CAS·멱등 재시도·draft·pagination
회귀와 quick/build/DB를 확인한다. 같은 SHA의 실제 preview/production 및 외부
성능 검증은 #71의 별도 gate이며 이번 로컬 수치를 배포 성과로 사용하지 않는다.
