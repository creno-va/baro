# v2 검증 — 현재 판정과 증거

- Reviewed: 2026-10-14 KST; [현행 인수표](./MVP-REQUIREMENTS-EVIDENCE.md), [실행 기준](./EXECUTION.md).

제품 통합 PR167과 후속 정비 PR230/229/232/233/234/235/241은 main에 병합됐다.
각 PR의 정확한 head·CI와 로컬 SQL/native/browser 결과는 해당 PR/run에 기록한다.
04f25f8의 같은 SHA CI·preview·production과 실제 일반 채팅·PDF/HTML은
[receipt](https://github.com/creno-va/baro/issues/71#issuecomment-6168531808) 범위에서 확인했다.
비용 관측 분리/0015는 PR247에 병합했다. 통합 SHA의 배포·실제 결과는 #71 receipt를 따른다. 새로운 결과를 과거 SHA에 소급 적용하지 않는다. 정책 초안·placeholder는 #20/#70 초안 인수 범위이고
법률 승인이나 공급자 계약 사실을 뜻하지 않는다.

| 범위 | 구현 검증 | 실제 인수 잔여 |
| --- | --- | --- |
| 금액 차단 해제 | PR241과0014가04f25f8에 배포됨 | 실제 일반 채팅/PDF/HTML receipt 보존; 전체 경로 인수로 확대하지 않음 |
| 비용 관측 분리 | PR247 병합: 기존 proof가 있는 환경의 만료·월·IO 차단 분리, 원장/hold 보존 회귀 통과 | #57/#71 동일 SHA receipt; 가격 proof 없는 신규 환경 bootstrap 결합 잔여, 비용 정책 재도입 금지 |
| 원본/공개 복사 | 인증/소유권·writer start/stop 응답 유실·late PUT·cleanup·native D1 상한 | #58 실제 inventory/projection·R2·실패 cleanup |
| 검색 | 공개 최소 projection·한글/영문/특수문자·필터·cursor·철회/삭제·100/10,000 native | #231 bounded 원격 reindex·같은 SHA smoke |
| 릴리스 | 후보/환경/종류/reference/hash 검증·두 운영자 정확한 SHA/만료·manual full checkout SHA | #19/#71 최종 full·같은 SHA preview/prod·실제 승인 |
| 전체 MVP | 기존 통합 SQL/native/browser·v1 보존·G01~G08 시나리오 | #27/#59/#63/#64/#66/#67/#71 실제 OAuth·모델·법률·자료·다운로드·삭제/복구·경보 |

실제 관측 [status38522585343](https://github.com/creno-va/baro/actions/runs/38522585343)은
양 환경 schema0009와 미정산·projection 없음을 확인한 읽기 전용 결과다. 처리 재개나
그 당시 새 main 배포 성공은 아니었다. 이후04f25f8 배포와 구분한다. 미완료 이슈는 담당·blocker·다음 행동을 유지하며 #71을 조기 종료하지 않는다.

2026-10-11까지의 세부 source SHA·실패·중간 판정·배포·콘솔 관측은 [검증 이력](./V2-VALIDATION-HISTORY.md)에 보존한다.
