# 파일 전송 쿼리와 반복 IO 정비 — #577

사용자 후속 요청의 업로드·다운로드 지연을 원본 파일 경로에서 점검했다.
기준 main은 `bf14048032bbe18323bbed7ece5980fb2d6f0d42`이며
`codex/577-file-transfer-performance`의 별도 worktree를 사용한다.
기존 운영 세션에 모듈 범위를 공유했으며 최종 변경은 preview에만 배포한다.

## 재현한 병목과 수정

기존 `putPart`는 두 번째 조각부터 암호화 키를 얻으려고 첫 8 MiB를 매번 R2에서
받아 hash 검증·전체 복호화했다. 새 업로드는 첫 조각의 서버 생성 wrapped key를
기존 owner/upload revision/ordinal로 AEAD 보호한 receipt에 선택적으로 저장한다.
추가 조각은 현재 권한과 receipt 정합성을 확인하고 이 envelope를 재사용한다.
평문 키나 새 HTTP 입력/응답 필드는 추가하지 않는다.

다운로드는 조각 receipt와 초기 provenance/권한 조회를 하나로 합친다.
같은 헤더를 두 번 복호화하던 경로도 한 번으로 줄인다. 실제 migrated SQLite의
`EXPLAIN QUERY PLAN`에서 해당 join은 인덱스를 사용하며 주요 테이블 scan이 없다.
새 schema/migration/index는 필요하지 않았다.

## 측정 경계

`tests/files-service.test.ts`에서 실제 migrated SQLite, 기존 AES와 private R2 대역으로
동일한 `2 × 8 MiB + 7 bytes` 합성 파일을 업로드·완료·다운로드했다.
업로드 수치는 reserve/complete를 제외한 세 번의 `putPart`, 다운로드는 content 요청부터
stream 종료까지다. 운영 D1/R2의 지연 시간·대역폭이나 실제 사용자 입력은 측정하지 않았다.

| 작업 | 기준 | 수정 후 |
| --- | ---: | ---: |
| 업로드 SQL statements | 62 | 58 |
| 업로드 중 기존 조각 R2 GET | 2 | 0 |
| 다운로드 SQL statements | 21 | 18 |
| 다운로드 R2 GET | 3 | 3 |

조각이 N개인 새 업로드의 반복 첫 조각 읽기 N−1회를 없앤다. 예를 들어 120조각에서는
첫 8 MiB의 추가 읽기 119회(952 MiB)가 사라진다. 필수 완료 probe와 다운로드의
전체 원본 읽기는 유지하며, 이 수치를 실제 전송 시간의 개선율로 표현하지 않는다.

## 무결성·호환·검증

기존 receipt에 key가 없으면 종전 full GET/hash/decrypt 경로로 처리한다.
새 receipt의 key는 실제 binary header와도 대조한다. 손상 key는 write를 거절하며,
원본 ciphertext가 손상되면 최종 probe가 거절하여 manifest를 발행하지 않는다.
추가 조각의 write 직전 동의/세션/소유권 fence와 다운로드 마지막 비동기 복호화 이후
권한 fence를 유지한다. 비용 관측·예약·원장·실제 용량/횟수와 복구 정책은 변경하지 않는다.

다운그레이드할 때는 새 optional receipt reader를 유지해야 한다. migration은 없지만
예전 strict reader 전체로 되돌리면 새 receipt 읽기를 거절한다.

전송 외의 파일 format probe·Container cold start·네트워크·전체 Blob 준비 대기와
리포트 최초 PDF/ZIP 생성 시간은 별도 단계다. 이 변경이 그 시간을 없앴다고 주장하지 않는다.
검증 결과와 정확한 PR/main/preview SHA는 #577의 인수 기록에 남긴다.

로컬 Bun 1.4.0 frozen install과 `validate:quick` 성공(마지막 배치625 pass/2 skip/0 fail),
관련 SQL/API/복구/리포트 다운로드 집중170 pass, 마지막 files/binary/session40 pass,
추가 workerd/refusal·완료복구·mobile HTTP24 pass를 확인했다. `validate:build`는
production bundle budget·Worker dry-run·로컬 workerd login HTML까지 통과했다.
첫 frozen install은 sandbox tempdir EPERM, 첫 dry-run은 sandbox 상위 디렉터리
읽기 제한으로 실패했고 같은 명령을 승인된 로컬 실행으로 완료했다.
실제 OAuth·모델·외부 processor 호출이나 production 배포는 수행하지 않았다.

#581 후속 검증에서 최종 main full40740044593의 자료 교정 reader 실패를 확인했다.
`v2-file-edits.ts`의 별도 strict schema가 새 receipt의 optional wrappedKey를 거절했다.
[누락 정정과 재검증](./CHAT-SCROLL-2026-10-29.md)에서 공통 reader로 통일한다.
최초 전체 검증 실패와 수정 후 결과를 구분하며 이 기록을 전체 검증 통과로 해석하지 않는다.
