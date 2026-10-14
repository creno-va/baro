# 공개 디렉터리 검색

ADR-0015와 #231의 조회 계약이다. 목록은 `GET /api/v2/lawyers/directory`에서
`{items,nextCursor,expiresAt,rotation}`을 반환한다. 기본 20개, 최대 50개다.
`name`은 이름 또는 사무실의 NFKC·소문자 변환 후 리터럴 부분 일치이고 `region`,
`legalField`는 객관적 필터다. `%`, `_`, 대괄호를 패턴 연산자로 해석하지 않는다.

`v2_directory_entries`에는 공개 동의된 카드 필드만 저장한다. 연락처·주소·활동 상세,
비공개 초안·사건·자격 자료는 저장하지 않는다. 인라인 공개 JPEG는 분리하고 공개 권한과
정확한 revision을 검사하는 photo 경로로 제공한다. 자격 확인 표시는 원래 공개 출처를 따른다.

이름·사무실의 문자/2문자 토큰과 지역·분야 조합을 일반 D1 테이블에 저장한다.
최대 네 개의 101행 표본에서 시작 인덱스를 고르고 PK 범위로 한 번에 20~50개,
요청당 총 100개 후보만 검사한다. 후보 안에서 부분 일치·필터·공개 권한을 확인하므로
짧거나 빈 페이지에도 다음 cursor가 있을 수 있다. 전체 결과 count/sort/snapshot은 만들지 않는다.

KST 날짜의 SHA-256 pivot부터 `(sort_key,profile_id)`로 전진한 뒤 처음으로 한 차례 돌아온다.
AES-GCM cursor는 검색 조건·페이지 크기·출처·날짜·pivot·진행 위치·epoch·만료를 묶고,
환경과 릴리스 SHA에 키를 격리한다. TTL은 최대 5분이며 KST 자정을 넘지 않는다.
수정·공개 철회·삭제·권한 변경은 epoch를 바꾸므로 기존 페이지 이동은 409로 다시 검색한다.
응답 직전 공개 권한·source revision과 epoch를 다시 확인한다.

공개 저장과 projection 갱신은 같은 D1 batch다. 자산·원본 권한의 CAS가 실패하면 함께
롤백한다. tombstone과 자산/공개 원본 제거는 projection·역색인·사진·참조를 함께 제거한다.
복구 journal replay는 tombstone이 이미 존재해도 projection을 명시적으로 재삭제한다.
기존 v1 암호문과 공개 여부, 자격 검증 이력은 바꾸지 않는다.

기존 `/api/v2/lawyers` 및 `/self-service`는 같은 인덱스의 bounded adapter다.
선택된 페이지의 공개 DTO만 복원하고 다시 권한을 확인한다. 새 클라이언트는 통합 card
API의 첫 페이지만 읽고 사용자가 더 보기를 요청할 때 다음 페이지만 읽는다.

## 마이그레이션과 검증

`0010`, `0011`을 보존하고 `0012_directory_index`로 테이블·삭제 trigger를 추가한다.
기존 공개 자료는 배포 후 `Directory reindex (manual)`로 기존 publication Workflow에
재색인 작업을 보낸다. 두 운영자/main으로 제한하며 실제 서비스 SHA 일치, 단계당 원시
프로필 20개·실행당 최대 10,000개, 동일 내용 instance ID로 재시도를 제한한다.
비공개 초안은 복호화하지 않고, 재색인이 끝날 때까지 새 목록은 미색인 항목을 반환하지 않는다.
기존 공개 항목을 새 경로에서 누락 없이 보려면 재색인 완료가 필요하다.

2026-10-14 합성 native D1 비교: 100/10,000 프로필 모두 검색 7 statement,
읽기 874/876행·쓰기 0행. 동일 공개 카드 수정은 4 statement, 읽기 109행·쓰기 130행이다.
문자 index와 최종 카드 PK를 명시해 planner가 전체 entry scan을 선택하지 않게 한다.
이는 합성 조회 측정이며 실제 운영 처리나 법률 검증의 증거가 아니다.
관련 회귀는 `tests/indexed-directory*.test.ts`, 삭제·사진 경로는 기존 self asset 회귀가 검증한다.
