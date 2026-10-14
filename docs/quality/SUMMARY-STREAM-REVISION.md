# P30 요약 스트림 경합 확인

- 기준: `a91dc009df34424d841e3644d0e5e120b588f870`, 2026-10-15 KST 로컬 재현.
- 실제 preview 관측: 업로드 완료와 해당 파일 읽기는 성공했지만 후속 전체 workspace 읽기의 요약 스트림이 `STALE_REVISION`으로 종료했다. 새로고침 뒤 새 파일이 보였다. 해당 원격 요청 중 **어느 쓰기가 revision을 올렸는지는 확인하지 않았다**.
- 로컬 원인: `summaryFragments`가 시작한 workspace revision과 각 평문 chunk 직전 revision을 비교한다. 파일 ready 게시, 파일 삭제, 관측의 포함 제외는 요약 ID·snapshot·암호화 manifest를 유지하면서 workspace revision을 올린다. 실제 SQLite/AES repository로 세 작업을 복호화 중 수행하면 모두 쓰기 성공, revision +1, 평문 미반환을 재현했다. 새 요청은 완료했다. 원격 관측과 같은 중단 경로가 가능함을 확인한 것이며 원격 쓰기 종류의 증명은 아니다.

파일 삭제·관측 교정은 요약 pointer를 바꾸지 않고 자료 참조 상태를 바꿀 수 있다. 따라서 snapshot ID만 비교하도록 workspace revision 검사를 제거하지 않는다. 현행 공통 revision 계약의 중단은 유지하고 UI는 완료된 업로드와 후속 읽기 실패를 구분해 복구 수단을 제공해야 한다. 원인별 revision 계약 확장은 이번 수정 범위에 포함하지 않는다.

수정은 시작 SELECT에서 과거 방식의 추가 사실·인물(`snapshot_id IS NULL`) 존재를 같은 DB snapshot으로 확인하고, 없다면 두 빈 목록 조회를 생략하는 데 한정한다. 추가 행이 있으면 기존 병합 경로를 사용한다. owner/current summary/workspace revision/alive 검사, 각 snapshot 부분의 복호화 전후 검사와 무결성 hash, 기존 인증·역할·읽기 동의 계약은 유지한다.

로컬 canonical Hono/AES/SQLite 측정이며 원격 D1 지연이나 브라우저 소요 시간이 아니다. 같은 입력에서 HTTP 수는 변하지 않았다.

| 흐름 | D1 호출 전 → 후 | SQL 문장 전 → 후 |
| --- | --- | --- |
| 요약 GET | 14 → 12 | 14 → 12 |
| 타임라인 생성 후 전체 재확인 | 95 → 93 | 107 → 105 |
| 타임라인 편집 후 전체 재확인 | 96 → 94 | 108 → 106 |
| 행동 저장 후 전체 재확인 | 97 → 95 | 109 → 107 |
| warm focus | 33 → 33 | 39 → 39 |

위 수치는 a91 기준이며 이후 auth/collection 최적화의 감소량과 합산될 수 있다. 관련 검사는 파일 ready/delete/exclude 경합, owner/summary/revision/계정·사건 tombstone 경합, 후속 chunk 차단, 누락·변조 snapshot, 과거 사실·인물 병합, 큰 Unicode 요약과 canonical 작업량을 포함한다. 외부 연동·preview 성공을 이 로컬 검사로 대신하지 않는다.
