# 큰 자료 결과의 목록 조회 회귀 검증

- 검증일: 2026-10-15 KST
- 범위: #71 P37, 작업 공간·리포트 검토의 자료 목록 조회
- 재현 기반: `4d8ace6621900488ee6c2a9a33381312d8352893`
- 합성 검증: `tests/workspace-file-coverage.test.ts`

## 재현과 원인

기존 전체 작업 공간 조회는 ready 자료마다 compact 파일 원문 API를 호출했다.
저장소의 compact 읽기는 관측 또는 파생물 중 하나라도 8개를 넘으면
`SNAPSHOT_STREAM_REQUIRED`로 거절한다. 자료 목록은 coverage만 표시하지만 이 원문
조회 실패를 전체 작업 공간의 일반 실패로 전파했다. 자료 전용 metadata 목록은
이 읽기를 하지 않아 열릴 수 있었다. 리포트 검토 화면의 자료 목록도 같은 경로다.

합성 AES 암호문·SQLite·실제 API/client 조합에서 관측 8개는 성공하고 11개는
compact API 500 및 작업 공간 조회 실패로 재현했다. 관측이 0개이고 파생물만
8개에서 9개가 되는 경계도 독립 재현했다. 이것은 로컬 읽기 계약 검증이며 외부
파일 처리 성공 또는 실제 Cloudflare 실패 endpoint의 직접 증거가 아니다.

실제 preview에서 영상 ready 뒤 작업 공간이 실패하고 자료 전용 목록은 열리는
현상은 총괄의 단일 인수표에서 추적한다. 실제 영상의 coverage 11개와 관측 문장
개수를 같은 수치로 기록하지 않는다. 배포 후 같은 사건의 복구는 별도 확인 대상이다.

## 수정과 유지 경계

자료 목록은 명시적 `view=coverage`를 사용한다. 반환값은 id/revision/status/coverage
뿐이며 client는 목록의 id·revision·ready 상태와 일치해야 수용한다. 실패나 삭제를
오래된 ready 목록으로 숨기지 않는다. 쿼리의 추가 키나 잘못된 view는 거절한다.

서버는 기존 metadata 복호화·스키마와 전후 row 검사를 재사용한다. coverage는 기존
bounded snapshot reader의 4MiB·part 순서/길이·AES·hash·owner/target/purpose/revision·
최종 header 검사를 그대로 거친다. source probe의 byteLength, coverage의 category와
page/duration/audio 관계, ready의 manifest/probe/currentJob/operation/failure 조건을
compact 계약과 동일하게 검사한다. 마지막 owner/alive/file revision·상태·coverage pointer·
metadata envelope·ready 필드 검사가 늦은 변경을 차단한다.

원본/관측/파생물 전체를 목록에서 복호화하지 않는다. 기본 compact의 각 8개 상한,
자료 확인의 bounded paging, 서버 리포트 생성의 전체 source 읽기 및 원본 다운로드는
변경하지 않는다. 읽기에 새 mutation 동의를 요구하지 않는다. DB schema, 기술 한도,
provider, 비용·권한 정책은 변경하지 않는다.

## 로컬 결과와 한계

- 단일 part coverage 자료의 내부 읽기: 기존 compact 14 D1 calls/14 statements →
  projection 7/7. HTTP/auth 공통 비용은 이 수치에 포함하지 않으며 실제 지연 개선을
  이 수치로 단정하지 않는다.
- 자료 6개·관측 11개인 합성 사건의 전체 작업 공간/자료 전용/리포트 검토 목록 성공.
  자료 확인의 3개 page에 11개 관측이 모두 보존되고 서버 리포트에도 각 끝표식이 남는다.
  원본 다운로드 bytes도 동일하다.
- 파생물만 9개인 경우 compact는 계속 거절하며 coverage 목록은 성공한다. 파생물
  회귀 fixture는 저장된 합성 bytes를 참조하는 읽기 메타데이터이며 실제 처리나 물리
  파생물 provenance의 검증으로 확대하지 않는다.
- 소유권/사건·계정·파일 삭제/revision/coverage pointer/상태/metadata의 복호화 중 변경,
  손상된 header/parts/암호문, probe 불일치, ready DB 제약과 client 응답 불일치를 거절한다.
- `bun ci`, `validate:quick` 통과. 관련 8개 테스트 파일은 126 tests/977 assertions 통과했다.
  build는 총괄의 동일 통합 후보에서 수행하며 이 단위 변경의 별도 성공으로 기록하지 않는다.

이 문서는 로컬 원인·수정 근거다. 실제 preview의 동일 영상·사건 복구와 실제 사용자
흐름 완료는 [단일 인수표](./PREBETA-MVP-LIVE-ACCEPTANCE.md)의 배포 SHA 및 브라우저
receipt로 별도 판정한다.
