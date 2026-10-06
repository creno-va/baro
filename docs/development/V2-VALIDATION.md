# BARO v2 검증 증거 기록

- 기준일: 2026-10-06
- 상태: #53 명세·#54 strict 계약·#55 additive DB·#56 공통 UI 시스템 완료. 후속 서비스 실행·화면·외부 연동·공개는 진행 중이며 전체 완료 증거 없음.
- 마일스톤: [전체 서비스 개발](https://github.com/creno-va/baro/milestone/5)
- 실행 정본: [V2 실행 계획](./V2-EXECUTION.md), 개정 PRD/UX와 실제 GitHub 이슈

## 증거 작성 계약

각 성공은 requirement/scenario ID, full candidate SHA, 환경, 실행 시각, 역할, 실제/대역 구분,
결과, run/receipt/안전한 화면 artifact를 연결한다. 실제 사용자의 사건·사진·변호사 자격 서류,
cookie·token·secret·인증 URL·stack/SQL은 증거에 포함하지 않는다.
릴리스별 증거를 새로 기록하고 과거 SHA의 녹색 CI나 health를 현재 기능 승인으로 쓰지 않는다.
관측 실패·missing·pending·mock-only는 통과가 아니다.

## 전체 요구사항과 증거 소유자

| 요구사항 | 코드/계약 이슈 | 실제 검증 | 현재 판정 |
| --- | --- | --- | --- |
| 로그인·동의·계정·만14세·역할 | #60/#68, 기존 #10 | #27/#69/#71 실제 OAuth 성공/취소/만료/권한 | 미검증 |
| 개인/사업자 단일 소유자·전체 사건군 | #54/#55/#63/#64/#65 | #69/#71 사건군별 UI·평가·공식 source | 미구현 |
| 적응형 질문·모름/skip·중단/재개 | #54/#64/#65 | #69/#71 답변별 생성·저장·중복·재접속 | 미구현 |
| 사용자 요약 확인·수정 | #55/#64/#65 | #69 revision 충돌·확인 전 행동 가드 | 미구현 |
| 지속 chat·사실/인물/timeline/actions | #55/#64/#65 | #69/#71 실제 대화·완료·저장·재로그인 | 미구현 |
| AI 사실 경계·불리한 사실·모순·근거 | #63/#64 | #69/#71 실제 모델·전체 사건군·critical zero | 미검증 |
| 자료 업로드·동의·원본 접근 | #57/#58/#65 | #69/#71 actual R2·권한/크기/중단/실패 | 미구현 |
| 문서/이미지/음성/영상 처리 | #59/#64/#65 | #69/#71 actual processor/Whisper/model·coverage/timestamps/gaps | 합성 fixture 준비; 실제 처리 미검증 |
| quota·월100만원·실제 비용·retry | #57/#58/#59/#64 | #69/#71 동시성·KST·usage/cost reconciliation | Gateway 연결 준비 중; trusted factory·실제 정산 미검증 |
| 한글 PDF·검토/수정/마스킹/제외 | #66 | #69/#71 실제 다운로드·렌더·내용·revision | 미구현 |
| 선택 원본 ZIP | #66 | #69/#71 다운로드 실제 원본·권한·제외 파일 | 미구현 |
| 변호사 등록·자격/소속 수동 확인 | #60/#62 | #69/#71 신청·반려·재신청·승인·역할 | 미구현 |
| 사진/소개/주소/contact/portfolio | #58/#59/#60/#62 | #69/#71 텍스트/image/PDF·미리보기·저장 | 미구현 |
| 모든 공개 편집 승인·승인 revision | #60/#61/#62 | #69 pending 비공개·stale revision·철회/공개 | 미구현 |
| 디렉터리·필터·회전·공급 부족 | #61 | #69/#71 실제 UI·객관적 정렬·가상 프로필 분리 | 미구현 |
| 전화/email/외부 link·3종 길찾기 | #61 | #69/#71 정상 링크 연결, 실제 상담 메시지 발송 없음 | 미구현 |
| moderator 심사·신고·비민감 상태 | #60/#62 | #69/#71 case plaintext 접근 금지·IDOR/CSRF | 미구현 |
| 사건/자료/계정 삭제·부활 방지 | #67 | #69/#71 원본/파생/대화/작업/report/public asset·late processing | 미구현 |
| restore/delete replay·rollback·alert | #19/#67/#71 | #71 실제 격리 drill·latest journal·수신 ack | 미검증 |
| shadcn/blue/Lucide/Pretendard/SVG | #56/#61/#62/#65/#66 | #69 브라우저 visual/mobile/keyboard/focus/modal/200%/built CSP | #56 공통 시스템·#80 경합·#82 모바일 보완 완료, 후속 역할별 기능 화면 미구현 |
| 법률/정책·사업자·처리 계약 | #20/#68/#70 | 책임자 사실/승인·게시/동의 버전·provider 증거 | 근거 없음 |
| preview/production·최초 공개 | #71 | exact SHA CI→preview→live→Environment→production→승인 public flag | 미완료 |

## 기존 증거와 재사용 한계

[P0.3 검증](./P0.3-VALIDATION.md)과 [readiness](../operations/ENVIRONMENT-READINESS.md)는
현재 v1 외부 실패/미검증과 foundation 배포를 기록한다. #52 PR CI 성공은 기존 v1 회귀와
독립 진단/계약 검증이며 v2 화면·모델·미디어·변호사·공개 정책을 증명하지 않는다.

현재 법령 adapter는 승인 정보 credential로 HTTP 200 upstream-error를 반환했다.
이전 격리 AI의 누락/다른 코드 report는 미확인으로 보존한다. 후속 clean e9dee3b의 단일
screening은 실제 Worker/strict schema/provenance/replay를 통과했지만 v2 모델·미디어·전체
사건군 eval의 증거가 아니다. OAuth의 preview 전용 여부와
실제 callback, Turnstile token/action, 복구 관리자와 live drill, 사업자/법률 승인도 남아 있다.
예산과 production 코드 배포 허용은 실제 성공/승인 증거를 대체하지 않는다.

#53은 [PR72](https://github.com/creno-va/baro/pull/72)와
[exact-head CI](https://github.com/creno-va/baro/actions/runs/37365995710) 성공 후 main
`b75429de3af2d04cf001041a3aafada631c2489a`에 병합됐다. 문서56개/ADR13개, 필수 검사,
browser20/CSP1 및 polling 경계 5회 반복을 확인했다. 이는 명세와 기존 v1 회귀 증거다.
#54는 [PR75](https://github.com/creno-va/baro/pull/75)의 strict 계약·합성 fixture로 완료됐고,
#56은 [PR77](https://github.com/creno-va/baro/pull/77)의 공통 UI 시스템으로 완료됐다.
이 완료는 DB·적응형 질문·자료 처리·변호사 화면의 구현 또는 실제 외부 성공을 뜻하지 않는다.

## 공통 UI와 실제 foundation 배포

#56 head `abc028f77bb1f8cc884dc76d12c6f585d00944fe`는
[PR CI](https://github.com/creno-va/baro/actions/runs/37375973374)를 통과해 main
`ee42126eb969e5eb6f3ee569a2d94d94af521a15`에 병합됐다.
공통 blue tokens·self-hosted Pretendard·Lucide·단일 SVG, 표시용 role navigation,
상태·탭·native modal/sheet 및 기존 화면의 스타일을 검증했다. 인증·역할을 부여하는 대역은 없다.

같은 main SHA의 [main CI](https://github.com/creno-va/baro/actions/runs/37376755285),
[preview 배포·smoke](https://github.com/creno-va/baro/actions/runs/37377129500),
[production foundation 배포·smoke](https://github.com/creno-va/baro/actions/runs/37377554912)가 성공했다.
preview deployment `6869922819`와 production deployment `6869976048`의 최신 status도 success다.
2026-10-06 KST에 두 실제 도메인의 live/ready에서 같은 SHA와 schema `0005`를 재확인했다.
production `/api/cases`는 HTTP503/`BETA_NOT_OPEN`이며 정상 Environment reviewer 승인 절차를 사용했다.

실제 preview의 홈과 모바일 메뉴를 브라우저로 직접 확인했다. 320px viewport에서 classic
세로 스크롤바가 공간을 차지하면 clientWidth305·bodyWidth320으로 가로 넘침이 발생해
[#82](https://github.com/creno-va/baro/issues/82)를 등록했다. 기존 자동 검사의 innerWidth 비교만으로
이 경계를 입증할 수 없었으며 아래 별도 수정·재검증으로 해당 결함을 완료했다.
별도 fixture CI에서 hydration 전 첫 클릭이 유실된 경합은
[#80](https://github.com/creno-va/baro/issues/80)의 [PR81](https://github.com/creno-va/baro/pull/81)에서
실제 island 준비 후 상호작용하도록 보완했고
[exact-head CI](https://github.com/creno-va/baro/actions/runs/37378342169)를 통과해 병합됐다.
로컬 해당 모달 5회 반복·전체 browser26·normal built CSP3개가 통과했다.
실제 preview 로그인 화면의 Google 시작은 안전한 실패 안내를 표시하고 버튼 포커스를 유지했다.
이 실패 상태는 실제 OAuth callback 성공 증거가 아니며 preview client 준비/승인은 여전히 필요하다.
이 배포·공통 UI 증거는 v2 모든 기능·실제 OAuth·법률/미디어 처리·공개 승인 증거가 아니다.

### 모바일 가용 너비 수정과 동일 릴리스 배포

#82의 [PR83](https://github.com/creno-va/baro/pull/83)은 최신 main 통합 head
`4367d51545fbd147487752f7855dab7589169d2f`의
[필수 CI](https://github.com/creno-va/baro/actions/runs/37380575300)를 통과하고 main
`015ece8f64abc9e179dc8733bc1ff1eea18d0cfd`에 병합됐다. body의 최소 너비를 가용 폭에 맞췄고
기존 모바일 검사를 clientWidth 기준으로 강화했다. 로컬 필수 unit219/3654 assertions·migration6/29,
전체 browser28, normal built CSP3 PASS/fixture 전용1 SKIP 및 320px·200% 화면을 확인했다.

동일 main SHA의 [CI](https://github.com/creno-va/baro/actions/runs/37380924065),
[preview 배포](https://github.com/creno-va/baro/actions/runs/37381292381),
[production foundation 배포](https://github.com/creno-va/baro/actions/runs/37381428402)가 성공했다.
정상 Environment reviewer 승인을 사용했고 production deployment `6870615398`의 최종 status는
success다. 두 도메인의 독립 live/ready smoke도 같은 full SHA를 확인했다.

실제 preview 브라우저 홈에서 viewport320/client305/body305/scroll305/bodyScroll305로 가로 넘침이
없음을 확인했다. Enter로 메뉴를 열면 닫기 버튼으로 포커스가 이동했고 Escape 뒤 opener로 복귀했다.
로그인 화면은 viewport/client/body/scroll320으로 맞았다. 실제 화면도 직접 확인했으며 브라우저의
임시 viewport와 검증 탭은 정리했다. 이는 실제 OAuth callback 성공 증거가 아니다.

production 사건 API는 HTTP503/`BETA_NOT_OPEN`으로 유지했다. #82만 CLOSED이며
#19/#20/#27과 v2 전체 시연·외부 연동·법률/정책 승인·최초 공개 조건은 미완료다.

## 사용량·비용과 독립 준비의 경계

[#57 문서 PR](https://github.com/creno-va/baro/pull/79)은 KST quota·logical operation 재시도,
실제 호출별 비용·불명확한 과금 보존·삭제 이후 장부, 환경별 예산 allocation의 합계 한도,
실제 quote/FX/funding 및 bounded DB staging 실행 계약을 명시한다.
문서 정합성은 실제 quota 경합·외부 청구·계정 유료 capability 검증의 증거가 아니다.
#57 runtime은 #55 선행 PR 병합 뒤 진행한다.

## #55 DB 통합 candidate와 실제 로컬 검증

DB 소유자의 보존 commit `71ac9f859225c2ea766220883e877b0826e07147`은
`0006_v2_domain_foundation`·typed repository·v2 AAD와 테스트를 포함한다. 최신 main
`16e7dc38f6a37b3e489aa035cf7e11a5bdb72e65`에 별도 통합 브랜치로 병합했으며,
최종 통합 검사·exact-head PR CI·main 병합·원격 migration/deploy는 별도 증거로 남긴다.
#55 완료 전 후속 제품 이슈를 시작하지 않는다.

소유자 checkout의 bun ci/check/build/cf:dry-run과 generated drift/fresh/upgrade가 통과했다.
full check는48개 파일/515개 테스트/123,830 assertions이며 다음 실제 SQLite/AES 경계를
포함한다. 입력은 합성이며 OAuth·모델·법률·R2·Containers·Whisper를 실제 호출하지 않았다.

| 저장소 검증 | 결과와 경계 |
| --- | --- |
| additive migration·기존 v1 | 총82개 테이블, populated0005→0006 데이터/FK/AAD 보존, 기존 API read/answers/retry/delete 회귀 |
| legacy opt-in 전환 | 38개/535 assertions, 실제 v1 nested JSON 서술 추출·구키 read·quota/AI 미사용·256KiB stream·citation/source CAS·SQL 실패 재개·sealed 삭제 |
| 요약 사용자 편집 | 19개/1,580 assertions, 4MiB 초과300facts/30parties/항목별100근거·100항목 편집, 순서/Unicode/이전 snapshot·metadata/pointer CAS·rollback·동시 cursor·삭제 경합 |
| 자료 사용자 편집 | 32개/43,569 assertions, 10,000 observations/20,000 derivatives·1GB 원본/120chunks·255 Unicode 파일명·bounded copy·삭제·SQL rollback |
| metadata·큰 snapshot 읽기 | 17개/535 assertions, 최대 page·4MiB 초과 및20,000frame part stream·owner/tombstone·복호화 중 교체·삭제 뒤 stream 중단 |
| quota·비용·자료·reports·directory·lawyers·jobs·삭제·공식 source | 8개 suite 통합185개/68,938 assertions, 실제 SQL/AES·lease·ownership·CAS·immutable source·공개 승인본 분리·비용 ambiguity·cleanup |
| 기존 v1 별도 회귀 | 26개 파일149개/1,737 assertions, auth/consent/API·분석·암호화·migration·offline eval·Workflow |

full-check 수치와 부분 suite 수치는 중복 집계하지 않는다. 발견한 receipt SQL placeholder,
normalized target metadata 검증, legacy 서술/wrong digest/sealed cleanup와 late job pointer
검증 결함을 수정한 뒤 통과했다. bounded 실행 계약은 [데이터 모델](../architecture/DATA-MODEL.md),
적용/사용 경계는 [DB 운영](../operations/DOMAIN-DATABASE.md)을 따른다.

최신 main을 통합한 root checkout에서도 bun ci/check/build/cf:dry-run이 통과했다.
통합 full check는50개 파일/530개 테스트/125,381 assertions이며 migration drift 없음과
fresh/upgrade 기본6개/29 assertions를 확인했다. foundation smoke8개는 candidate의
정확한 schema marker·이전/미검증 marker 거부·환경·SHA·상관관계·전파 deadline을 검증한다.
이 수치는 PR CI나 실제 원격 migration/deploy 결과를 미리 포함하지 않는다.
별도 local workerd D1에서도0000~0006 migration 모두 적용을 통과했다. 원격 배포 전
preview/production Time Travel bookmark는 비공개 workspace 파일에 보존하며 공개 증거에
실제 bookmark 값을 포함하지 않는다. 이 확보는 restore/replay drill 성공 증거가 아니다.

[PR86](https://github.com/creno-va/baro/pull/86)의 head
`e5c9ea9d1d42a57f029477200031caf571f45e25`는
[필수 CI](https://github.com/creno-va/baro/actions/runs/37387674210)를 통과했다. migration·secret/
dependency·unit·offline eval·build/bundle·synthetic browser/CSP까지 성공했으며 main
`606987e040070932f263fbd0b6c6b2b4cf45266a`에 병합되어 #55는 CLOSED다.
새 main CI·preview/production migration과 smoke는 해당 릴리스의 실제 결과로 별도 연결한다.

같은 main SHA `606987e040070932f263fbd0b6c6b2b4cf45266a`의
[main CI](https://github.com/creno-va/baro/actions/runs/37388194130),
[preview migration/deploy](https://github.com/creno-va/baro/actions/runs/37388786082),
[production foundation migration/deploy](https://github.com/creno-va/baro/actions/runs/37388976910)가
모두 성공했다. 정상 Environment reviewer 승인을 사용했고 production deployment
`6871792005`의 최종 status는 success다. 2026-10-06 KST의 독립 smoke는 두 도메인의
full SHA와 candidate journal tag `0006_v2_domain_foundation`을 확인했다. 별도 원격 aggregate
SQL에서도 양 환경의 v2 선언 테이블67개와 foreign key 위반0을 확인했다. 원문 행은 읽지 않았다.
production `/api/cases`는 HTTP503/`BETA_NOT_OPEN`이다. 이 결과는 실제 DB migration과
foundation 배포이며 실제 OAuth·사건 전체 흐름·v2 역할별 UI·공개 승인 성공이 아니다.

#57 서비스/#63 retrieval에서 새로 확인한 실행 연결점은 [#87](https://github.com/creno-va/baro/issues/87)로
추적한다. DB 소유자가 fresh source cache·atomic paid admission/dispatch·durable 가격/funding/
usage·allocation/carryover를 확장하고 소비자는 새 primitive의 공유 PR을 먼저 통합한다.

#87의 검증된 소스 `27ee8321e7819a04a2c729fabb3b565a9086ee93`는2026-10-06
02:27:46Z에 단독 필수 검사를 완료했다. bun ci는 변경 없는 lock/dependency로 통과했으며
최종 bun run check는52개 파일/568개 테스트/126,157 assertions·실패0,
별도 migration checker6개/29 assertions를 통과했다. build·cf:dry-run·db:generate도
모두 실제 종료 코드0이며91개 application table의 generation drift가 없다. 최대 자료
검증은10,000 observations/20,000 derivatives의 편집·게시·pagination과100MiB/1,600parts
Unicode 저장·스트리밍을 검증했다. 게시·저장의 여러 bounded 단계를 감싸는 host harness
시간만600초로 조정했고 제품 단계별 제한·자료 크기·검증 항목은 유지했다.
root 통합 소스 `0cf6c5e079ff19a285a3f4d7284acfb84ae87d35`와의 직접 diff는 제품·DB·
테스트·도구·설정 차이가 없고 차이는 architecture/operations/검증 문서뿐임을 확인했다.
통합 checkout의 bun ci·문서/그래프/경계·build·cf:dry-run도 통과했다. 별도 격리 local
workerd D1에0000~0007을 모두 실제 적용했고 application table91개/v2 table76개/
foreign key 위반0을 aggregate로 확인했다. 기존 로컬/원격 사건 행은 읽지 않았다.
이 로컬 결과만으로 실제 funding/청구·전체 역할 UI 성공을 주장하지 않는다.

#87은 [PR90](https://github.com/creno-va/baro/pull/90)의
[exact-head CI](https://github.com/creno-va/baro/actions/runs/37404677949)를 통과해
main `0638e42b19579bca356261c3eea36060499da9c5`에 병합되고 CLOSED가 됐다.
같은 SHA의 [main CI](https://github.com/creno-va/baro/actions/runs/37405358551),
[preview 배포](https://github.com/creno-va/baro/actions/runs/37405869467),
[production foundation 배포](https://github.com/creno-va/baro/actions/runs/37407825207)가
성공했다. Production은 기존 Environment의 정상 승인 경로를 사용했으며 deployment
`6874733903`에 연결된다. 2026-10-06 KST의 독립 smoke가 두 실제 도메인의 SHA와
`0007_runtime_paid_execution`을 확인했고 production `/api/cases`는
HTTP503/`BETA_NOT_OPEN`을 유지한다. 이 foundation 결과는 실제 자금/청구나 OAuth·
파일 처리·전 역할 UI·운영 drill·공개 승인 성공을 대신하지 않는다.

이 증거는 저장 primitive와 migration의 검증이다. 아직 HTTP/UI가 연결되지 않은 v2 기능,
실제 외부 처리·운영 drill·공개 승인·전체 서비스 배포 완료를 주장하지 않는다.

## 후속 Gateway와 미디어 검증 준비

Gateway [draft PR88](https://github.com/creno-va/baro/pull/88)의 head
`59c08eadd43349a0ded6389dae59177d562b2747`는
[필수 CI](https://github.com/creno-va/baro/actions/runs/37402610309)를 통과했다.
544개 테스트/125,535 assertions와 synthetic browser28개/CSP3개, schema drift·dependency/
secret·offline eval·build/bundle 성공이다. 별도 로컬 집중17개/180 assertions와 제품·도구
TypeScript 검사가 통과했다. 각 실제 시도의 receipt·ambiguous exposure와 미호출 CAS 경계를
검증하며 private 전체 binding input digest로 같은 크기의 다른 prompt/correction을 구분한다.
digest는 token/vision 상한 증거가 아니다. #87 공유 DB는 PR90으로 병합됐지만
#57 trusted factory·실제 가격/funding/청구 대조는 미완료이며 PR은 draft다.
공유 요청 생성/identity 함수는 `52e4ed4`에서 실제 dispatch와 planner가 사용하도록 분리했고
집중17개/180 assertions·제품/도구 TypeScript·Biome 검사를 통과했다.
최대 자료 검사의 전체 host harness 시간을 조정한
#87 통합 후 최신 source의 로컬 mandatory를 순차 재검증한다. 제품의 단계별 제한과 자료
크기·검증 항목은 줄이지 않는다.

미디어 [draft PR89](https://github.com/creno-va/baro/pull/89)의 head
`230273e3bd9e2c7a8d4113e60f6b1dfbec8a771b`는11개 합성 입력(644,318bytes)을 보존한다.
PDF/TXT/PNG/JPEG/WAV/MP4와 형식 불일치·잘린 컨테이너 입력을 포함하며 repository 구조
검사와 private receipt 대조·Git 원본 바이트 비교를 통과했다. 제작 과정의 PDF 전체 페이지
렌더/본문·이미지·PCM·전체 영상 decode·장면/트랙 확인과 한계는 fixture README에 기록했다.
이는 #59의 독립 fixture 준비이며 #57/#58 선행이나 최대 크기/포맷 전체 지원 검증을 대체하지
않는다. 실제 ASR/OCR/vision/Containers/R2/preview 처리는 미검증이고 #59는 OPEN이다.

## 2026-10-06 구현 병합과 저장소 검증

사용자는 후속 개발을 선행 구현 PR의 CI 성공과 main 병합으로 진행하도록 승인했다.
기존 Goal은 삭제됐고 기능 구현·검증·배포 루프로 진행한다. `implementationPr`는
검토된 전체 구현에만 지정하며 남은 실제 외부 검증과 공개 승인 이슈는 OPEN으로 보존한다.

#57은 [PR88](https://github.com/creno-va/baro/pull/88)의 최종 head
`4d36fdf5b832649cdbc7d25721d50895e838a9ff`에서
[CI](https://github.com/creno-va/baro/actions/runs/37408770362)를 통과했다.
617개 테스트/126,730 assertions, migration6개/29 assertions, synthetic browser28개/
CSP3개와 필수 검사 성공이다. 같은 소스의 로컬 bun ci/check/build/cf:dry-run도
2026-10-06 03:31:49Z에 모두 실제 종료0을 확인했다. main
`a255778b85e03682869df5609ddeeee1a2b055f7`에 병합했고
[main CI](https://github.com/creno-va/baro/actions/runs/37409564355)와
[preview 배포](https://github.com/creno-va/baro/actions/runs/37410054881)가 성공했다.
독립 실제 preview smoke가 full SHA와 `0007_runtime_paid_execution`을 확인했다.
실제 자금·처리 비용·청구 검증은 #71에 남아 있으며 #57은 OPEN이다.

#63은 [PR91](https://github.com/creno-va/baro/pull/91)의 최신 통합 head
`ce8f8cd4b0f1d8d92b1cff8008d6d969b377bc4c`에서
[CI](https://github.com/creno-va/baro/actions/runs/37410046541)를 통과해 main
`f46424c59ed498ddb76163bf45fb1b2bdfd38b1e`에 병합했다. 원본 소스의 로컬
필수4개 명령은 모두0이며651개 테스트/126,530 assertions와 migration6개/29 assertions를
통과했다. main 통합의 소유 제품/테스트/fixture 직접 diff는0이다. 실제 configured OC와
외부 원문 조회·품질 검증은 #69/#71에 남아 있으며 #63은 OPEN이다.

같은 main `f46424c59ed498ddb76163bf45fb1b2bdfd38b1e`의
[main CI](https://github.com/creno-va/baro/actions/runs/37410453836),
[preview 배포](https://github.com/creno-va/baro/actions/runs/37410934633),
[production foundation 배포](https://github.com/creno-va/baro/actions/runs/37411162473)가
성공했다. production은 기존 Environment reviewer의 정상 승인을 거쳤고 deployment
`6875267235`에 연결된다. 독립 실제 preview/production smoke가 같은 full SHA와
`0007_runtime_paid_execution`을 확인했고 production `/api/cases`는
HTTP503/`BETA_NOT_OPEN`이다. 이는 #57/#63 구현의 foundation 배포이며 실제 전체 UI·
파일 처리·funding/청구·OAuth·운영 drill·공개 승인 성공을 대신하지 않는다.

#58의 preview/production private/public R2 버킷4개를 실제 생성했다. 두 private 버킷에
임시 합성 암호문을 실제 업로드·다운로드해 바이트 일치를 확인하고 삭제했다. 공개 도메인은
활성화하지 않았다. 이 검증은 R2 리소스/CLI roundtrip 증거이며 사용자 로그인·파일 API·
전체 미디어 처리·승인된 public profile 게시 성공을 대신하지 않는다.

## 2026-10-06 파일 저장 구현 배포와 처리 계정 준비

#58은 [PR92](https://github.com/creno-va/baro/pull/92)의 최종 소스
`3ee9d966e7ab7012ddd388f09f7318a0372afa01`에서
[CI](https://github.com/creno-va/baro/actions/runs/37412084444)를 통과했다.
744개 테스트/127,502 assertions와 migration6개/29 assertions, 필수 source·build·browser·
CSP·Worker 검증이 성공했다. 같은 소스의 로컬 bun ci/check/build/cf:dry-run도
2026-10-06T04:17:17Z 모두 종료0으로 완료했다. 실제 외부 admission·비용·처리와 전체
삭제 인벤토리 검증이 남아 있으므로 #58은 OPEN이다.

병합 main `44adf2477a0f1d9831181d502d9b5de31df32b81`의
[main CI](https://github.com/creno-va/baro/actions/runs/37412692938),
[preview 배포](https://github.com/creno-va/baro/actions/runs/37413185065),
[production foundation 배포](https://github.com/creno-va/baro/actions/runs/37413597198)가
성공했다. production은 정상 Environment 승인을 거친 deployment `6875650196`이다.
독립 실제 두 도메인 smoke에서 같은 full SHA와 `0007_runtime_paid_execution`을 확인했다.
production `/api/cases`는 HTTP503/`BETA_NOT_OPEN`을 유지한다.

Containers 조회는 최초 Workers Paid 필요 오류를 반환했다. 사용자가 계정 플랜을
활성화한 뒤 2026-10-06T04:29Z 실제 BARO 계정의 `wrangler containers list`가
종료0/`No containers found`를 반환했다. 접근 조건은 충족했지만 아직 Container image·
resource 배포, 실제 처리/Whisper/vision, 비용·청구·최대 자료 측정 증거는 아니다.
구독 API는 현재 Wrangler 인증 범위에서 HTTP403이며 개인 결제정보·인증값은 기록하지 않았다.

## 최종 감사

각 원래 Goal 항목과 PRD 요구사항을 위 ledger 및 UX 시연에 대응시킨다. 누락된 기능이나
승인·명령·artifact·실패 조건이 있으면 완료하지 않는다. 모든 역할의 실제 동작, 다운로드 내용,
저장/삭제/복구, 외부 제공자, 같은 릴리스 배포, 공개 승인 근거까지 강한 증거로 확인한 뒤에만
milestone 5를 완료한다. 기존 Goal은 삭제됐으며 이번 기록은 이후 실제 성공을 미리 기록하지 않는다.
