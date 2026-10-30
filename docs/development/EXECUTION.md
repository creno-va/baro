# 에이전트 실행 기준

2026-10-31 PR #617 릴리스 CI에서 기존 리포트 구조·중복 조회 수·구형 스키마 fixture에 남아 있던
회귀 기대값을 현재 계약에 맞춘다. 원본 바이트/ACK·세션·삭제·snapshot immutability 검사는 유지한다.
과거 migration fixture 전송은 그 시점의 실제 열만 복사하고 최신 schema 전송은 모든 열을 보존한다.
사용자의 검사 축소 지시에 따라 PDF CI는 실제 native 렌더링·HTTP/resource 보안 검사와 report 이름의
모든 단위/통합 테스트 및 사진 caption 회귀를 실행한다. 매 PDF 변경마다 전 도메인4564개를 반복하던
검사만 분리하고 전체 프로젝트 검사는 validate:full에 보존한다. main CI·판례 CI는 유지한다.

2026-10-31 대화 탭의 메시지 영역은 내부 스크롤을 유지하며 스크롤바와 예약 여백만 숨긴다.
표준 scrollbar-width와 WebKit 의사 요소를 함께 적용한다. CSS/diff 확인 후 로컬에 누적한다.

2026-10-31 사건 상세 레일탭 아이템의 동일 고정 폭을128px에서112px로 줄인다. 높이48px와
가로 스크롤은 유지한다. CSS 적용 규칙과 diff를 확인하고 로컬 커밋으로 누적한다.

2026-10-31 변호사 찾기의 서버 페이지네이션은20개 카드와 인증된 keyset cursor를 사용하며
인덱스 범위 조회·최대100개 후보·현재 공개 권한/epoch·5분/일 경계 만료를 유지한다. 웹에는
수동 더 보기만 있었으므로 하단320px 근접 시 다음 페이지를 자동 조회하도록 연결했다.
동일 쿼리/커서의 동시 요청을 합치고 필터 변경·해제된 observer·취소된 응답이 새 검색에
이전 페이지를 섞지 못하게 한다. 마지막 cursor=null이면 중단하며 버튼은 접근성/호환을 위한
수동 대안으로 유지한다. 연속 빈 후보 창3개는 자동 탐색을 멈추고 수동 더 보기로 재개해
한 화면이 전체 디렉터리를 연속 스캔하지 않도록 한다. 전송 실패는 현재 카드와 커서를 보존해
같은 페이지를 재시도하고, 만료/무효 커서는 새 검색으로 복구한다. 실패 자동 반복은 하지 않는다.
관련 단위12개·로컬 native D1 검사1개와 브라우저9개 및 루트/도구 타입 검사를 통과했다.
합성100개/10000개에서 같은20개 카드의 native D1 읽기는7문장·874/876행·쓰기0행으로 측정했고
lead 조회가 인덱스 SEARCH이며 전체 SCAN/임시 정렬을 쓰지 않는 것을 확인했다. 실제 운영
DB·CI·PR·배포는 변경하지 않고 로컬 커밋으로 누적한다.

2026-10-31 리포트의 주요 사실과 증거 자료를 분리하고, 선택한 현재 파일 revision을 기준으로
증거 번호를 부여한다. 사실·경위에 해당 증거 번호와 페이지/음성 구간/영상 표본 위치를 표시하며
증거 항목은 파일명과 포함된 관찰·전사를 보여준다. 사용자가 제외한 관찰/파일·변경된 파일의
근거를 승격하지 않고 직접 수정·불확실·미판독 표시는 유지한다. 화면과 PDF용 HTML이 같은
섹션/마크다운을 사용하고 기존 선택 사진은 증거 섹션 안에 배치한다. 기존 저장본·편집을
덮지 않고 새 버전 생성부터 반영한다. 파일 해석 구현은 이미지 분석, Whisper 음성 전사,
영상 표본 프레임/추출 음성 처리 후 권한을 재검사해 관찰을 게시하는 경로를 확인했다.
관련 합성 처리·리포트 회귀105개, 사진/근거 표시·공유 HTML 관련33개와 인라인 증거 편집·저장
브라우저1개를 통과했다. 이 검사는 실제 배포 환경의 외부 공급자 호출 성공 증거가 아니다.
로컬 커밋으로 누적하며 CI·원격 PR·병합·배포는 다음 사용자 지시를 따른다.

2026-10-31 내 변호사 프로필을 사진 표면·번호가 있는 세로 섹션·데스크톱 3열 기본 정보와
연락처·회색 소개 입력·우측 하단 저장 액션으로 정리한다. 비공개/저장 상태·변경 취소·공개
설정 UI를 제거하고 스티키 헤더와 하단 구분선의 상단 여백을 데스크톱24px/모바일96px로 유지한다.
유효한 소유자 저장은 공개 revision·공개 기록·디렉터리 투영을 같은 batch로 기록하며 false
공개 전환은 거절한다. 빈 프로필/필수 정보 누락은 공개 저장하지 않는다. 구버전의 boolean
스냅샷 계약과 true 공개 endpoint는 복구 호환용으로 보존하고 모바일의 공개 철회 액션도 제거한다.
0019_self_profile_listing은 ADD COLUMN으로 기존 연결 자료·심사 이력·암호화 원본을 보존하고
기존 공개 원본만 listed로 표시한다. 기존 비공개 초안은 다음 소유자 저장 때 새 공개 revision으로
전환하며 migration이 암호화 내용이나 동의 기록을 새로 작성하지 않는다. 소유권·세션·정책 동의·
자료 정제/삭제·자격 검증 경계는 유지한다. 합성 시딩과 최신 schema 준비 검사도0019에 맞춘다.
관련 단위/권한202개·프로필 브라우저32개와 루트/도구/모바일 타입 검사, 문서 검사를 통과했다.
validate:db에서 schema drift·fresh/upgrade·로컬 D1 파일 적용·재적용을 확인했다. 화면은1440px와
320px에서 직접 검토했다. 실제 사건·유료 API 호출 없이 로컬 누적하며 원격 DB 적용·CI·PR·배포는
다음 사용자 지시까지 보류한다.

2026-10-31 판례 비교의 사건 단위 최근 작업 복원·강제 상세 열기를 제거한다. 상세는 명시적
선택으로만 열고 비교 복원은 원문의 sourceId별로 구분한다. 비교 자체의 게시 revision은
정상 결과로 인정하며 성공한 결과를 일시적인 재조회 오류 카드로 덮지 않는다. 실제 실패·
권한 철회·출처 변경은 기존대로 처리한다. 검색 결과 헤더는 제목/건수/시각 한 줄, 카드는
2줄 제목·메타정보·주제 배지와 카드 전체 액션으로 정리한다. 일부 원문의 진단과 top-N
안내는 정상 결과에 출력하지 않되 검증에 실패한 원문을 결과로 승격하지 않는다.
검색은 요청당 최대5건을 검증하고 서명한 다음 페이지로 추가 조회한다. 커서는 소유자·사건·
요약/사건 버전·주제에 묶이며 10분, 최대500개 원문/후보 위치4000의 기술 경계를 갖는다.
요청별12회 외부 시도/120초·공개 주제만 전송·원문 hash/권한 검사는 보존한다. 전문 읽기는
확보한 원문 전체(기존1MiB 상한)를 반환하고 제목 표기를 계층화한다. 비교 입력은 기존
4000자 발췌이며 원문의 UTF-16 위치와 정확 인용/강조 검증은 유지한다. pageSize/includeFullText
명시 요청에만 새 응답 필드를 추가해 기존 엄격한 클라이언트 응답 계약을 보존한다.
관련 단위/공통 검색/모바일 호환/원문 회귀179개와 판례 브라우저13개를 통과했다.
실제 외부 API·모델 호출 없이 로컬에 누적하고 CI·원격 PR·병합·배포는 다음 지시를 따른다.

2026-10-31 리포트를 사건 개요·당사자와 관계·주요 경위·주요 사실과 자료·추가 확인 사항의
상담 문서로 정리한다. 모든 항목은 같은 폭·위계의 한 흰 문서 안에 두고 회색 편집 입력과
마크다운 목록/강조를 제공한다. 자료에서 읽은 내용과 확인하지 못한 구간은 본문/추가 확인
사항에 남기고 앱의 행동 목록·처리 범위 섹션·작은 주의/출처 주석·내보내기 안내는 제거한다.
사진은 각 항목 편집 도구에서 커서 위치에 삽입하며 화면/PDF가 같은 위치를 사용한다.
새 웹 편집의 식별정보 자동 가림과 별도 사진 설정 UI는 제거하고 기존 저장본·모바일 API의
가림 계약은 보존한다. 사진 읽기는 소유자/세션·파일 revision/hash·삭제를 재검사하며 외부
URL/임의 HTML은 실행하지 않는다. 새 버전 모달 위계·문구·우측 액션을 정리한다.
변경별 단위/권한·브라우저·동일 PDF 엔진의 합성 출력만 확인하고 로컬에 누적한다.
관련 단위/권한/내보내기100개와 편집/사진 저장·삭제/모바일 모달 브라우저3개, 루트/도구
타입 검사를 통과했다. WeasyPrint62.3의 실제 합성 PDF를 PNG로 검토했으며 사진2개의 본문
배치·다음 문장·한글·페이지 번호를 확인했다. 외부 모델 호출/실제 사건 처리는 하지 않았다.
CI·원격 PR·병합·배포는 다음 사용자 지시까지 보류한다.

2026-10-31 리포트 최초 로딩은 아래의 작은 공통 로딩 컴포넌트 하나만 표시한다.
중복된 상단 진행 표시를 숨기고 접근성 상태 알림은 작은 컴포넌트로 옮긴다.
리포트가 열린 뒤 저장·PDF 생성·권한 확인의 진행 표시는 유지한다. 로컬에 누적한다.

2026-10-31 사건 요약 편집의 하단 저장 버튼에 요약 확인과 같은 공통 주 액션 스타일을
적용한다. 입력 영역 전체 너비·최소56px 높이·24px 상단 간격과 18px 아이콘을 사용하며
기존 저장·비활성화 조건은 유지한다. 로컬 커밋으로 누적하고 CI·원격 반영·배포는 보류한다.

2026-10-31 사용자 후속 요청을 `codex/upload-processing-policy`에 로컬로 누적한다.
웹 파일의 한 번 읽기/해시 재사용·첫 조각 후 최대3개 동시 전송·중복 조회 제거와 preview
Server-Timing을 추가하고, 사건/판례 Workflow 시작을 접수 응답에서 분리한다. scheduled
실패 격리와 탭 복귀·네트워크 재연결의 즉시 상태 조회, HTTP 대기 제한을 적용한다.
서버 current_time 도구는 UTC/KST를 제공하며 요청일 기준·독립 검수와 권한/원장/한도를 유지한다.
동의 취소 링크·정책 목차를 제거하고 황은찬/CEO·문의처를 반영한 2026-10-31 정책의 서비스
내용 검토를 완료한다. 새 계정 동의와 기존 파일별 동일 목적 동의의 보존을 구분한다.
국외 계약·운영 보유기간과 독립 법률 검토는 확인 완료로 표시하지 않는다.
원격 CI·PR·병합·배포와 운영 DB 변경은 실행하지 않으며 다음 사용자 지시를 따른다.
운영 집계와 검토 범위는 [처리·정책 검토 기록](../quality/PROCESSING-POLICY-REVIEW-2026-10-31.md)을 따른다.

2026-10-30 최신 사용자 지시로 누적 포커스/사건 UI·판례 비교 안정화·변호사 AI 및 프로필
변경을 원격 PR로 제출하고 CI 통과 후 main에 병합해 preview에만 배포한다. 현재 DB와 환경
키를 유지하며 production 배포는 요청하지 않는다. 검증은 기존 CI와 변경별 확인을 사용한다.

2026-10-30 사용자 지시로 변호사 계정도 고객과 동일하게 본인 사건·AI·파일·판례·리포트를
이용한다. 공통 시작 경로는 /app이며 사이드바는 새 사건 입력·변호사 프로필과 본인 사건
이력으로 구성한다. 변호사 메뉴의 공개 디렉터리 링크를 제거하되 고객용 변호사 찾기는 유지한다.
페이지/HTTP/실행/파일 및 리포트 스트림의 기존 고객 전용 조건을 두 계정 유형으로 확장한다.
소유권·세션·필수 동의·요청 출처·실행 fencing·일별 quota와 자료 무결성은 그대로 유지하며
검증 자격/관리자 권한이나 타인 프로필 편집을 부여하지 않는다. 프로필 편집은 상단 저장/미리보기,
정보별 편집 섹션·사진 업로드·분야 선택·공개 설정의 위계를 정리한다. 관련 합성 API/업로드/
내보내기·기존 프로필 권한·세션 철회 및 모바일·데스크톱 브라우저 검증과 타입·린트를 통과했다.
외부 OAuth/모델 실제 호출은 하지 않았고 로컬에 누적한다. CI·원격 PR·병합·배포는 다음 지시를 따른다.

2026-10-30 판례 비교의 일부 근거 오류가 전체 재생성/실패로 이어지던 경로를 항목별 검증으로
변경한다. 정확 인용이 맞지 않거나 독립 검수가 승인하지 않은 지표는 설명/인용을 모두 버리고
서버의 unknown으로 대체하며 승인된 다른 지표는 보존한다. 낮은 유사도·전부 미확인은 정상
결과이고, 공급자·형식·권한·원문 무결성·전역 개인정보/정책 오류는 실패로 유지한다. 비교만의
맥락 로드로 불필요한 대화/파일/다른 출처 조회를 생략하고 prompt1.2와 항목별 고정 검수 응답을
사용한다. 별도 MEDIUM 감사·실행 원장·쿼터·출처 만료와 게시 fence는 유지한다. 외부 유료 호출과
CI 없이 합성 API/항목별 점수/공통 gateway·게시·맥락 회귀218개와 타입·린트 검사를 통과하고
로컬에 누적한다.
실제 화면의 과거 실패 원인은 해당 job 영수증 없이 단정하지 않으며 배포는 다음 지시를 따른다.

2026-10-30 판례 비교 실패·재검색 필요 안내는 하나의 큰 복구 카드로 통합하고 원문 열람과
기존 권한·출처 만료·처리 복구 검사를 유지한다. 검색 결과는 제목/건수·주제·조회 시각의
위계를 구분하고 카드의 제목·메타정보·상세 액션 간격을 정리한다. 리포트는 요약을 먼저
구분하고 세부 정보와 사진/가림 설정을 데스크톱 두 열·모바일 한 열로 배치한다. 편집 내용과
숨겨 둔 출처의 보존, PDF 생성 계약은 유지한다. 판례 브라우저4개·리포트 브라우저2개·실제
제품 레이아웃2개·편집 범위 단위4개와 타입/린트 검사를 통과했다. 로컬 커밋으로 누적하며
CI·원격 PR·병합·배포는 다음 지시까지 보류한다.

2026-10-30 다음 행동의 체크/해제 성공 라벨을 제거하고 완료 수량을 프로그레스바 바로 위
왼쪽에 배치한다. 수량의 접근성 알림과 처리 중 표시·저장 실패/낙관 갱신 복구는 유지한다.
기존 완료 저장/세션 실패 복구 브라우저 2개를 통과했으며 로컬 커밋으로 누적한다.

2026-10-30 사이드바 사건의 포커스 강조와 삭제 아이콘 노출은 키보드 탐색 때만 적용한다.
포인터 hover는 기존대로 유지하며 마우스로 모달 취소/닫기 후 복귀한 초점이 행을 계속
강조하지 않게 한다. 초점을 강제로 지우지 않고 키보드 Enter/Escape의 모달 복귀를 보존한다.
다른 곳 클릭 없이 취소/닫기 후 강조 해제와 키보드 복귀를 합성 브라우저에서 확인했다.
로컬 커밋으로 누적하며 새 배포는 다음 지시를 따른다.

2026-10-30 활성 사건 요약 편집의 하단 복귀 링크를 항상 보이는 주 버튼 `수정 내용 저장`으로
교체한다. 중복된 활성 편집 저장 버튼은 제거하고 기존 revision 저장/확인 경로로 변경 내용을
적용한다. 변경 없음·빈 값·5천자 초과·권한/충돌·처리 중에는 저장을 막으며 상단의 탭별 복귀
링크와 미저장 이탈 경고는 유지한다. 합성 화면에서 저장/적용·재조회 유지·입력 제한을 확인했고
기존 회귀의 액션 이름을 갱신했다. 로컬 커밋으로 누적하며 원격 반영·배포는 다음 지시를 따른다.

2026-10-30 후속 포커스 점검은 배포된 main90803dc에서 `codex/focus-feedback`으로 진행한다.
아코디언의 키보드 외곽선과 리포트·변호사 검색·판례 주제 라벨의 개별 파란 테두리를 제거하고
로그인/동의를 포함한 서비스 공통 CSS로 통합한다. 키보드 탐색은 내부 표시/헤더 텍스트 밑줄로
구분하며 마우스·터치·자동 초점과 단순 입력에는 외곽선을 추가하지 않는다. 기존 초점 순서와
Enter/Space·모달 Escape/초점 복귀는 보존한다. 전체 사건 탭·설정·변호사 상세/편집·질문·로그인·
동의·도움말/정책의 데스크톱/모바일 포커스 순회와 실제 터치 7개, 배포 빌드 CSP 1개와
도구 타입 검사를 통과했다. 재현된 아코디언과 검색/주제 라벨의 외곽선은 제거됐다.
이번 후속 변경은 로컬 커밋으로 누적하며 새 PR·CI·병합·배포는 다음 지시까지 보류한다.

2026-10-30 최신 사용자 지시로 누적 UI·사진 PDF 변경의 원격 PR 제출, CI 후 병합과
preview 배포를 진행한다. 이번 배포 대상은 preview만이며 production은 기존 배포를 유지한다.
DB 연결·기존 데이터·환경 키를 유지하고 전체 UI 검증 대신 변경별 확인과 기존 CI를 사용한다.

2026-10-30 리포트의 사진 선택 UI를 복원한다. 서버가 제공한 현재 리포트의 사진 후보만
명시적으로 선택하며 최대12장/합계8MB와 기존 원본의 소유권·revision/hash 검사를 유지한다.
다운로드가 본문과 선택을 함께 저장하고, 식별정보 가림은 사진 픽셀을 제외하되 선택은 보존한다.
PDF는 A4 본문 위계·번호 배지·여백·페이지 번호를 정리하고 비율을 유지한 사진/파일명/설명을
본문 뒤 별도 페이지에 배치한다. 인쇄 엔진62.3에서 지원하지 않는 flex gap은 실제 간격으로
대체한다. 사진/가림/원문 검증12개·브라우저2개와 동일 엔진의 세로/가로 사진 PDF 조판을
확인했다. 로컬 커밋으로 누적하며 CI·push·병합·배포는 다음 지시까지 보류한다.

2026-10-30 유사 판례 상세는 제목·메타정보와 원문/비교 액션을 한 헤더로 묶고 본문을
중첩 카드 없이 배치한다. 비교 결과는 점수 요약·8개 지표·강조 원문 순서로 표시하며
같은 판결문을 중복 출력하지 않는다. 산정 기준은 접고 근거 모달은 넓은 화면에서 사건과
판례를 나란히, 모바일에서는 세로로 읽는다. 기존 비교·복원·권한·출처 검증 계약은 유지한다.
합성 브라우저 두 시나리오의 모바일/데스크톱·원문·근거 모달·재조회와 정적 검사만 확인하며
로컬 커밋으로 누적하고 CI·원격 반영·배포는 다음 지시까지 보류한다.

2026-10-30 리포트 탭 본문은 외곽 카드의 테두리·배경·그림자·패딩 없이 배치한다.
수정하기/수정 마치기는 헤더의 아웃라인 버튼, 새 버전 만들기는 아이콘 없는 주 버튼이며
편집 버튼을 fieldset 밖으로 옮겨도 접근 확인·접근 불명·동의·busy 차단을 명시적으로 유지한다.
식별정보 체크박스/텍스트는 가운데 정렬하고 설명 들여쓰기를 없앤다. 화면 섹션 번호는
앞자리 0 없이 연한 주 색상 배지로 표시한다. PDF 템플릿·본문 저장·가림 계약은 유지하며
기존 편집/저장/재조회 한정 확인 후 로컬 커밋으로 누적하고 CI·배포는 보류한다.

2026-10-30 판례 비교의 출처 카드는 대화 목록 투영에서만 생략한다. 암호화된 비교 결과와
유사 판례 탭의 원문/지표, 모델용 이력은 보존하고 문장 매칭 대신 저장된 비교 메타정보로
구분한다. 일반 답변의 공식 출처 카드는 유지하되 중복된 검증 출처 라벨을 제거한다.
답변의 문장·자료·출처 사이 간격과 긴 파일명/판례명의 줄바꿈을 정리하며 해당 저장 투영과
모바일/데스크톱 줄바꿈만 확인한다. CI·원격 반영·배포는 다음 지시까지 보류한다.

2026-10-30 사건 요약/준비 현황의 섹션 간격을 늘리고 미확인 내용은 불릿, 준비 수량은
자료·타임라인·남은 다음 행동의 가로 wrap 링크 배지로 표시한다. 채팅 높이는 문서상 상단
위치를 기준으로 계산하며 페이지 스크롤/하단 아코디언 변화로 다시 커지지 않게 한다.
상단 요소와 실제 viewport 크기 변경만 관측하고 입력창의 기본/포커스 그림자는 제거한다.
높이 유지의 모바일·데스크톱 한정 회귀만 확인하고 전체 UI·CI·원격 반영·배포는 보류한다.

2026-10-30 서비스 공통 포커스 표시는 마지막 입력 방식을 구분한다. 마우스·터치 조작과
이후 자동 포커스 이동에는 파란 outline을 숨기고 키보드 탐색 시 버튼·링크·입력의 표시는
유지한다. 탭 본문·채팅 이력·사이드바 스크롤 영역·자동 이동 대상 제목/본문·모달 전체에는
컨테이너 outline을 그리지 않는다. 모달 초점 가두기·Escape·열었던 버튼으로 복귀와 스크롤
영역의 키보드 조작은 유지하며 랜딩 페이지는 이 서비스 스타일 범위 밖이다. 로컬 커밋으로
누적하고 CI·원격 반영·배포는 다음 사용자 지시까지 보류한다.

2026-10-30 새 사건 상세 입력 피드백은 로컬 수정·커밋으로 누적한다. 직접 입력 textarea는
회색 surface로 구분하고 이전 버튼의 높이·아이콘·글자 크기를 주 버튼과 맞추되 회색으로
위계를 낮춘다. 입력 중단 후 자동 저장 대기는 0.9초에서 3초로 늘리고 저장 성공 알림과
질문 준비 중 초록색 저장 완료 표시는 제거한다. 이동 시 저장·미저장 이탈 경고·실패 복구는
유지한다. 사용자 지시에 따라 전체 UI 회귀검사를 기본 반복하지 않고 변경한 핵심 동작만
필요할 때 확인한다. CI·push·PR·병합·배포는 다음 명시 지시까지 보류하며 다른 세션 조율은
필요하지 않다. 직전 배포 main은 `a72225f53e01f2db11e0d7526cfca409a1d6ce80`이다.

2026-10-29 최신 사용자 지시는 누적 UI/자료 반영 변경을 원격 PR로 제출하고 CI 후 병합하여
같은 SHA를 preview와 production에 순서대로 배포하는 것이다. 이번 누적 범위에 대한 검증·
push·PR·병합·양쪽 배포가 승인됐다. 기존 공개 서비스 모드와 데이터·환경 키를 유지한다.

2026-10-29 최신 작업 방식은 로컬 수정·커밋 누적이다. 사용자가 실행을 지시하기 전에는
새 변경의 CI·push·PR 생성/갱신을 하지 않는다. 지시 후 한 번에 CI를 수행하고 원격 PR로
올린다. 병합·배포도 명시 지시를 따른다. 이전의 변경별 CI/PR 지시보다 우선한다.
별도로 승인된 기존 DB 전환 PR #608의 병합·시딩 작업은 그 승인 범위로 구분한다.

2026-10-29 변호사 상세의 목록 복귀는 좌측에 붙는 회색 화살표/텍스트 링크로 표시하며
검색 조건을 보존한 기존 URL을 유지한다. 공개 프로필 라벨·소개 내 중복 분야·직접 연락
카드는 제거한다. 헤더 연락처 버튼은 전화/이메일의 실제 값과 안전한 tel/mailto 링크를
공통 Dialog에 표시한다. 기존 외부 상담 링크는 모달에서 유지하며 연락처 부재·닫기/Escape·
초점 복귀를 처리한다. 사무실/포트폴리오를 포함한 카드의 가로 여백과 모서리 반경을 복원하고
모바일 헤더의 연락 버튼 행도 맞춘다. 연락처 모달·복귀·모바일 여백 회귀 기대를 갱신하며
테스트·CI·push·PR·배포는 사용자 지시까지 보류한다.

2026-10-29 추가 대화 높이는 빈 대화 여부와 무관하게 헤더·탭 아래 남은 viewport로 맞춘다.
입력창까지 같은 높이 안에 배치하고 메시지 이력만 내부 스크롤한다. visualViewport의 높이·
이동과 CSS zoom을 반영하며 헤더/주변 콘텐츠와 화면 크기 변경 때 높이를 재계산한다.
작은 화면에서도 입력창 공간을 우선 확보하고 페이지의 자연스러운 스크롤 전파는 유지한다.
기존 답변 이후 데스크톱/모바일 입력·보내기의 viewport 회귀 기대를 추가하며 실행은 보류한다.

2026-10-29 리포트 탭은 사건 본문 전체 너비를 쓰며 왼쪽 장식선·단계 앵커·성공 가이드·
버전/생성 기준·stale 배너·하단 링크 그룹을 제거한다. 새 버전 만들기는 페이지 헤더 우측의
아웃라인 버튼으로 둔다. 중첩 편집 카드 없이 흰 본문을 직접 배치하고 본문 안에서 각 항목의
입력란을 열어 수정한다. 사실·주장·출처와 공식 출처는 검토 화면에서 생략하고 미확인 사항은
다른 항목과 같은 위계로 표시한다. 숨긴 출처/원본 블록은 편집 범위 밖에서 그대로 보존한다.
별도 미리보기·수동 저장·전달 확인 체크를 제거하며 수정 마치기/다운로드가 revision 검증 후
편집 내용을 저장한다. PDF는 저장 요청에서 반환한 정확한 리포트 ID로 다운로드하고, 저장
실패 시 예전 PDF로 대체하지 않는다. 새 초안 생성 전에도 저장 가능한 편집을 먼저 보존한다.
개인정보/자료 아코디언은 식별정보 가리기 체크와 두 줄 설명으로 단순화한다. 기존 사진 선택은
보존하고 자동 가림 저장 시 사진을 제외한다. 초기 기술 한도 복구·소유자/동의·충돌·저장된
PDF의 historical/stale 경계는 유지한다. 다운로드 버튼은 전체 너비이며 PDF 출력 엔진과 저장
원문은 변경하지 않는다. 다른 세션은 발표자료만 작성했고 제품 소스 변경이 없음을 확인했다.
새 인라인 편집/다운로드 회귀 코드는 추가하며 테스트·CI·push·PR·배포는 지시까지 보류한다.

2026-10-29 유사 판례 목록은 우측 장식·중복 안내·선택 전 비교/원문 패널·배지·원문 미리보기를
제거한다. 목록은 3행 그리드(모바일 1열)이며 메타정보 우측에 내용 보기 버튼을 둔다.
상세는 탭 안에서 목록을 대체해 표시하고 검색 결과로 돌아갈 때 기존 목록·스크롤·초점을
복원한다. 비교는 상세 상단에서 시작하며 현재 상세와 같은 판례의 결과만 표시한다.
진행 중 작업/완료 결과의 복원과 계정·동의 경계는 유지하고 비교로 발생한 workspace revision
증가만으로 상세를 지우지 않는다. 오래된 read proof로 다시 비교하지 않고 재검색으로 갱신한다.
검색은 본문 최신3건 직출력에서 사건명 우선 후보40건의 로컬 정렬→최대4건 원문 검증→
주제별 최대3건 표시로 바꾼다. 사건명 결과가 없을 때만 같은 공개 주제로 본문을 1회 검색한다.
확인 요약의 거래/관계/자료 패턴은 서버 내부 순위에만 사용하며 사건 원문·식별자·임의 검색어를
외부로 보내지 않는다. 다른 분쟁의 인용에만 등장한 주제와 무관한 절차 결정을 낮추고 검증된
본문으로 다시 정렬한다. 검색 순위를 유사도 백분율로 표시하지 않으며 실제 비교는 기존8개
지표·근거·독립 감사로 수행한다. 총12회/120초·출처 무결성·권한/revision·부분 실패 경계를
유지하며 새 모델/공급자를 추가하지 않는다. 회귀 코드는 갱신하고 실행·CI·원격 반영은 보류한다.

2026-10-29 자료 첨부 대화 실패의 보존된 기술 진단은 원문과 다른 material fact 인용
(`source_text_mismatch`)과 기존 인물 ID를 새 요약에 중복 복사한 발행 실패
(`summary_copy/duplicate_party_id`)를 확인했다. 고객 원문·암호문·키는 진단에 노출하지 않는다.
자료 인용은 공백·줄바꿈 차이만 실제 원문으로 맞추며 문장/숫자 차이는 기존 검증을 유지한
단 한 번의 교정과 독립 감사로 처리한다. 교정은 기존 공유 횟수 제한을 사용하며 외부 조회를
재실행하지 않는다. 관련 인물은 새 snapshot에서 기존 ID를 갱신하며 이전 snapshot은 보존한다.
자료 대화는 실제 읽힌 거래/송금 일시·플랫폼/은행·금액·상태를 먼저 요약하고 계좌는 확인되는
끝 네 자리만 표시한다. 사진·샘플 영상 추출에서도 읽히는 거래 필드를 우선하되 추론하지 않는다.
초기 관찰 window는 기존 192KiB 상한 내에서 32개로 늘리고 추가 읽기·제외·권한·revision·
coverage 제한을 유지한다. 갱신한 unknowns는 사실/인물과 함께 원자적으로 저장하며 일부만
읽힌 요약·읽기 전용 응답은 기존 unknowns를 덮어쓰지 않는다. 자료에 있는 필드를 되묻지 않고
남은 확인사항을 질문한다. 이미 처리된 파일에 새 추출 지침을 소급 적용했다고 간주하지 않는다.
회귀 검증 코드는 추가하며 CI·테스트 실행·push·PR·배포는 사용자 지시까지 보류한다.

사건 상세의 대화·자료·타임라인·다음 행동은 같은 요약 아코디언을 쓴다. 확인할 사실은
제거하고 현재 요약/아직 확인할 내용, 관련 인물/준비 현황을 2열·2행으로 배치한다.
요약 검토는 설명과 간격을 둔 왼쪽 아래 primary 버튼으로 제공한다. 자료 목록은 기존
가벼운 조회를 유지하고 아코디언을 열면 공통 요약 데이터를 읽는다.
타임라인·다음 행동의 수동 갱신은 최근 대화·처리된 자료를 기존 채팅 job으로 반영한다.
권한·동의·revision·중복 요청·AI200/일·출처/감사 검증을 유지한다. 기존 준비 항목도 제한된
읽기 맥락으로 공급하며 완료/수동 편집을 덮어쓰지 않고 동일 항목을 중복 추가하지 않는다.
이 변경의 CI/테스트 실행과 원격 반영은 사용자 후속 지시까지 보류한다.

타임라인은 기존 서버의 certainty·references·factIds·userEdited를 클라이언트에도 보존한다.
사용자 진술/자료 근거 있음/자료에서 확인을 구분하고 연결 자료의 파일명·쪽/시간 위치로
이동할 수 있게 한다. 확인 표시는 현재 처리 완료한 파일 revision이 일치하는 자료 참조와
서버의 observed 상태가 함께 있을 때만 사용한다. 공식 법률 출처만으로 사건 사실을
확인했다고 표시하지 않는다. 상충·불확실·수동 수정·변경/삭제된 자료는 별도 재확인
상태로 표시한다. DB schema나 서버의 사실 확인 상태를 임의로 바꾸지 않는다.

2026-10-29 최신 사용자 승인은 기존 DB를 보존하고 새 DB 두 개에 합성 변호사10개씩
구성한 뒤 연결을 전환하는 것이다. 전체 삭제는 실행되지 않았고 이전 삭제 workflow는
폐기한다. 새 DB만 migration·시딩·합계·합성 복호화 검증하며 기존 고객 payload는 읽지 않는다.
기존 환경 키·앱 릴리스·DB 외 바인딩은 유지하며 전환 실패 시 기존 연결로 되돌린다.

2026-10-29 배포 후 후속 UI는 새 draft PR에 누적하며 다시 명시적으로 지시하기 전에는
병합·배포하지 않는다. 첫 변경은 로그인 하단의 가입 이어가기 안내 문구 제거다.
같은 draft PR #604에 사건 질문의 자동 답변 저장과 이전 이동 UI 정리를 누적한다.
답변만 자동 저장하고 질문·요약 생성은 기존 명시적 다음 동작으로 수행한다. 재시도는
기존 제출·revision을 보존하며 최신 입력과 계정 변경·동의·충돌·한도 경계를 유지한다.
선택형 질문은 `직접 입력` 선택 시 텍스트 입력창을 열고 기존 자동 저장·재로드 복원을
적용한다. v2 선택지는 추천 답변으로 취급하며 같은 답변 wire에 1,000자 이내 직접 답변을
저장한다. 질문 ID·중복·완료·길이 검증과 암호화·소유자 경계는 유지하고 v1 계약은 변경하지 않는다.
질문·요약 생성 실패 패널은 `다시 시도`와 아웃라인 `나중에 이어하기`만 제공하며 상단에
24px 여백을 둔다. 나중에 이어가기는 미저장 답변이 있으면 저장 성공 후 `/app`으로 이동한다.
실패·재시도 자격과 기존 생성 검증은 유지하며 화면만으로 개별 실패 원인을 단정하지 않는다.
요약 확인 등 사건 정리 화면의 뒤로가기 아이콘을 본문 왼쪽에 맞추고, 사이드바의
중복 `내 사건` 라벨·빈 래퍼는 제거한다. 최근 사건 목록의 접근성 이름은 유지한다.
요약 확인 화면은 정리 입력란 중심으로 단순화한다. 사실별 편집·정보 공백 편집·확인
체크박스·이전 답변 수정 링크를 제거하고 정리 수정은 기존 저장 후 계속 흐름을 따른다.
명시적 확인과 서버 revision·소유자·동의 및 저장/확인 재시도 경계는 유지한다.
요약의 최종 확인 모달은 제목 아래 설명을 추가하고 구분선 없는 버튼 그룹을 우측 정렬한다.
빈 대화는 헤더·탭 아래 남은 viewport에 채팅·입력창을 맞추고 대화가 생기면 기존 화면
한 높이의 채팅을 유지한다. 비활성 보내기 버튼은 회색 배경으로 표시한다.
사건 상세 헤더의 새 사건 입력 뒤로가기를 제거하고 레일탭 항목은 내용 너비로 배치한다.
설정의 계정 삭제 버튼은 섹션 맨 우측에 배치한다.
대화 메시지·입력창은 사건 본문 전체 너비를 쓰고 내부 스크롤 끝에서는 페이지 아래로
스크롤을 전파한다. 메시지 중간에서의 내부 스크롤과 기존 답변 자동 추적은 유지한다.
대화에서는 외부 조회 내역·운영 경고·추가 대화 진술 라벨을 노출하지 않는다. 개별 조회가
실패하면 확인된 사실·자료로 이어가며 조회 성공이나 법률 근거를 지어내지 않는다.
조회 결과·진단의 내부 기록과 출처 검증·감사는 유지하고 관련 판례 CTA도 아웃라인으로 맞춘다.
채팅 입력은 첨부 아이콘·고정 높이 입력란·보내기를 한 줄에 배치하고 글자 수 표시는 제거한다.
입력은 Unicode 문자 기준 10,000자로 제한하며 조합 입력은 완료 시 제한을 적용한다.

2026-10-29 추가 사용자 지시로 누적 PR #601을 병합하고 preview에만 배포한다.
전체 검증의 제목 wire/Unicode 기대 및 세션 갱신에 흔들리던 조회 계수 검사는
후속 릴리스 수정으로 보완한다. 엄격 wire는 제목을 필수 nullable로 표현하고,
판례 제목은 기존 소유자 scope의 암호문을 재사용해 추가 metadata 조회를 없앤다.
nullable 제목이 없을 때 감사 입력에서는 생략해 기존 요약 replay 형태를 보존한다.
production은 변경하지 않으며 이후 별도 UI 수정은 다시 명시적 병합·배포 지시를 기다린다.

2026-10-29 사용자 최신 지시는 후속 UI를 #600 / `codex/600-ui-feedback-followups`의
동일 draft PR에 누적하는 것이다. 사용자가 명시적으로 병합·배포하라고 하기 전에는
병합하거나 배포하지 않는다. 이전 변경별 즉시 배포 지시보다 이 지시가 우선한다.
첫 수정은 개인정보와 이용 설정/선택 지표 UI 제거와 기존 allowlist 이벤트의 기본
탭 로컬 기록이다. 외부 전송·원문·계정 식별자 수집을 추가하지 않으며 필요한 검증만 한다.
추가 사건 헤더 수정은 상세 삭제 메뉴를 제거하고 개인·기업 라벨을 제목 위로 옮긴다.
기존 요약 생성·감사에 짧은 제목을 포함하고 암호화 intake metadata에 함께 발행한다.
기존 strict summary wire와 DB 컬럼은 유지하며 기존 사건은 재처리 없이 간결한 대체 제목을 쓴다.
자료 탭 추가 정정은 빈 업로드 영역의 세로 여백 확대·중복 파일 종류 라벨 제거와
사건 요약/준비 현황의 공통 아코디언 적용이다. 파일 목록의 작은 추가 바는 유지한다.
설정 섹션 제목·설명 간격을 줄이고 아이콘을 확대한다. 계정 삭제는 최신 사용자 지시에
따라 아이콘·제목·단일 버튼을 가로 중앙 정렬하며 연결 SSO 재인증 모달은 유지한다.
대화 탭은 헤더 높이를 차감하지 않고 메시지·입력창에 화면 한 높이를 배정한다.
페이지를 내려 입력창에 도달할 수 있고 메시지 내부 스크롤은 유지한다. 대화·자료 안내 UI는 제거한다.
로그인 페이지는 서버에서 유효한 비삭제 계정 세션을 확인하면 `/app`으로 이동시킨다.
미인증·만료·위조·삭제 계정은 로그인 화면을 유지하고 `/app`의 동의·역할 검사는 보존한다.

2026-10-29 삭제 UI 정정 #598은 계정 삭제를 세로 단일 진입 버튼과 연결 SSO 재인증 모달로
정리한다. 사건 삭제의 문자 입력·사건 제목을 제거하고 삭제→취소를 우측 정렬한다.
동일 계정·최근 OAuth·명시적 삭제 및 서버 계약을 보존하며 필요한 인증/삭제 검사와
필수 CI 후 병합·preview에만 배포한다.

2026-10-29 자료 UI 정정 #596은 사건 탭·본문을 헤더 너비에 맞추고 자료 필터·중복 설명·
추가 동의 체크박스를 제거한다. 빈 상태의 업로드 CTA는 파일이 있으면 가로 추가 바로
줄이며, 계정 동의·권한·전송/재시도 계약을 보존한다. 관련 UI·실패 검사와 필수 CI 후
병합·preview에만 배포하고 전체 검증은 반복하지 않는다.

2026-10-29 검색 UI 정정 #594는 목록·프로필의 preview 환경 안내를 제거하고 검색 버튼과
입력·선택 필드 높이를 일치시킨다. desktop/mobile 관련 화면 검사와 필수 CI만 확인한 뒤
병합·preview에만 배포하며 검색 API와 production 배포 상태는 유지한다.

2026-10-29 사건 입력 UI 정정 #592는 웹 입력의 최소 길이를 10자로 바꾸고 툴바 우측에
`10자 이상 입력해주세요`를 표시한다. 개인정보·글자 수 안내가 있던 하단 줄 전체를
제거하며, 기존 저장 사례/API 계약과 개인·기업 선택은 유지한다. 관련 입력 UI 검사와
필수 CI만 확인한 뒤 병합·preview에만 배포한다.

2026-10-29 settings 앵커 제거 #590은 상단 섹션 바로가기 nav와 전용 CSS만 제거한다.
본문의 사용량·도움말/정책·계정 기능과 제목 aria 참조는 보존한다. 관련 UI 검사와
필수 CI만 확인하고 병합·preview에만 배포한다.

2026-10-29 사이드바 사건 아이템 수정 #588은 제목의 고정 우측 여백을 제거하고
삭제 버튼을 행 중앙의 오버레이로 배치한다. hover/focus 및 터치 접근을 보존하며
관련 브라우저 검사와 필수 CI만 거쳐 병합·preview에만 배포한다.

2026-10-29 settings 아코디언 수정 #586은 `.settings-usage-guide`에 남아 있던 flex
행 배치를 block으로 바꿔 제목 아래에 본문·도움말을 배치한다. desktop/mobile 열기·닫기
브라우저1개와 필수 CI만 확인한 뒤 병합·preview에만 배포한다.

2026-10-29 추가 정정 #584는 채팅 패널을 대화·입력창까지만 viewport에 맞추고
요약·안내·이용 설정을 그 아래 문서 흐름으로 옮긴다. 기존 #581의 화면 전체 높이
고정보다 우선한다. 사용자 최신 지시에 따라 관련 브라우저 검사와 필수 CI만 수행하고
전체 검증을 반복하지 않으며, 병합 후 preview만 배포한다.

2026-10-29 사건 디테일 채팅 스크롤 요청 #581은 `codex/581-chat-scroll`에서
메시지 영역만 내부 스크롤하고 탭·입력창을 viewport 안에 유지한다.
[구현·검증 범위](../quality/CHAT-SCROLL-2026-10-29.md)를 따르며 별도 세션 PR580의
파일 소유권을 유지한다. 이전 파일 receipt 교정 reader 누락도 함께 정정한다.
검증 후 병합·preview에만 배포하며 production은 유지한다.

2026-10-29 추가 파일 전송 지연 요청 #577은 `codex/577-file-transfer-performance`에서
원본 업로드의 첫 조각 반복 읽기와 다운로드 중복 조회·헤더 복호화를 줄인다.
[측정과 호환 범위](../quality/FILE-TRANSFER-PERFORMANCE-2026-10-29.md)를 따르며
별도 운영 세션과 범위를 공유했다. PR 검증 후 병합·preview 전용 배포하며 production은 변경하지 않는다.

2026-10-29 사용자 UI/UX 피드백 #574는 `codex/574-ui-feedback`의 별도 worktree에서
사이드바 사건 조회·모바일 웹 rail/로그인·사실 Q/A·판례 근거 강조와 개인/기업 맥락을 정비한다.
[동작과 검증 경계](../quality/UI-FEEDBACK-2026-10-29.md)를 따르며 기존 #569 배포 세션과
범위를 조율한다. 추가 요청의 웹/HTML/PDF 리포트 디자인도 포함하며 최종 검증 후 병합·preview 전용 배포를 따른다. 랜딩·공급자·비용 정책·실제 외부 인수 기록은 유지한다.


2026-10-28 법률 조회 안정화 #569는 `codex/569-legal-reliability`에서 개별 원문 실패 격리·
제한 재시도·원인 표시·구버전 응답 호환·만료 조회권 복구를 정비한다.
[수정·검증 계약](../quality/LEGAL-API-RELIABILITY-2026-10-28.md)과 정확한 SHA별 실제 결과를 따른다.
공식 안내 개정 대기를 정상 인용으로 바꾸지 않으며 랜딩·비용 정책·보안/legacy 기록을 유지한다.

2026-10-27 운영 리뷰 후속 #558은 [수정·검증 범위](../quality/PRODUCTION-REVIEW-FIXES-2026-10-27.md)와 #558/#71의 정확한 SHA별 실제 검증 기록으로 추적한다. 랜딩 보존과 외부 API·스토어 보류, 보안·legacy unknown 이력은 유지한다.

## 2026-10-27 로컬 잔여 작업 인계

> 최신 사용자 지시: API/tool calling은 키 준비 전 보류, 스토어는 현재 범위에서 제외하고
> 남은 이슈를 모두 범위 종료로 정리한다. [정비 종료·미해결 조건 인계](../quality/MAINTENANCE-HANDOFF-2026-10-27.md)가
> 아래 과거 OPEN/진행 중 표현보다 우선한다. 보안 high2와 실제 legacy unknown은
> 해결로 꾸미지 않으며 보안/릴리스 검사·원장·기존 공개 운영 조건을 유지한다.
> 등기정보광장 통계 연동 제외는 자동 등기조회 목적 전체의 제외가 아니다. DataHub
> 등기 PDF와 주소 식별자 연결은 미구현/보류로 남긴다. 현재 정리에는 제품 변경이 없다.

사용자 직접 지시에 따라 네이티브 앱 개발은 완료한 범위로 보존한다. 이전 잔여 작업을
마무리한 뒤, 별도 목표로 웹 UI/UX의 위계·강약·상태·일관성·여백과 모바일 반응형을
개선한다. 랜딩페이지의 코드·자산·스타일은 변경하지 않는다. 아래 모바일 진행 표는
당시 source/검증 이력이며 새 앱 개발 착수 지시로 사용하지 않는다.

- #555 `codex/555-registry-scope`: 사용자 후속 지시에 따라 등기정보광장은 현재 MVP의
  필수 용도가 없어 신규 연동·발급·인수 대기에서 제외한다. 신규 capability 목록에서
  registry placeholder를 빼고 과거 ID/저장 결과·읽기와 비실행 처리는 호환 보존한다.
  국세청·더치트·DataHub는 미발급/실제 검증 대기다. 등기정보광장 제외를 실제 조회
  구현 완료나 남은 다른 공급자의 인수 성공으로 표현하지 않는다.

- #339: 공식 registry/advisory 재확인에서 node-forge1.4.0의 patched version이 없고,
  Expo CLI58.1.15도 Zod3.25.76을 요구한다. 기존 보완을 유지하며 `codex/339-constrained-zod-backport`에서
  CLI Zod3의 명시적 array/set 상한 조기 거절을 source/CJS/ESM에 이식했다. 원본 전체 tree·
  정상/실패·실제 CLI·양 OS local export/quick을 검증했다. 새 조건에서 raw audit는 여전히
  high2다. [범위/한계](../quality/CLI-ZOD-BACKPORT-2026-10-27.md)와 보안 gate를 유지한다.
  PR544 exactb880b0e CI40377051321 SUCCESS → mainbfaf63e·main CI40380560616 SUCCESS로 통합했다.
  #545의 `codex/545-forge-browser`에서 기존 CJS와 같은 RSA 검사를 두 원본 UMD에 확장했다.
  [원본 역복원·VM 회귀 범위](../quality/FORGE-BROWSER-BACKPORT-2026-10-27.md)는 통과했고
  raw high2·공식 release/SDK·#71 잔여는 보존한다.
  PR546 exactffa1434 CI40382480636 SUCCESS → main15ea94a·main CI40384257481 SUCCESS로 통합했다.
- #506: [status40358338441](https://github.com/creno-va/baro/actions/runs/40358338441)의
  exact76b1dfb finite receipt는 failed/MODEL_UNAVAILABLE·attempt2·minimize unknown1이다.
  모델/fixture 생성 없이 조회했으며 genuine terminal receipt 전 세번째 호출을 보내지 않는다.
  #547 `codex/547-legacy-retry-state`는 원래 실행이 차단되는 동안 GET에 재시도 가능이
  표시되던 불일치를 고쳤다. [합성 재시도 상태 검증](../quality/LEGACY-RETRY-READINESS-2026-10-27.md)의
  SQLite/Hono62·실제 브라우저16·DB·quick이 성공했다. transport가 미확정이면 read-only
  상태 확인만 제공하며, 실제 #506 receipt/시도/원장은 보존한다.
  PR548 exacta7af708 CI40386176126 SUCCESS → main483b45f·main CI40386905503 SUCCESS로 통합했다.
- #539/PR542: exact8652167 CI40368233948 SUCCESS → main249b957 정상 통합.
  #458/PR543 exact6804460 CI40373654054 SUCCESS → mainebdff2f·main CI40374305109 SUCCESS.
  0018 private 대상·전송 동의·durable permit과 runtime/UI 연결, 로컬 quick/build·집중71 및
  Workspace 브라우저81개 성공으로 사용자 합의 개발 범위를 완료했다. 키는 비워두고
  not_configured·발급 후 검증 목록과 [구현/검증 범위](../quality/LOOKUP-ADMISSION-2026-10-27.md)를
  보존한다. 실제 외부 인수/배포·#506/#339/#71 완료로 확대하지 않는다.
- 사용자 후속 지시로 미발급 API 설정/실제 인수는 이번 완료 범위에서 제외하고 비워둔다.
  관련 이슈는 미래 검증 항목을 보존한 뒤 정리할 수 있다. 실제 성공·API 발급을 꾸미지 않는다.
  Windows 검사 호환 #540은 PR541/mainf67d2af와 정확 head CI 성공으로 완료했다.
- #549 `codex/549-app-hierarchy`: 로컬 구현 가능한 앞선 잔여 수정의 통합 뒤, 외부 보안/실제
  transport gate를 완료로 꾸미지 않고 독립적인 웹 표시 정비를 진행한다. 모바일 사건 메뉴
  6개·입력 버튼·반복 안내·본문 진입 효과를 정리했다. [합성 검증/랜딩 보존](../quality/APP-HIERARCHY-2026-10-27.md)의
  Workspace86·통합3·작은/큰 화면 검사가 통과했고, 랜딩3폭의 배치/스타일과 PNG가 동일하다.
  full40386960386/exactmain483b45f는 전체Bun4381·DB·eval·build 뒤 모바일 보내기 아래856px로
  실패했다. 새 후보의 같은 단언과 제품 UI12개가 통과했고 메뉴2행/6개 전체 노출도 검사했다.
  이 full의 후속 브라우저/CSP/audit/Gitleaks/native와 실제 배포 인수는 성공으로 기록하지 않는다.
- #551 `codex/551-secret-scan`: full의 scanner 단계가 설치만 하던 공백을 실제 조기 실행으로
  보완한다. 별도 전체 이력 스캔의 공개 checksum/commit·SRI 검증 vendor 구문20탐지/8개
  정확한 역사 fingerprint만 분류했다. [근거/검증](../quality/SECRET-SCAN-2026-10-27.md)의
  이력0·새 commit canary 탐지·workflow11이 통과했다. raw high2와 실제 릴리스 조건은 유지한다.
- #553 `codex/553-ios-architecture-ci`: API 키 없이 진행 가능한 CI 검증을 보완한다.
  PR538의 두 iOS 아키텍처 동시 compile40분 취소를 각각 같은40분 matrix로 분리하고
  실제 binary architecture/platform과 source receipt를 확인한다. Android·기본 universal/
  runtime 빌드와 native 앱 제품은 보존한다. 기존 파일 처리 native Docker profile도 exact
  main 수동 workflow로 독립 실행하며 full/실제 provider/배포 성공으로 확대하지 않는다.
  [관측·합성 검증 경계](../quality/API-FREE-NATIVE-VALIDATION-2026-10-27.md)를 따르고
  실제 CI 성공 뒤에만 병합한다.


- Reviewed: 2026-10-15 KST
- 정비 총괄: hyunhomon / 현재 정비 채팅. 기존 모듈 소유권은 유지한다.
- 결정: [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), 제품: [PRD](../PRD.md), 상세: [v2 실행 계약](../architecture/V2-CONTRACTS.md).

## 현재 범위와 작업 순서

현재 공개 서비스를 유지하고 신규 기능 확장을 멈춘다. 고객/변호사 두 역할, 질문 최대
2차례×3문항, KST AI 하루200회, 프리베타 비용 관측 전용과 기존 결제·자동충전을
유지한다. 정책 초안과 사업자 플레이스홀더는 #20/#70의 초안 인수 범위다. 실제 법률 승인이나
독립 외부 검증 완료를 의미하지 않는다. 정비 종료와 전체 MVP 인수 종료는 별도로 판정한다.
비용의 금액·가격/FX/funding 누락/만료·월할당·수동 refresh·유지비·비용 예약 IO로 기능이나
배포를 막지 않는다. 새 직접 사용자 지시 전 재도입 금지이며, [현행 정책과 적용 상태](../operations/PREBETA-COST-POLICY.md)를 따른다.

2026-10-22 직접 요청으로 RN + Expo 모바일 개발을 별도 범위로 추가했다.
[공통 코드 구조](../architecture/MOBILE-CLIENT.md), [실행 계획](./MOBILE-EXECUTION.md),
[ADR-0017](../adr/0017-expo-mobile-and-shared-client-boundaries.md)을 PR329로 통합한 뒤
M1 앱 기반·공통 계약 공유를 #330에서 인수했다. 후속 사용자 지시로 모바일 네이티브 앱
전체 완성을 #334의 지속 목표로 삼고 M2 공통 client #335부터 진행한다. 웹 UI 전면 개편은
다른 채팅의 기존 소유권을 유지하며 인증·전체 기존 기능·UI·기기·릴리스 인수를 끝까지 추적한다.

1. README·이슈 명세를 읽고 bun run work:next로 GitHub 선행 구현·열린 PR·작업자를 확인한다.
2. 선행 구현 PR의 검토·필수 CI·main 병합 후 제품 코드를 시작한다. 실제 외부 인수로 열린
   이슈의 CLOSED를 개발 선행으로 요구하지 않는다. 독립 계약·fixture는 명시 범위에서 준비한다.
3. 이슈에 담당·브랜치·현재 blocker·다음 행동을 기록하고 status:in-progress를 붙인다.
   기존 작업/PR을 재사용하고 깨끗한 main에서 codex/<issue>-<purpose> 브랜치를 만든다.
4. 공유 계약·schema는 먼저 조율한다. migration 최신 번호를 확인해 한 담당자가 순차 배정한다.
   0010은 보존하며 PR247은0015, PR259는 기술 admission·선택적 비용 관측0016을 추가했다. 실제 원격 schema와 적용 SHA는 #71 배포 receipt를 따른다.
5. 변경별 검증 후 PR로 제출하고 검토·CI가 통과한 정확한 head만 정상 병합한다.

## 담당·blocker·다음 행동

| 작업 | 담당/이슈 | 현재 상태·blocker | 다음 행동 |
| --- | --- | --- | --- |
| 모바일 M7 새 UI 원본과 Android 검증 | 모바일 담당 / #334·#379 | PR496/c8215b8 줄바꿈 UI·양 OS compiler SUCCESS, PR501/main331bedf·CI40110158332 Android pin, PR502/main1906321·CI40110871760 iOS pin 통합. Android40110473196 cold2/Metro0·font2/Guide 왕복,40110948812 ASCII/software Search·회전 SUCCESS. 실제 PNG에서 어절 내부 분리 잔여 | iOS40111075770 cold2/Metro0·최대 글자/Guide 왕복·4viewport×7종 audit issue0 SUCCESS.40111078106은 layout 후보0으로 실패·제품 입력 미도달. 제품 없는 Settings 참고40114158334 SUCCESS: 별도 키보드 추가 선택지 관측. 7ec의 한글40116874262는 분리owner로 실패, prompt 포함 list로 조회 제한 준비. iPad40116876605 실제 최대글자/Guide·회전/audit SUCCESS. PR512/main784d60d·CI40121698615 뒤 수정 Android IME참고40122015296 SUCCESS: default Gboard144·등록 Korean0/동적지원미확인. source92f Android원본40120704046·전체byte/HBC/font/Apple3PNG 대조 통과, iOS원본40120706028도 SUCCESS: 전체byte/HBC/font/Apple3PNG·실제 ad-hoc/양architecture XML/DER control 대조, 새pin 준비. iOS setup-only40120708133 목록readback/cleanup SUCCESS, 제품입력false. Android실제40123131797은 SDK재검증 통과 뒤 Launcher오류dialog로 Home/입력 미도달; 원인미확정/동일조건반복안함. main2327b2a·CI40124094412 뒤 iOS Korean40124377850은 Settings readback 후 Next-keyboard제어실패/자모0, Gboard40124380021은 default형식거절/Settings미도달, source4e AOSP40127019803은 image/API·Launcher3×3·Home2 통과 뒤 Search후보0 실패. Gboard40127021886은 등록ready 뒤 Settings scope거절; 원인미확정. iOS전환제어 system영역/uniqueowner 보완 준비. [원본과 범위](./MOBILE-INTERNAL-PREVIEW.md). 한글 IME·reader·실제 계정/전체 private·physical/store·#339/#71 OPEN, 웹/API/DB 변경 없음 |
| Gemini AI 장애·도구·자료 하네스 | AI / #458·#506·#524 | PR521 native LOW 생성/MEDIUM 감사·intake 전용 prompt, PR525/527 채팅 순차 표시·스크롤 보호, PR529/532 유사 판례 8지표/접수 응답 경합, PR533 인용 숫자좌표 유일일치 보정·원문 공백 보존·사용자 근거 제한 정상병합. main1c098 exactCI40140469487 SUCCESS. 실제 비교40140675828: 같은 공식원문/생성11.8초+감사8.6초,2호출/인용3좌표 보정/8지표 중 비교가능3·일치0·불가5→0%, 첫실패40139011354 원본·횟수 보존 | codex/524-precedent-live-result: 원본 성공 receipt·[비교 범위](../quality/PRECEDENT-COMPARISON-2026-10-25.md)/실행 기록 통합. 로컬 quick602·단위4357·집중166 및 quote/타입51, build/실제 workerd·독립 probe bundle SUCCESS. preview e02/40138523599 schema0017·9route·blocker0 성공이나 근거 후속 이전이며, UX534 포함 최종 SHA의 exactCI/full/제한 preview는 별도. [AI 기록](../quality/AI-HARNESS-REPAIR-2026-10-24.md). 4 API미발급/대상·수신자 동의 producer, retained legacy attempt2 unknown/세번째호출 금지, raw 보안 high2·전체 #71·production 미변경 보존 |
| 모바일 v2 인증 공통 소비 | 모바일/인증 담당 / #346 | PR473 main1731e29·PR477 main33dd244 각 main CI SUCCESS. codex/346-native-provider-v2에서 capability 확인 선행·계약 버전 pending/cold 검증·SDK jar capture 전 guard·독립 삭제 proof journal/복구 factory 구현 | frozen/quick(공통480·RN90·server243)·unit4032/171569·build/workerd·양 OS Metro 통과. exact PR/main CI 뒤 통합. 새 삭제 포트의 SecureStore·owner별 정리·반환/공식 Apple 버튼 조립 후 노출하며 현재 UI는 기존3사. 회원 계정 보유 확인과 실제 키/callback·기기/보안/출시 인수는 별도. [범위](./MOBILE-APPLE-LOGIN-DECISION.md) |
| source6201112 iOS 실제 입력 성공 | 모바일 담당 / #379/#334 | PR457 main062bdcd CI40066418174 뒤 실제40066597399 SUCCESS. product6201112·원본 ZIP/receipt/control·actual iPhone16/iOS26.5·literal/실제 Search button/회전·Home PNG·테스트 소스/provenance 독립 대조 | codex/379-ios-source-input-result에서 원본 JSON과 이전 typed-check 실패를 함께 보존. 이번 조건의 성공이며 원인 확정/반복 안정성·한국어/VoiceOver·계정/전체 화면/physical/store·보안 high2/전체 gate는 별도 |
| 새 Android 원본 실제 입력 | 모바일/보안 담당 / #379/#339 | PR455 main171545a CI40065472934 뒤 실제40065665374 SUCCESS. source6201112 원본 APK/receipt·fresh SDK cert·Launcher3/Home2·실제 software Search·literal/회전/BACK1·원본 proof/PNG/provenance 독립 대조 | codex/379-native-source-results에서 원본 JSON/범위 보존. iOS40063716187 성공 원본 pin을 PR457로 통합. 보안 high2·한국어/reader·계정/전체 화면·physical/store·전체 gate는 별도 |
| CLI Zod3 잔여 관측 | 보안/모바일 담당 / #339 | codex/339-cli-zod-observation에서 actual CLI validator·작은 library 반례/고정 JSON·Node child privacy 검사를 보존. [관측 범위](../quality/CLI-ZOD-OBSERVATION-2026-10-24.md): 출력 issue 수 증가, library max1 반례의3/4 차이, local 두 OS graph의 Zod3 source0·CLI loader1 | 큰 입력/OOM·전체 도달성/안전 증명이 아님. 원본 compiler와 HBC byte 대조 전 localExportOnly 유지. raw audit high2·전체 #339/#71 인수 보존. 제품/패키지/pin 미변경으로 source6201112 후속 검증의 parity 유지 |
| 10/24 공유 의존성 보안 수정 | 보안/모바일 담당 / #339 | PR454/main cfaed19 CI40063084067 SUCCESS. Zod4.6.6·fast-uri3.1.9·undici7.30.1/8.12.2 업데이트. 실제 Bun1.4.0의 version-scoped override·각 consumer major resolve 확인. [원본 audit와 범위](../quality/DEPENDENCY-SECURITY-2026-10-24.md): raw node-forge/Expo CLI Zod3 high 잔여 보존 | frozen/quick·unit/build·두 OS Metro·실제 consumer 회귀 뒤 exact PR/main CI 통합. native PR453에 producer merge 통합·quick119/build/두 OS Metro 통과. raw audit/전체 #339/#71·기기/계정/store 완료로 표시하지 않음 |
| iOS native 입력 비교 보완 | 모바일 담당 / #379 | PR452/main ddd7fe5 CI40061119740 SUCCESS. UIKit40061251226 SUCCESS: 고정 input의 native/AX signature 일치·change26·원본/provenance/source hash 대조. codex/379-ios-native-input-backport에서 미병합 RN59197의 native3파일 후보·version/SRI/LICENSE/전체 tree·정확 release hunk·source build/양 architecture compile 관측 준비 | frozen/quick/두 OS Metro/build·native patch 역적용 회귀 후 exact CI/main. 새 compiler/pin 뒤 literal/소프트 Search·회전 actual 확인. UIKit/설치 byte만으로 원인·수정 성공 확정 없음. 기존 실패·전체 gate 보존 |
| iOS 별도 UIKit 입력 진단 | 모바일 담당 / #379 | PR451/main64829ed CI40060285018 SUCCESS. codex/379-ios-input-reference에서 소유 Simulator의 별도 UIKit UITextField+native/AX signature 비교 도구 준비. 기존 고정 input/typeText1·wait10초·설정/속도/paste 변경 없음. 제품 원본/공개 탐색 변경 없음 | 로컬 schema/privacy·Swift syntax·Ruby project wiring/quick 확인 뒤 exact CI/main 통합, reference 모드만 한 번 실행. observation 성공을 제품 입력/근본 원인 확정으로 표시하지 않으며 기존 iOS actual 실패·전체 gate 유지 |
| 두 OS native 검색 새 원본 결과 | 모바일 담당 / #379 | PR450/main19c104c CI40058970087 SUCCESS. product4ba1d39의 Android40059250272 SUCCESS: Launcher baseline3·Home2·actual software Search·literal 입력/회전/복귀. iOS40059252212 FAILURE: typed-check/other·짧은 subsequence·날짜 suffix 유지, 소프트 Search 미도달. 원본 binary/receipt·Home PNG·metadata/provenance 독립 대조 | codex/379-native-directory-results에서 성공/실패를 분리 보존. native draft만으로 iOS 누락을 해결하지 못함. 다음은 별도 UIKit reference 입력으로 앱/RN과 XCTest/Simulator 경로를 분리 관측하며 실제 원인 확정·같은 조건 재시도 없음. 한국어/reader·계정/API·physical/store·전체 인수 유지 |
| Android native 명령 실패 분리 | 모바일 담당 / #379 | PR448/main139fd49 actual40055905132의 cold-launch-1/Pixel Launcher ANR 원본 보존. codex/379-android-launcher-baseline에서 default HOME·전후 foreground/root 연속3·오류 dialog 부재 관측과 새4ba1d39 두 OS 성공 compiler 원본 pin 준비. 최대10 sample·첫 Home120초 wait 공유, 합성21개/도구 타입 통과 | exact PR/main CI 뒤 새 원본의 SDK/Launcher/실제 입력 관측. Dialog dismiss·Launcher 전환/종료·HOME/Wait 탭 없음. 이후 Home에서도 aerr dialog는 명시 실패. 원인/전체 Android 인수는 미확정. iOS도 새 원본의 actual 입력/소프트 Search·회전 별도 확인 |
| iOS native 입력 누락 후속 | 모바일 담당 / #379 | PR449/main4ba1d39 CI40056748012 SUCCESS. native draft 구현·RN/두 OS export/build/quick 통과. compiler Android40056943689·iOS40056945553 모두 SUCCESS, 원본 full bytes·실제 metadata/font/HBC·iOS strict signature/XML/DER 대조 | 새 원본 pin/exact main CI 뒤 동일 literal actual 검증. b3eea74 actual40054497761 실패·목록 렌더 분리 불충분·근본 원인 미확정 보존. native 값/조합은 RN props 검사로 인수하지 않음. Android40055905132 환경 실패와 전체 gate 유지 |
| 새 검색 앱 원본 인수 | 모바일 담당 / #379 | sourceb3eea74의 Android40051994117·iOS Simulator40051996500·unsigned iPhone SDK40052099884 모두 SUCCESS. 원본 byte/HBC/font·SDK·Simulator signature/XML/DER 대조. PR446/mainae6aecc CI40053476538 SUCCESS. Android actual40053634921 FAILURE: SDK/signature·Home 확인 후 directory-input-ready/COMMAND_FAILED, 입력/소프트 Search 미도달 | codex/379-ios-directory-compiled-input에서 iOS 성공 원본 pin 통합·정상 PR/main CI 후 실제 입력/소프트 Search·회전 검증. Android 원본 실패/SDK metadata/Home 대조를 보존하고 native 명령의 고정 category/exit/timeout 진단을 보강한 뒤 변경 조건을 검증. 정확 원인 추정/같은 조건 반복 없음·전체 gate 유지 |
| Apple signature CI 환경 | 모바일 담당 / #379 | c401986 CI40047097734 실패/exit143·45초 기록 보존. #443/main45bc32f CI40048165288 SUCCESS. actual iOS40048447226의 [required Apple Foundation step](../quality/mobile-internal-ios-2026-10-24/apple-signature-step-45bc32f.json) 01:09:38→01:09:52 SUCCESS | Linux quick95pass1skip와 실제 macOS required 성공을 구분해 좁게 인수. native 입력/전체 workflow와 별도이며 이전 입력 불일치/전체 gate 유지 |
| Android 공개 탐색 입력/회전 | 모바일 담당 / #379 | PR443/main45bc32f의40048447253 SUCCESS 원본은171989e/hardware Enter 범위로 보존. PR444/mainb3eea74 CI40051831098 뒤 새 compiler40051994117·iOS40051996500·device SDK40052099884 진행 | codex/379-android-software-search에서 current IME·default display의 유일 input window·Search node/bounds/가시 영역을 결합한 직접 탭 준비. hardware fallback 없이 별도 kind로 인수하며 새 compiler/pin/actual 확인 필요. 한국어·전체 화면/역할·reader·HTTP transport·physical/store·전체 #334/#379 유지 |
| iOS 공개 탐색 입력/회전 | 모바일 담당 / #379 | main45bc32f의40048447226 SUCCESS 원본 보존. 동일 조건 추가 확인40049505301 FAILURE: [입력 누락 형태 signature](../quality/mobile-internal-ios-2026-10-24/directory-consistency-failure-45bc32f.json), typed-check/other·짧은 subsequence·날짜 suffix 유지/정규화 불일치. 원본171989e ZIP/receipt·Home/metadata hash 대조 | codex/379-directory-device-results에서 입력 draft를 목록/filter 렌더에서 분리하고 native submit text 사용. 원인 확정/수정 성공 주장이 아니며 새 두 OS compiler·pin 갱신 뒤 실제 검증 필요. 소프트 Search 직접 탭 관측도 준비하며 기존 newline 성공과 구분. 같은 조건 실패 반복 금지·전체 #334/#379 gate 유지 |
| Android 실제 인증 취소 | 모바일 담당 / #346 | actual40038397811 attempt2/source318df0c SUCCESS. [원본 proof](../quality/mobile-internal-android-2026-10-23/auth-cancel-ui-318df0c.json)·Home/metadata/원본 APK hash 대조. Google/Naver/Kakao Custom Tab·BACK1·익명 복귀/cold·Chrome124/userdebug 단일 switch readback/삭제 확인. SDK ZIP 실패 attempt1 보존 | 자동화 fixture/브라우저 취소 범위만 인수. 실제 계정/동의·callback·SecureStore pending 직접 계측·물리 기기·현재 consumer browser/store는 별도. Android 구현/설정 불변이면 같은 source 원본을 보존하며 불필요한 반복을 하지 않음 |
| iOS 실기기 SDK 사전 검사 | 모바일 담당 / #334 | PR434/main87dec15·CI40032179484 뒤 actual40032490751 SUCCESS. [원본 receipt](../quality/mobile-ios-device-sdk-2026-10-24/receipt-87dec15.json)·13,808,079bytes ZIP·실제 plist/Mach-O iOS·SDK26.5/min16.4/arm64/서명없음·HBC/font·키/profile/map 부재 독립 대조 | 실기기 SDK compile의 좁은 인수. unprovisioned ZIP이며 설치/실기기/스토어 성공이 아님. 기기·계정 확인 대기와 전체 gate 유지 |
| iOS 닫기 범위 실제 재검증 | 모바일 담당 / #346 | PR439/main97c2144·CI40040850507 뒤 actual40041077753 SUCCESS. [원본 proof](../quality/mobile-internal-ios-2026-10-23/auth-cancel-ui-97c2144.json)·Home/metadata·원본 ZIP/receipt·runner hash 독립 대조. Google/Naver/Kakao WebView 각각3/2/2개 전부 query·descendant Cancel0/keyboard0·유일 새 Cancel tap·WebView 소멸/익명 복귀·최종 cold 익명 확인 | 자동화 Simulator 브라우저 취소 범위만 인수. frame 제외는 false로 보존하며 논리 descendant 제외와 구분. 이전5회 실패 보존. 실제 계정/동의·callback·SecureStore pending 직접 계측·물리 기기/store 및 전체 #334/#346/#339/#71은 별도 |
| 모바일 Apple 로그인 결정 | 모바일/인증 담당 / #346 | 2026-10-24 사용자 **Apple 로그인 추가 승인 (권장)** 응답. 기존3사·계정/이전 앱 호환 유지, token 장기 보관·공개 출시 제외 | 계약·서버 삭제/철회 선행→실제 설정과 모바일 소비·기기 검증. developer 계정·키 준비를 가정하지 않음. 기존 취소 실패40025525181/40029347550·전체 #334/#346/#339/#71 유지 |
| iOS 실제 인증 취소 | 모바일 담당 / #346 | PR431/main8480fa6·CI40025168869 뒤 actual40025525181 FAILURE. [원본](../quality/mobile-internal-ios-2026-10-23/auth-cancel-failure-8480fa6.json)은 Google/provider-tapped·SYSTEM_CANCEL_MISSING, exit65/timeout=false. 성공 proof 없음. codex/346-ios-system-dismiss-control에서 전역 Cancel 가정을 native bar의 고정3종/unique·hittable·web 제외로 수정 | 실제 label/scope 원인을 확정하지 않으며 exact CI/main 뒤 바뀐 선택 조건을 검증. 앱/웹/서버/계약 불변. 계정 입력/동의/callback 없음. 실제 OAuth/두 OS/실기기·전체 #334/#346/#339/#71 유지 |
| iOS OS 접근성 검사 | 모바일 담당 / #379 | PR429/main90a2f58·CI40020277557 뒤 actual40020635912 SUCCESS. 원본171989e 앱·iPhone16/iOS26.5·최대 category 전후 readback, Home4/Guide6 scroll/tap·복귀. [OS audit](../quality/mobile-internal-ios-2026-10-23/accessibility-90a2f58.json)는 네 viewport/일곱 검사 요청·보고 issue0이며 원본 ZIP/receipt·runner/device·PNG byte/hash/실물 독립 대조 | 홈/안내의 해당 viewport만 인수. 실제 VoiceOver/TalkBack·전체 화면/역할·키보드/회전·기기·OAuth/private API/store와 #334/#379/#339/#71 OPEN. 웹 UI·권한/계약·서버/제품 코드·배포 불변 |
| 모바일 실제 OAuth 진입 준비 | 모바일 담당 / #346 | main5b895b2·CI40016427571 뒤 2026-10-23T20:15:04.942Z 실제 preview API f912441 확인. 로컬 HTTP에서 기존 세 제공자별 익명 PKCE 시작200·canonical authorization·proxy302/동일 목적지/browser state 설정. [관측과 범위](../quality/MOBILE-NATIVE-AUTH-2026-10-24.md) 보존 | 실제 제공자 계정 로그인/추가 인증과 두 OS 시스템 브라우저·cold/warm 복귀·역할/동의/challenge 검증. HTTP 진입을 실제 OAuth/기기 성공으로 표시하지 않으며 #346/#334/#339/#71 OPEN |
| Android 새 앱/Guide 실제 인수 | 모바일 담당 / #424 | PR426/main346c920·CI40013909663 뒤 actual40014252649 SUCCESS. 원본171989e APK/receipt·SDK37 재검증, Home/font2·Home/Guide 각1회 scroll/tap·교정 문구·복귀·캡처 차단/Metro0. [완전한 proof](../quality/mobile-internal-android-2026-10-23/guide-ui-346c920.json) 독립 대조 | 독립 successful compiler/새 Home·Guide 범위 인수. 이전 dd3e84e receipt 누락 실패는 보존. 전체 #379/#334·키보드/회전·TalkBack/VoiceOver·실제 API/OAuth/physical/store/#339/#71 OPEN |
| Android 성공 compiler 인수 | 모바일 담당 / #424 | PR422/main171989e·CI40005978910 뒤 actual40006344034 SUCCESS. 원본 receipt/57,133,550bytes APK 전체 hash 확인. codex/424-compiled-android-reverification에서 successful provenance/원본 pin·SDK manifest/signature/HBC/font·원본 receipt 유지/별도 관측 준비 | exact CI/main 뒤 새 workflow로 fresh Emulator Home/font2/Guide 왕복 확인. legacy inspection/실패 보존·앱/웹 변경 없음. 실제 API/OAuth·전체 UI/physical/store와 #334/#379/#339/#71 OPEN |
| 두 OS 확대 안내 조작 | 모바일 담당 / #379 | 새 앱 source171989e 두 OS compile/SDK·실제 Home/글자 확대·Guide 왕복/교정 문구 인수. iOS40009294558/toolingb0da132과 Android40014252649/tooling346c920은 source별 원본 보존 | [전달/검증 표](./MOBILE-INTERNAL-PREVIEW.md)와 원본 hash/시각을 유지. 전체 역할/화면·키보드/회전·VoiceOver/TalkBack·실제 사용자 여정·physical/store는 별도 실제 인수 |
| 모바일 기능 안내 교정 | 모바일 담당 / #379 | codex/379-guide-feature-copy에서 Guide의 자료/리포트 준비 중 문구를 현재 사건 화면의 업로드·처리 확인·검토/저장/공유 안내로 교정 | 기존 ff5c208 앱의 실제 관측과 구분. 정확한 새 source PR/main CI 뒤 두 OS bundled compile·원본 compiler pin 갱신·실제 smoke가 필요하며 전체 #379/#334는 OPEN |
| iOS 확대 실제 조작 | 모바일 담당 / #379 | PR423/mainb0da132·CI40008989427 뒤 actual40009294558 SUCCESS. 새 앱171989e의 최대 category 전후 readback·Home5/Guide6 scroll·hittable button tap·교정 문구·Home 복귀. Metro0 | [UI proof](../quality/mobile-internal-ios-2026-10-23/home-ui-b0da132.json)·원본 Home/확대/metadata·별도 PNG 관측을 source별로 보존. 전체 역할/화면·키보드/회전·VoiceOver/TalkBack·physical/store/#334는 OPEN |
| iOS 큰 글자 관측 | 모바일 담당 / #379 | PR419/mainf1ac60d·CI39999943507 뒤 실제40000381723 SUCCESS. 원본 ff5c208 앱의 baseline 두 cold launch와 최대 접근성 category 설정/readback·재시작/재readback·PID3표본/25초·Metro0 인수 | [자동 receipt](../quality/mobile-internal-ios-2026-10-23/large-font-f1ac60d.json)·[실제 시각 대조](../quality/mobile-internal-ios-2026-10-23/visual-large-font-f1ac60d.json) 보존. 제목이 초기 viewport 대부분을 차지해 카드/행동은 화면 아래이며 확대 사용성/스크롤 도달은 아직 인수하지 않음. 전체 역할/화면·VoiceOver/TalkBack·physical/store OPEN |
| 두 OS local native runtime | 모바일 담당 / #385 | PR417/main9a369bc·CI39995718447 뒤 실제39996169996 SUCCESS. iPhone16/iOS26.5 local dev 앱의 계측 Home·100MB upload/1GB download 전체 byte/hash·SDK/SecureStore·취소/owner/401/Origin·파일0개 정리. RSS239표본 최대764,526,592bytes | [원본 receipt](../quality/mobile-runtime-2026-10-23/receipt-ios-9a369bc.json)·원본 unaccepted inspection/ZIP·후속 signing/PNG 실물 대조를 Android c2fa3f2와 source별로 보존. 독립 #385 인수 문서화. 실제 picker/원격 API/OAuth·전체 UI/physical/store와 #339/#71/#334는 OPEN |
| iOS bundled preview | 모바일 담당 / #397 | PR414/mainfd86914·CI39987437927 뒤 실제39987887841 SUCCESS. 원본 ff5c208 Release ZIP/HBC·고정 compiler/receipt·bundled 입력 동일성과 실제 양 ABI metadata/font 재검증. iPhone16/iOS26.5 두 cold launch/PID각3표본·25/54초·Metro 요청0·Home PNG 직접 대조 | [cold launch](../quality/mobile-internal-ios-2026-10-23/home-fd86914.json)·[시각 관측](../quality/mobile-internal-ios-2026-10-23/visual-home-fd86914.json) 보존. 두 OS 내부 전달물·설치/앱·API 관측 표의 독립 #397 인수. 별도 #385의 local native IO·전체 UI/API/OAuth·physical/store/#339/#71은 OPEN |
| 내부 bundled preview | 모바일 담당 / #397 | PR404/main478a904·CI39956914163 뒤 실제39957216861 SUCCESS. 원본 dedcd0e APK57,133,498bytes의 SDK37 signature/metadata/strict identity/HBC/font 재인수·Android15 fresh owned Emulator 두 cold launch/Home hierarchy/PNG 실물 대조. Metro 시작·요청0, adb reverse 없음 | [Home receipt](../quality/mobile-internal-android-2026-10-23/home-478a904.json)와 별도 binary/tooling source를 보존. Home만의 실제 성공이며 전체 화면/IO·실제 API/OAuth·physical/store·접근성·iOS bundled 인수는 OPEN. [내부 전달 절차](./MOBILE-INTERNAL-PREVIEW.md) |
| 공통 account 브라우저 fixture | 모바일 검증 / #392 | main31597a8 전체 Bun3690/Gitleaks0 뒤 browser에서 합성 fixture의 strict mock metadata3건 실패. 제품 guard를 유지하고 tests/helpers/reports-ui-api.ts만 synthetic opt-in/real-account opt-out 명시 | 기존 실패 포함 reports8·signed HTTP/SQL guard와 남은9파일151개 통과. 초기300pass/3fail을 보존. PR393/mainf912441·CI39925887225 뒤 full39926453700에서 browser454 단일 실행 통과·unit3690/DB/build/CSP 통과, 원본 audit2건으로 전체FAILURE |
| 모바일 toolchain 보안 보완 | 모바일 담당 / #334·#339 | PR390 headbf5734c/CI39917339321 SUCCESS→main1a6c54d/main CI39917819068 SUCCESS. 원본 version/SRI/LICENSE 보존·braces 깊이/forge CJS nested ASN.1 보완과 설치 tree/실제 consumer resolution·원본/수정본 회귀 인수. 원본 audit high2건 유지 | 실제 Expo 인증서 라이브러리 합성 서명/Node 독립 검증·현재 module graph/RN sources·양 OS 실제 HTTP 번들 호환 인수. browser dist 미패치·이 패치의 실제 native/SDK와 full 보안/릴리스는 별도 #339/#71 OPEN |
| 모바일 M8 내부 전달물 | 모바일 담당 / #334·#385 | PR389 head176ef3f의 CI39915601296/SDK host39915601362 SUCCESS→mainc2fa3f2/main CI39915841507 SUCCESS. preview39916208240 Android job SUCCESS·APK162,497,066bytes/실제 SDK37 apksig·전체 hash/ABI/font 실물 대조. iOS/workflow도 SUCCESS·Simulator ZIP 전체 hash/Info.plist/ABI/font 실물 대조 | Android artifact12485482082는 Metro 필요 개발 앱이며 앱 부팅/원격/OAuth·physical/store 성공 아님. API 관측57121d2·보안 패치 이전 source와 #339/#71 분리 |
| 모바일 M8 실제 앱 runtime | 모바일 담당 / #334·#385 | 기존 runtime39907857505/ecfcbdd 두 OS terminal FAILURE(Android AVD_INVALID/iOS home layout)를 보존. PR389에서 소유 AVD discovery·실제 SDK 정상/손상 signature fixture·개발 URL 비대화형 flag/adb literal/유효 layout latch를 검증 | mainc2fa3f2 runtime39916204937 Android SUCCESS·실물 receipt와 합성 화면 대조, iOS compile 뒤 Home 대기 terminal FAILURE. raw openurl과 Expo CLI schemeapproval 준비 차이를 확인해 소유 Simulator 경로/readback·안전한 bundle/RSS 분류를 보강. 실제 실행 전 수정 성공으로 표현하지 않음. Android15의 계측 Home/native IPC·100MB/1GB IO 인수 범위를 보존하며 원격/API·OAuth·physical/전체 화면·스토어/#339/#71은 별도 |
| 모바일 전체 구현·M5 native network IO | 모바일 담당 / #334·#361 | PR375 head `4d20c33`·CI39881005183/native39881007251 두 OS SUCCESS/receipt 확인 뒤 main `adc9a119` 통합. native lease→owned cache·SDK SHA readback, 원본/PDF/HTML/ZIP·취소/정리 회귀 통과 | 실제 두 OS 앱 IPC/기기 메모리·API/공급자와 M7/M8·#339·#71 인수 유지. 코어/compile·합성 composition 증거를 실제 기기 성공으로 확대하지 않음 |
| 모바일 M6 공개 탐색·판례 | 모바일 담당 / #334·#369 | PR371 main `a7e4bad`·CI39873595704, PR372 main `045b0bc`·head `54d8e59`·CI39874823751 성공 통합. 공개 주제1~2·context/search/signed read·공식 링크와 범위/실패 상태, Hono/SQL·owner/취소 회귀·quick275/RN53/server56·build/두 OS Metro 통과 | M5 producer와 독립 통합. 본인 프로필/자산·실제 기기/M7/M8 잔여 |
| 모바일 M6 계정·설정 소비 | 모바일 담당 / #334·#369 | PR376 head `7db2aff`·CI39883584580 SUCCESS 뒤 main `ca028ccb` 통합. RN usage/정책·reauth·literal 삭제/별도 미확정 확인, native credential/proof/파일 정리와 peer·작업 key 보존 검증 | frozen/quick319·RN69/server56·build/두 OS Metro 통과. 실제 OAuth/기기·본인 프로필/M7/M8 잔여 |
| 모바일 M6 본인 프로필 자산 IO | 모바일 담당 / #334·#369 | PR378 head `d56c28f`·CI39886391264/native39886391325 두 OS SUCCESS·receipt 확인 뒤 main `8107cbde` 통합. native100MB PUT·snapshot/hash·bounded JSON·기존100MB/1GB download 통과. Apple23개/JVM9개·128MiB heap proof | source lease/credential·private read·프로필 편집/공개/철회 소비를 연결. 실제 앱 IPC/기기 메모리/API·M7/M8·#339/#71 유지 |
| 모바일 M6 본인 프로필 소비 | 모바일 담당 / #334·#369 | PR381 head `bf2a0ef`·CI39892678831 SUCCESS 뒤 main `07e6ee0c` 통합. RN 편집/공개/철회·자산 source lease/native PUT·private read·참조 해제/삭제 연결. 웹 소유 파일 readonly·schema 변경 없음 | frozen/quick(design3·shared350·RN77/server56)·build/local workerd·두 OS Metro 통과. 실제 두 OS 앱 IPC/API·OAuth·M7/M8·#339/#71 유지 |
| 모바일 M7 공통 시각 토큰 | 모바일 담당 / #334·#379 | PR380 head `ddb6be1`·CI39888406927 SUCCESS 뒤 main `e94b20a6` 통합. 웹 실제 CSS 정본에서 순수 @baro/design-tokens 생성·drift/모호한 토큰/필수 대비 검증. 웹 파일 readonly | frozen/quick(design3·shared328·RN69/server56)·build/두 OS Metro 통과. exact CI/main 뒤 native theme/primitive 소비. PR378 exact native terminal/main8107cbde 뒤 rebase·통합 검증 완료. 실제 화면·기기 접근성·M6/M8 잔여 |
| 모바일 M7 native 표현 소비 | 모바일 담당 / #334·#379 | PR382 head `7fa18ce`·CI39894269795 SUCCESS 뒤 main `bf9c38b7`·main CI39894531533 SUCCESS 통합. 정본 token→theme/ui 연결. primary/secondary/danger·48dp target·큰 글자/줄바꿈·선택/focus/readonly·반응형 safe area/scroll 회귀. 웹/모델/서버/schema 불변 | frozen/quick(design3·shared352·RN81/server56)·production build/local workerd·두 OS Metro 통과. font/브랜드·전체 화면 및 실제 키보드/VoiceOver/TalkBack·M8/#339/#71 유지 |
| 모바일 M7 폰트·브랜드 | 모바일 담당 / #334·#379 | PR383 head `c249a6a`·CI39896857238 SUCCESS 뒤 main `0823b8b`·main CI39897078224 SUCCESS 통합. 기존 WOFF2/OFL·SVG readonly→native TTF/PNG·icon 생성. cmap/굵기/라이선스·hash drift와 Expo embed/prebuild 연결, compiled resource receipt 검증 추가 | Python pinned 재생성/byte check·양 OS prebuild·frozen/quick(design3·shared356·RN81/server56)·build/workerd·두 OS Metro 통과. native39897286715/target0823b8b 두 OS app/font receipt SUCCESS·실물 대조. runtime/storeSigned/deployed=false이며 이 source compile/포함만 검증. 실제 기기 폰트/키보드/VoiceOver/TalkBack·전체 화면/M8/#339/#71 유지 |
| 모바일 M7 읽기·선택적 관리 | 모바일 담당 / #334·#379 | 선행 PR383 exact CI/main 뒤 `codex/379-native-screen-hierarchy`에서 Disclosure와 리포트 읽기/편집·설정 계정 관리 분리. dirty/conflict·미확정/reauth·삭제 접수/파일 준비 결과는 유지. feature model·web·서버/schema 불변 | RN 행동/상태·기존39개 제어 handler/guard AST 비교와 frozen/quick(design3·shared356·RN85/server56)·build/workerd·두 OS Metro 통과. exact CI/main 뒤 통합. 선행0823b8b compile을 새 UI 증거로 확대하지 않으며 실제 기기/전체 화면/M8/#339/#71 유지 |
| 모바일 M7 실제 글자 확대 | 모바일 담당 / #379 | PR406/mainbf88d0d·CI39960471564 뒤 실제39960797413 SUCCESS. 같은 bundled APK의 Android15 font_scale readback2·원래 Home 재시작/한글 확대/줄바꿈 PNG 실물 대조. [관측](../quality/mobile-internal-android-2026-10-23/large-font-bf88d0d.json) 보존 | 모든 text 정확히2배의 pixel 측정·전체 화면·회전·키보드·TalkBack/VoiceOver·두 OS/physical 인수는 OPEN. 제품/웹 UI·권한·계약·native 입력 불변 |
| iOS 글자 확대 SDK 준비 | 모바일 담당 / #379 | iOS bundled Home의 실제39987887841 SUCCESS 뒤 codex/379-ios-ui-capabilities에서 현재 SDK help ui의 공개 명령/category를 읽기 전용으로 관측하는 경로 추가 | app/native/웹·기기 상태를 바꾸지 않으며 실제 SDK 문서 관측 전 지원을 주장하지 않음. 문서 확인 뒤 category 설정/readback·실제 앱/PNG 대조로 진행. 현재 local IO39996169996은 별도 실행 유지 |
| 모바일 실제 공개 목록 | 모바일 검증 / #407 | PR408/main5b41fc2·CI39963435347 뒤 실제39963766414 SUCCESS. 같은 원본 dedcd0e APK의 공개 목록 ready-empty·loading/error=false 관측. 사전 screenshot reader 차단·이름/ID/raw hierarchy/목록 PNG 미출력. [receipt](../quality/mobile-internal-android-2026-10-23/public-directory-5b41fc2.json) 보존 | 독립 공개 UI 범위의 인수이며 실제 프로필 card/HTTP 별도 계측·OAuth/private/physical/store·iOS는 포함하지 않음. #334/#346/#379/#397/#339/#71 유지 |
| DB·HTTP 왕복 축소 | 성능 조율 / #317 | 선행 UI·법률·모델·첨부·리포트 PR을 main c2258b88에 통합, 필수 PR/main CI 성공. 별도 codex/317-db-roundtrips에서 합성 호출 수 재측정 | commit revision 기반 행동·타임라인 선택 재조회, 중복 domain 읽기와 단일 공개 목록 lead sample 제거. fresh auth/삭제/CAS/멱등성 및 관측 전용 비용 정책 보존. 회귀·quick/build/DB 검증 후 PR, 실제 원격 성능·배포는 #71 별도 |
| 사진 근거·PDF 리포트 | AI/자료, #312 | 2026-10-21 직접 요청, codex/312-photo-evidence-pdf. #307 첨부 UI·#304 법률 범위 분리, migration 없음 | 상해/진단서 관찰·확인 지침, 선택 사진·출처와 HTML→PDF, PDF만 저장. quick/build·브라우저·native 조판 CI 후 별도 PR 병합; 외부 모델/배포 인수 별도 |
| Gemini 모델·질문 하네스 | AI / #305 | 2026-10-21 사용자 승인, 별도 codex/305-gemini-flash-pipeline worktree. #304 법률 API와 PR303 UI 범위 분리 | ADR-0016·고정 평가·quick/build·CI 검증 후 별도 PR 병합. 실제 모델·배포 인수는 별도 receipt |
| 사건 관련 판례 탐색 | 법률/UI / #308·PR311 | 2026-10-21 직접 기능 구현 요청. 선행 PR306 직접 승인 후 main bab5c76 통합. 별도 페이지/API·주제 추천·서명 원문 조회 구현, 로컬 workerd/D1 실제 공식 판례6건 검색/읽기 성공 | quick/build·관련 회귀·브라우저/접근성 및 정확한 PR head CI 증거를 #308에 기록. PR311 병합·preview/production 반영은 각각의 승인/검증 조건 유지 |
| UI 브라우저 회귀 | UI / #314 | full39605770123 실패 중 프로필 파일선택 인증11건·자료 검토2건 담당. e46a7616에서 재현 후 진행 중 세션 HTTP 공유와 변경 전 pagination 문구를 기대한 테스트로 분류. 제품 코드는 보존 | 일반 focus 검증 참여/진행 중 공유·settled 뒤 새 조회와 peer 계정/역할/동의/장애의 새 응답 우선·지연 이전 응답 차단을 검사. dirty 교정/revision/부분 저장 회귀·quick·정확한 PR CI 뒤 정상 통합, 최종 full은 조율 담당이 통합 SHA에서 수행 |
| 업로드·물리 용량 | 자료 모듈 + 총괄, #58 | PR230→229→235와0014가04f25f8에 포함돼 배포됨. production storage 초기화 성공; 실제 업로드/ZIP/cleanup은 이번 receipt에 없음 | 물리 inventory/writer 경계를 유지하며 남은 자료 경로의 구현·실제 증거를 구분 |
| 비용 관측 분리 | 비용 모듈 + 총괄, #57 | PR247/259 병합; preview71892c5·schema0016에서 기술 admission과 선택적 관측 분리, 기존 원장 보존 확인. 가격/funding 없는 물리 bootstrap도 구현·로컬 검증 | 기존 관측·hold·원장/보안/기술 상한 보존. 비용 차단 재도입 금지. 실제 preview 핵심 흐름은 아래 단일 추적표에서 별도 인수 |
| 릴리스 증거 | 총괄, #19/#71 | 04f25f8 동일 SHA CI·preview·production 성공, 실제 일반 채팅·리포트/PDF/HTML 확인 | 이번 관측 분리의 새 PR/배포 증거를 별도 기록. 기존 성공을 새 변경 또는 전체 MVP 완료로 확대하지 않음 |
| 디렉터리 | 변호사 모듈 + 총괄, #231/M5 | PR234 병합; 기존 공개 목록의 원격 projection 연결 미완료 | serving SHA 확인 후 bounded reindex, 철회·cursor·필터 smoke |
| 문서·작업 체계 | 총괄, #19/#64/#71 | 현행 기준과 과거 기록 분리 중 | 문서 PR과 이슈/마일스톤의 담당·증거·다음 행동 대조 |
| 채팅 실패·재시도 | 고객/AI, #64 / PR238 | production04f25f8에서 21:32:46 KST 새 일반 채팅 요청,21:33 실제 assistant 본문 확인 | 이전7a617b5 비용 실패와 원인 미확정 provider 실패를 역사로 보존. 비용 관측 만료 후 실패 방지는 이번 변경의 별도 범위 |
| 리포트·다운로드 | 자료 모듈, #66 | production04f25f8에서21:34:37 KST 리포트v3 생성, PDF3페이지/3,144,078bytes 실제 수신·한글 렌더, HTML14,572bytes 실제 수신 | 선택 원본 ZIP/업로드/삭제와 다른 media 경로는 별도 잔여로 유지 |
| 법률·인증·정책 점검 | 법률/인증 모듈, #27/#63/#71 | [10/14 검증](../quality/LEGAL-AUTH-VERIFICATION-2026-10-14.md): 등록 도메인 Referer 누락 확인·로컬 인터넷 JSON 거부 해결. 법령 본문 검증과 실제 판례 형식 수정. Google 사용자 수동 확인·정책 점검표 완료 | 수정 PR 병합 후 GitHub 저장 credential 및 같은 SHA Worker 검증. 기관 안내 update_pending·판례 limited·Naver/Kakao 실제 증거는 보존 |
| 전체 실제 인수 | 각 모듈, #27/#59/#63/#64/#66/#67/#71 | 단일 추적표에 버전별 실제 Kakao 두 역할·질문/요약/채팅/공식 법률 질의·자료 처리·HTML/PDF/ZIP·프로필 공개/철회 결과 기록. 8ebfbaf DOCX 본문/표/두쪽 및 원본 일치 확인. 수동 Turnstile은 사용자 보류, 지연과 간헐 native 원인 미확정. 큰 자료의 사건 화면 오류 수정 PR288 병합 후 preview 재확인 대기 | [단일 실제 인수 추적](../quality/PREBETA-MVP-LIVE-ACCEPTANCE.md)을 현재 결과 정본으로 사용. 이전 오류와 성공을 다른 버전에 그대로 적용하지 않음. preview 전체 핵심 흐름 완료 전 production 배포 금지 |

## 2026-10-14 실제 배포·제품 receipt

배포 SHA `04f25f804f02e0f221f4b34be0f03edc3d0afd00`의
[main CI38563034585](https://github.com/creno-va/baro/actions/runs/38563034585),
[preview38563613354](https://github.com/creno-va/baro/actions/runs/38563613354),
[production38563979183](https://github.com/creno-va/baro/actions/runs/38563979183)가 성공했다.
production [저장 초기화38564333321](https://github.com/creno-va/baro/actions/runs/38564333321)는
21:30:58 KST, [같은 할당 refresh38564475420](https://github.com/creno-va/baro/actions/runs/38564475420)는
21:31:57 KST에 완료됐다. 이 refresh는 당시 실행한 절차이며 앞으로의 기능 사용 선행 조건이 아니다.
일반 채팅과 리포트/PDF/HTML의 실제 확인 범위는 위 표와
[#71 종합 receipt](https://github.com/creno-va/baro/issues/71#issuecomment-6168531808)를 따른다.
법률 query의 `POLICY_REJECTED`는 별도 정책 결과이며 이번 실제 업로드/ZIP 인수는 미확인이다.

22시경 KST 인증 콘솔에서 Workers Paid, 양 Gateway Spend Limits OFF/Rate Limit Requests OFF,
production Dynamic Routes 없음, Unified Billing credit$39.21와 기존 자동충전ON/$10/$30을 확인했다.
GitHub 공개 저장소의 모든 workflow는 표준ubuntu-latest runner다. 조직 budget 조회는 권한/404로
전체 상태를 확인하지 못했으며 “조직 예산 없음”으로 단정하지 않는다. 자세한 범위는
[비용 정책의 외부 설정 관측](../operations/PREBETA-COST-POLICY.md#외부-설정-관측-범위)을 따른다.

## 이전 비용 차단 관측과 후속 구현

**이전 실패 기록:** 2026-10-14 채팅 수정 preview receipt: main `7a617b5acf08c7168482caa3e08ff07208416270`,
[main CI38556751515](https://github.com/creno-va/baro/actions/runs/38556751515) 성공.
[preview38556937083](https://github.com/creno-va/baro/actions/runs/38556937083)는 Worker 반영과
schema/endpoint 검사는 통과했지만 AI 재원 검사 실패로 전체 실패다. 검증된 배포 성공이나
실제 채팅 성공으로 기록하지 않는다. 미정산21,895원·정산283원·유지비 예약31,118원을
보존했다. 그 run에서는 production 배포 및 유료 모델 호출을 수행하지 않았다.

2026-10-14 후속 직접 지시로 금액 차단 정책을 변경한다. #57의
[PR241](https://github.com/creno-va/baro/pull/241)은 `APPLICATION_COST_LIMITS_ENABLED=false`로
월·누적 재원·요청 금액의 admission/dispatch/refresh/preflight 차단을 해제한다.
위 7a617b5 실패는 당시 정책의 실제 기록으로 보존한다. PR241 단계에 남았던 가격/재원
만료·월할당·수동 refresh·비용 예약 IO의 차단도 후속 직접 지시로 제거한다. 비용 원장·
관측 사실·기술용량·AI200/일·권한·실제 공급자 오류는 유지한다.
0014 예약 금액 표현 변경은 #55에 단일 작성자를 기록했으며 과거 migration은 보존한다.
새 직접 사용자 지시 없이 금액 상한·비용 관측 만료·예산 대기·비용 초과 동결을 다시 적용하지 않는다.
PR247의 코드·0015·배포 도구·문서 변경은 병합됐다. PR248은 별도로 확인된60초 모델 timeout을
120초로 조정한다. 새 배포·실제 기능 결과는 #71 동일 SHA receipt로 연결하고04f25f8의 증거와 구분한다.
배포 진행 상태는 GitHub run의 실제 SHA·결과로 확인하며 다른 세션의 진행 중 배포를 중복 실행하지 않는다.

## 검증과 배포

### 2026-10-21 법률 API 신뢰성 정비 (#304)

현재 정비 채팅 / `codex/304-legal-retrieval-reliability`. 공식 법원 corpus 필터와 검색 범위/
원문 검증 분리로 정상 판결문을 사용할 수 있게 한다. 형법·근로기준법의100행 초과 시행
이력은 최대5페이지로 완전히 확인하며 요청30회/workspace12회·권한·취소·인용 검증을
유지한다. 일반 상담 문서를 바로잡되 실제 update_pending은 정상으로 위장하지 않는다.
[실제 공식 응답과 잔여 조건](../quality/LEGAL-API-RELIABILITY-2026-10-21.md)을 따르며
local-workerd 성공을 remote Worker/제품 E2E로 확대하지 않는다. 운영1059887에는 기존
redirect 수정도 미배포 상태다. 같은 SHA 검증과 #71 배포 gate를 보존한다. UI PR303과
랜딩·모델·공급자·공유 DB schema는 이 브랜치에서 변경하지 않는다.

### 2026-10-21 UI·동의 흐름 정비 (#302)

담당은 현재 UI 정비 채팅, 브랜치는 `codex/302-responsive-ux`다. 랜딩 페이지의 코드·자산·
스타일은 변경하지 않는다. 로그인 448px 고정 폭·과도한 세로 여백을 반응형 2열/1열 구조로
교체하고 역할 선택·SSO·보조 안내를 구분한다. 동의가 현재 버전이면 동의 폼을 표시하지 않고,
신규/재동의도 저장 확인 뒤 역할과 허용된 returnTo에 따라 자동 복귀한다. 정책 원문은 새 창으로
열어 선택을 유지한다. 동의 버전·연령·인증·권한 검증은 보존한다.

합성 브라우저 탐색에서 타임라인/자료 모달의 좌상단 배치, 고객 화면의 불필요한 하단 여백,
모바일 도움말 앵커 제목의 고정 헤더 가림을 재현하여 수정했다. 변호사 편집 화면의 제목·
디렉터리 링크를 같은 헤더에 정렬했다. 320/390/768/900/1366/1440/1920px의 해당 화면,
로그인·동의·새 사건·질문·요약·대화·자료·타임라인·행동·리포트·설정·검색·프로필·도움말을
점검했다. 합성 OAuth/SQL·로컬 API 예시 결과는 실제 외부 로그인/배포 인수와 구분하며
검증 명령·결과와 PR/CI는 [#302](https://github.com/creno-va/baro/issues/302)에 기록한다.

2차 점검에서는 검색한 변호사의 상세/새로고침/목록 복귀 시 적용한 이름·지역·분야가
사라지는 흐름을 수정했다. 공개 검색 필드만 상세 경로에 유지하고 목록 링크는 SSR에서
같은 조건으로 구성한다. 낮은 가로 화면에서 메뉴를 스크롤해도 닫기 버튼을 유지하고,
설정의 다시 확인·리포트 확인·사건 삭제 조작 영역을 최소44px로 맞췄다. 긴 사건 제목·
파일명·대화·일정·행동·리포트와320/901/1024px 경계도 별도 합성 fixture로 점검했다.
320px 리포트에서 새 버전 버튼이 메타정보에 밀려 여러 줄로 잘리는 정렬도 행을 나누어
수정했다. 랜딩은 2차 점검에서도 변경하지 않는다.

휴먼테스트 12쪽 리뷰 후속으로 정상 포커스 복귀의 편집 화면 보존, 인증 동시 조회 병합과
사건 목록 병렬 조회, 활성 사건 요약 편집/자료 탭 복귀, 저장 후 정확한 revision 확인,
추가 자료 표시·교정 뒤 기존 대화로 반영, 사건별 삭제 진입, 자료 검토 밀도·추가 페이지
안내·시간 표기, 사실 상태/모순 선택, 리포트 출처/삭제 도움말과 선택 지표 상태를 정비한다.
허용된 원음/영상 재생은 명시적 원본 조회 뒤 제공하며 세션 변경 시 제거한다. 모델·공급자와
원문·출처·CAS·삭제 절차는 보존한다. 항목별 기준과 합성 검증/실제 ASR·지연 검증의 경계는
[휴먼테스트 후속 기록](../quality/HUMAN-REVIEW-2026-10-21.md)에 정리한다.

bun ci 후 validate:quick과 해당 기능의 인증·소유권·CAS·멱등 재시도·실패·삭제 회귀를
실행한다. build 영향은 validate:build, DB 변경은 validate:db의 drift·fresh/upgrade와
실패 rollback을 확인한다. 필요한 browser/native/security 검사를 선택하고 통과한 검사는
새 변경이나 미해결 원인 없이 반복하지 않는다. Bun은 도구용이며 제품 런타임은 Workers다.

모든 구현·문서가 병합된 최종 main SHA를 명시해 GitHub 수동 validate:full을 한 차례
수행한다. 실제 checkout SHA를 증거에 기록하고 CI에서는 유료 호출을 하지 않는다.
같은 SHA를 preview에 배포해 합성 계정·자료로 업로드, 리포트·다운로드·삭제,
디렉터리를 제한 검증한다. production은 같은 SHA와 #71의 유효한 운영자 승인 기록이
필수다. 승인자는 hyunhomon 또는 hwangeunchan, 정확한 SHA와 최대24시간 유효기간을 검사한다.
현재 Environment에 필수 reviewer가 있다는 가정은 하지 않는다. 비공개 합성 고객 흐름을
검증하며 production 디렉터리에 가짜 변호사를 게시하지 않는다.

기존 정식 공개 checker의 미완료 정책·외부 조건은 보존한다. 공개 운영 허가와 독립 외부
검증, 정책 초안 수용과 법률 승인은 별도 상태다. 다른 SHA/환경의 증거는 대상 소스·의존성·
관련 설정 동일성을 입증한 경우에만 재사용하며 현재 resolver는 보수적으로 다른 SHA를 거부한다.
실패한 외부 검증은 원인이나 조건을 바꾸기 전 반복하지 않는다.

## 데이터·비용·권한 경계

미정산 비용·실행 작업·v1 암호문·공개/자격 표시·삭제 journal을 보존한다. 비용 관측의
누락·만료·월 전환·refresh 미완료는 실행·배포를 막지 않는다. 관측 도구는 사실대로
unknown/stale를 기록하고 날짜/재원 금액을 늘리지 않는다. 당시 호출은 당시 근거로 정산한다.
물리 용량·서명/권한·revision/CAS·writer/lease 검사는 비용 관측과 분리한다.

새 모델/공급자·새 결제수단/자동충전 변경·법률 승인·실제 사업자 사실을 임의 결정하지 않는다.
기존 사용자 승인 결제 경로와 자동충전은 유지한다. OAuth 키·실제 사건·토큰·원문·stack/SQL을
공개 이슈/로그/artifact로 보내지 않는다. 다른 작업자의 checkout·합성 자료·secret을 보존한다.
에이전트·새 채팅·Goal·스케줄을 자동 생성하지 않는다.

## 완료 판정과 이력

실제 외부 인수가 남으면 PR은 Refs를 사용하고 이슈를 열어 둔다. 정비 종료에는 문서·설정·
이슈 정합성, 미정산 보존 재개, 증거 결합, bounded 검색, 최종 회귀·같은 SHA 배포·제한 검증·
자료 정리가 필요하다. #71은 전체 MVP 필수 조건의 담당과 실제 증거가 모두 충족될 때만 닫는다.
M2/M3/M6의 완료 이력은 유지하고 새 정비 마일스톤은 만들지 않는다.

2026-10-11 인계와 이전 A/B/C 경계·실패·배포 receipt는 [실행 이력](./EXECUTION-HISTORY.md)에
보존한다. 이전 수치·담당·승인 대기는 현재 실행 기준이 아니다.


### 2026-10-21 채팅 첨부 UX (#307)

현재 첨부 UX 채팅 / `codex/307-chat-attachments`. 사용자 명시 승인으로 선행 UI PR303
검증 head854df33을 정상 병합한 main57a91de에서 시작했다. 별도 worktree에서 사진·파일
선택/붙여넣기/끌어놓기, 처리 후 전송과 실제 참조의 자료 탭 연결을 구현한다. 자료 기본
조회는 metadata 경계를 유지하며 명시적인 근거 보기에서만 요약·최근100개 메시지를 추가로
읽는다. DB schema/공급자/비용 정책은 이 작업에서 변경하지 않는다. 성능 조율 채팅과
법률/판례 채팅에 공유 경로를 전달했다. [검증 기록](../quality/CHAT-ATTACHMENTS-2026-10-21.md)을
따르며 실제 provider/OAuth/배포 인수는 #71과 구분한다. [PR310](https://github.com/creno-va/baro/pull/310)으로 제출했고 최신 main76643b7을 통합한
제품 head8c7919f의 quick·관련 단위·빌드를 통과했다. main 병합·배포는 조율 채팅과 현재
사용자 승인 범위를 따른다.


PR306·311·313이 main1b10fc6에 통합된 뒤 첨부 담당이 같은 main을 PR310에 충돌 없이
병합했다. 제품 head24c2a47의 quick·관련 단위78개·빌드와 첨부7/판례4/리포트3/CSP1
합성 브라우저를 통과했다. 첨부·기본 자료 projection과 판례/사진/PDF 경계를 보존하며
새 head CI 확인 후 현재 사용자 AGENTS의 검증 PR 병합 범위로 정상 통합한다. 별도
full·배포·실제 외부 성공을 이 검사로 대신하지 않는다. 최종 head/CI/main receipt는 #307과
PR310을 따른다.
