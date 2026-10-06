# BARO v2 검증 증거 기록

- 최신 통합 기록: 2026-10-07 (아래 4세션 통합 재검증). 초기 표와 이전 SHA의 증거는 역사적 기록으로 보존한다.
- 상태: #53 명세·#54 strict 계약·#55 additive DB·#56 공통 UI 시스템 완료. 후속 서비스 실행·화면·외부 연동·공개는 진행 중이며 전체 완료 증거 없음.
- 마일스톤: [전체 서비스 개발](https://github.com/creno-va/baro/milestone/5)
- 실행 정본: [V2 실행 계획](./V2-EXECUTION.md), 개정 PRD/UX와 실제 GitHub 이슈

## 증거 작성 계약

각 성공은 requirement/scenario ID, full candidate SHA, 환경, 실행 시각, 역할, 실제/대역 구분,
결과, run/receipt/안전한 화면 artifact를 연결한다. 실제 사용자의 사건·사진·변호사 자격 서류,
cookie·token·secret·인증 URL·stack/SQL은 증거에 포함하지 않는다.
릴리스별 증거를 새로 기록하고 과거 SHA의 녹색 CI나 health를 현재 기능 승인으로 쓰지 않는다.
관측 실패·missing·pending·mock-only는 통과가 아니다.

## 초기 요구사항과 증거 소유자 (역사적 계획)

ADR-0014 이후 MVP는 고객/변호사 두 역할이며 자격 심사·승인대기·반려·어드민 UX는 제외한다.
아래 초기 계획의 심사 행은 현재 개발 요구사항이나 공개 승인 증거로 재사용하지 않는다.

| 초기 요구사항 | 코드/계약 이슈 | 실제 검증 | 당시 판정 |
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

## 2026-10-06 처리 이미지의 실제 Linux 검증

#59 작업 소스 `0ef114d69194736719cd590e9d6ca1084f27cf8f`의
[PR CI](https://github.com/creno-va/baro/actions/runs/37417158857)는 성공했다.
linux/amd64 이미지의 실제 빌드와 네트워크를 차단한 native document/image/audio/video
fixture가 성공했다. 장면 전환과 31초 영상의 두 처리 구간에서 절대 timestamp/frame index,
구간 경계, 누락 없는 샘플을 검사했다. 장면 후보 threshold와 동일 임시 디렉터리의
출력 재사용 오류를 수정한 실제 Linux 결과다. Source/browser 검사와 최종 Quality gate도
같은 SHA에서 성공했다. Native 검사는 독립 CI job으로 병렬 실행하며 두 job 성공이
최종 Quality gate의 필수 조건이다.

이는 합성 자료의 실제 native 실행 증거다. 이후 추가한 비용·공개 사본·Workflow 연결의
최종 소스 검증, Cloudflare Container resource 배포와 live 처리/ASR/vision, 실제 청구와
전 역할 UI는 별도 검증이 필요하다. #59/#60을 완료하거나 외부 gate를 해제하지 않았다.

## 2026-10-06 작업 없는 저장 비용 계약의 실제 배포

#93은 [PR94](https://github.com/creno-va/baro/pull/94)의 소스
`c883a5e0c3a66fe03fd746b5d5d83dbf9081101f`에서 로컬 필수4개 명령과
[동일 소스 CI](https://github.com/creno-va/baro/actions/runs/37421508201)를 통과했다.
병합 main `731e7756a30b1ffd75f64b3166da127dccf5ca08`의
[main CI](https://github.com/creno-va/baro/actions/runs/37422147323),
[preview 배포](https://github.com/creno-va/baro/actions/runs/37422506968),
[production 배포](https://github.com/creno-va/baro/actions/runs/37422772171)가 성공했다.
Production은 기존 Environment reviewer의 정상 승인을 거친 deployment `6877091498`이다.
독립 실제 두 도메인 smoke에서 같은 full SHA와 `0008_storage_paid_execution`을 확인했다.
Production `/api/cases`는 HTTP503/`BETA_NOT_OPEN`을 유지했다.

실제 Cloudflare 콘솔에서 Workers Paid가 현재 플랜임을 확인했다. AI Gateway에는 기존
$10 credit이 표시되며 auto recharge는 OFF였다. 표시 잔액이나 반올림된 사용량을 실제
처리 청구 검증으로 간주하지 않았다. 아직 배포된 Container resource·실제 미디어 처리·
전 역할 UI의 성공 증거는 없으며 #93/#59/#60/#71은 필요한 외부 검증을 OPEN으로 보존한다.
반복 보관과 물리 R2 용량의 선결 계약은 #95에서 별도로 검증한다.

## 2026-10-06 사건 intake·지속 대화 구현 (#64)

사건 생성/저장/목록, 세 번의 적응형 질문 묶음(최대 다섯 문항), 모름/건너뛰기,
요약 수정/확인, 확인 이후 지속 대화와 사실·당사자·행동·타임라인의 원자적 저장을
Workers Workflow와 소유자 전용 API에 연결했다. 요청 키 재실행, revision 충돌,
실패 작업 재시도, 지연 dispatch를 처리한다. 모델 호출은 기존 pinned Gateway를 사용하고
공식 조회는 서버가 허용한 공개 법률명/일반 개념으로만 요청한다.

사용자 지시에 따라 전체 사례/회귀를 반복하지 않았다. 변경 기능 테스트 6개/49 assertions,
도구 TypeScript 검사, 제품 build와 Worker dry-run이 통과했다. 새 schema/migration은 없다.
합성 모델 adapter로 질문→답변→요약 수정/확인→지속 대화의 DB 저장을 확인한 결과이며
실제 모델 성공이나 UI 시연으로 표시하지 않는다.

실제 실행에는 배포 소유 `AI_MODEL_TOKEN_BOUNDS_JSON`과 기존 pricing/funding/allocation
증거가 필요하다. 미설정 시 사건 원문은 보존하고 유료 작업만 거절한다. 외부 모델 V18 및
OAuth/파일 처리/전 역할 UI는 #71에서 확인하며 #64의 외부 검증 상태를 대신하지 않는다.

## 최종 감사

2026-10-06 #61은 공개 directory/detail API와 검색·프로필 화면을 연결했다. 이미 승인된
공개 projection만 읽으며 이름·지역·분야 필터, 한국 시간 일일 회전과 5분 snapshot cursor,
공급 부족/오류/재시도, URL 검색 조건 복원을 제공한다. 승인 사진/포트폴리오는 현재 공개
revision과 hash/size/type를 확인하고 #95의 단일 maintenance GET 허용 후 스트리밍한다.
자격 철회·공개 pointer 변경·삭제 후 새 요청과 진행 중 stream은 거부된다.
320px 실제 browser의 검색→empty→새로고침→상세→연락/지도 링크 및 axe 검사를 통과했고
합성 화면을 직접 확인했다. 외부 지도에는 공개 사무실 주소만 전달한다. 합성 승인과
browser interception은 실제 자격·R2·외부 provider 검증이 아니며 #71에 남긴다.
`bun ci`, 전체 `bun run check`(1,104 pass/0 fail, 131,676 assertions 및 migration 6 pass),
최종 typecheck/build/dry-run을 통과했다. Browser 29개와 directory 2개 시나리오 및
수정한 독립 50-corpus 평가를 통과했다. 정상 built Worker의 CSP 4개 검사도 통과했다.
50-corpus는 account 교체 전에 이전 document를 종료해 기존 인증 요청과 다음 navigation의
경합을 제거했으며 임의 sleep/retry로 숨기지 않았다. 최종 PR의 동일 head CI는 별도로 확인한다.

각 원래 Goal 항목과 PRD 요구사항을 위 ledger 및 UX 시연에 대응시킨다. 누락된 기능이나
승인·명령·artifact·실패 조건이 있으면 완료하지 않는다. 모든 역할의 실제 동작, 다운로드 내용,
저장/삭제/복구, 외부 제공자, 같은 릴리스 배포, 공개 승인 근거까지 강한 증거로 확인한 뒤에만
milestone 5를 완료한다. 기존 Goal은 삭제됐으며 이번 기록은 이후 실제 성공을 미리 기록하지 않는다.
## 2026-10-07 4세션 통합 재검증

통합 세션은 clean main `ca6e15b1226ebdfaf3eee98b07b993cdb303f873` (PR125)에서
`codex/71-integration-release`와 별도 checkout을 만들었다. #57/#63/#69/#19/#27/#71에
소유 기록을 남겼으며 고객 #64/#65, 파일/native/report/delete #58/#59/#66/#67,
변호사/정책 #62/#68의 모듈 내부 편집은 각 세션에 유지한다. 공유 contracts/schema/router/
auth/session/global shell/CI와 통합 증거는 통합 세션이 소유한다. 신규 migration 요청은 없고
현재 marker `0009_storage_capacity_maintenance`를 보존한다. 새 agent/Goal/automation은 없다.

| 기준 immutable SHA의 확인 | 실제 증거와 한계 |
| --- | --- |
| main CI | [37481561242](https://github.com/creno-va/baro/actions/runs/37481561242) 성공 |
| preview 배포 | [37482464416](https://github.com/creno-va/baro/actions/runs/37482464416) 성공; 독립 foundation smoke의 full SHA/ready/schema 일치 |
| production 배포 | [37481730002](https://github.com/creno-va/baro/actions/runs/37481730002) 정상 Environment 승인 경로 뒤 성공; 독립 foundation smoke 일치 |
| 배포 전 smoke 실패 | production 완료 전 조회는 이전 SHA여서 wrong-release로 거부; 완료 뒤 재검증 성공. 실패를 배포 성공으로 바꾸거나 삭제하지 않음 |
| Full validation | [37483052100](https://github.com/creno-va/baro/actions/runs/37483052100) 실패: browser9 fail/14 skip/34 pass. native 성공. mock 전용 테스트가 real adapter에 실행됐으며 corpus harness는 /src/client/api/ asset까지 가로챘다. 실패 보존·runner/경로 수정 후 새 candidate에서 재검증 |
| 로컬 기준 검사 | 1,199 tests/132,525 assertions 실패0; 초기 db:check는 bunx PATH 누락으로 실패. 런타임 PATH 보완 뒤 drift 없음·fresh/upgrade 6 tests/29 assertions 성공 |
| 실제 preview browser | 동일 제품 login→합성 session→합성 consent→고객 홈의 실제 hydration 확인. API mock 시연이며 OAuth 성공이 아님 |

현재 [preview](https://preview.baro.site)는 `PUBLIC_API_MODE=mock`으로 빌드된 동일 제품 UI다.
[production](https://baro.site)는 real adapter와 비공개 foundation gate를 사용한다.
코드/health/CI 성공은 로그인·AI·공식 법률·파일 처리·청구·삭제/복구 drill 또는 공개 승인
성공을 뜻하지 않는다. #19/#20/#27/#70/#71 및 milestone 4/5는 외부 증거 없이 닫지 않는다.

공유 수정 후보는 사용량 API의 저장된 가격/자금/allocation 증거 조회 누락을 연결하고,
고객 사건 API의 signed owner accountType 경계를 추가한다. lawyer usage/account deletion은
유지하며 선택 역할이 moderator/verified 권한을 생성하지 않는다. 공용 client는
ROLE_REQUIRED를 기존 NOT_FOUND 화면 purge 경계로 안전하게 변환한다. 모듈의 별도
workspaceResponse 변환은 #65 담당자에게 요청했다. mock private namespace도 동일 역할
경계를 검사한다. 신규 실제 funding/가격/FX 증거·비용 지출은 생성하지 않는다.

공유 사용량 집중 검증은 실제 SQL/서명 session과 **합성** durable proofs로 진행했다.
유효 증거 표시, 잘못된 환경, KST 월 경계, frozen control, 만료/immutable 증거, 전액 사용,
조회가 비용 예약·차감을 만들지 않는 경계를 확인했다. 같은 owner의 customer→lawyer 변경은
기존 v1 사건/analysis/delete와 v2 workspace/chat/files/delete 접근을 차단하고 customer로
복귀하면 기존 사건을 유지한다. 최종 소스의 mandatory/PR CI는 별도로 연결한다.

현재 외부 실행 제한과 필요한 사람 조치는
[환경 readiness](../operations/ENVIRONMENT-READINESS.md#2026-10-07-통합-세션의-현재-readiness)를
따른다. 공식 법률 신청/OC 조건은 변하지 않아 같은 실패 probe를 반복하지 않았다.


공유 Full validation runner는 wire browser와 각 mock config를 같은 checkout에서 순차 실행한다.
50-corpus는 signed v1 실제 API/SQL 대역 및 제품 legacy compatibility 화면으로 검증하며,
v2 모델 품질/실제 공식 근거 승인으로 확장해 표시하지 않는다. corpus harness의 경로 검사는
`/api/` 정본만 전달하고 Vite의 `/src/client/api/` asset은 원래 dev server에 유지한다.
session 변경은 credential/role을 포함하지 않는 `baro-session-changed` marker로 peer 탭에
재조회만 요청하며 로그아웃·동의·persisted role 변경 후 발행한다. 공유 shell은 이 marker와
기존 Better Auth 알림을 받아 최근 사건과 역할 navigation을 재검증한다.


공유 candidate의 집중 browser 검사는 wire35, compiled Worker corpus1(50합성 사례),
integration3, conversation7, intake6, shared-workspace1, workspace4, reports1로 **58개**
통과했다. workspace 4342는 다른 checkout이 사용해 통합 소유 검사만 중단하고
`BARO_WORKSPACE_UI_PORT=4442`로 나머지3 config를 순차 검증했다. 다른 checkout 서버는
변경/종료/재사용하지 않았다. 최종 CI는 별도 fresh runner에서 전체 runner를 실행한다.
새 '이용 유형 변경' 링크가 메뉴의 마지막 tabbable이 되므로 built CSP의 focus-wrap
기대도 이 실제 순서에 맞춘다. 최초 기대 불일치 실패는 보존하고 재검증한다.

PR126 head `af070a3e9af6c489d28847796b7a1915dd2f8290`의 CI
[37486565424](https://github.com/creno-va/baro/actions/runs/37486565424)는 공용 sharp
advisory audit에서 실패했다. [공식 advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)의
patched0.35.5를 정확히 고정하고 lockfile을 갱신했다. 전체 dependency upgrade나 audit
우회는 하지 않았으며 새 로컬 audit는 취약점0이다. 변경된 의존성 candidate의 mandatory
검사·빌드·browser/CSP·exact-head CI는 별도로 다시 연결한다.

공식 retrieval/citation의 현재 제품 경계는 v2 bounded transport의3회 이내 attempts/
30calls/응답 byte·deadline 한도, official ID/version/date/URL/hash 재검증 및 request-local
권한/동의 재검사다. unavailable과 claim rejection은 유지하며 승인 오류를 모델 기억으로
대체하지 않는다. 보존한 PR120 benchmark 추천 patch는 아직 제품 적용되지 않았다.
실제 공식 응답 승인/ID 검증 성공과 live 전체 AI 품질은 입증하지 않았다.

sharp0.35.5 반영 후 frozen `bun ci`와 `bun run check`를 다시 실행해 1,203 tests /
132,600 assertions, migration6/29 및 schema drift 없음으로 통과했다. 같은 checkout의
fresh production build·`cf:dry-run`·최종 browser58개도 모두 통과했다. 이 수치는 실제
SQLite/서명 session 및 합성 transport/증거를 구분한 로컬 결과이며 새 immutable PR의
CI/Full validation와 배포 smoke는 후속 기록으로 연결한다.

quota·예산 회귀는 `usage-service`, `budget-service`, `budget-accounting`,
`budget-gateway-ledger` 테스트의 KST 일/월 경계, 원자적 동시 예약, retry별 실제 meter
receipt와 logical user quota1회, 100만원 상한·정확한 FX decimal rounding,
불명확 비용 보존·삭제 후 늦은 next-month receipt·정산 SQL rollback을 포함한다.
이는 실제 공급자 청구서를 대조한 비용 reconciliation이 아니라 합성 receipt를 쓰는
runtime/SQL 검증이다. 사용자 quota 조회는 추가 hold/charge를 만들지 않는다.

최종 built Worker CSP는4개 통과했고 합성 fixture 전용1개는 정상 production build에
포함되지 않아 명시적으로 skip했다. 새 navigation 순서의 keyboard focus-wrap과 모바일
메뉴·local font·실제 hash CSP·주입 script 차단을 확인했다. production fixture 제외는
별도 bundle 검사로 유지한다.

공유 PR127은 head `5b3d46637e9c7ac1d576cef02a022efef37dcb19`의
[CI37487759856](https://github.com/creno-va/baro/actions/runs/37487759856) 필수3 jobs 성공을
확인한 뒤 main `79434963086e1cea81e2b2785dd30083b2c49995`로 병합했다. self APPROVE와
admin 우회는 사용하지 않았다. 각 모듈에 최신 main role/peer-tab/CI 재검증을 요청했다.
같은 PR head의 [Full validation37487782522](https://github.com/creno-va/baro/actions/runs/37487782522)는
모든3 jobs 성공했다. Linux native media fixtures, drift/fresh/upgrade6/29,
1,203 tests/132,600 assertions, browser58(50-corpus 포함), CSP4/fixture-only skip1,
production bundle145 files와 dry-run이 통과했다. 별도 immutable 증거이며 최종 모든 모듈
통합 SHA의 검증을 대신하지 않는다. 초기 main의 실패 run은 계속 보존한다.

metadata-only [readiness37488784651](https://github.com/creno-va/baro/actions/runs/37488784651)의
[allowlisted JSON](../quality/integration-2026-10-07/preview-readiness-7943496.json)을 보존했다.
candidate7943496에서 실행했지만 관측된 deployed SHA는 아직 이전 ca6e15b다. OAuth6개
client 설정·model bounds 없음, processing bindings5개·preview Turnstile widget1개 존재,
Gateway metadata API403을 확인했다. API403은 인증된 console 관측을 취소하지 않으며
Gateway 호출 실패 증거도 아니다. 법률 단계는 실행하지 않았다.

후속 공유 검토는 변호사 private mock operation의 역할 검사를 cache replay 이전에 보완하고,
예정된 `/v2/reports/*`의 private/no-store/nosniff middleware를 먼저 준비한다. public directory/
detail/공개 asset은 anonymous 조회를 유지한다. 별도 reports DomainRequest mock 경계는
담당 #66/#67에 재현·수정 요청을 남겼으며 공용 namespace guard가 적용된 것으로 오기록하지 않는다.

후속 공유 candidate의 frozen ci/check는1,204 tests/132,606 assertions와 drift/fresh/upgrade6/29,
fresh production build/dry-run/bundle145 files, 공용 login/intake/workspace/report/delete 및
lawyer mock browser3개, built CSP4개/fixture-only skip1로 통과했다. 새 role replay 테스트의
임시 handler는 검사 뒤 복원하며 실제 도메인 handler를 다른 테스트에 남기지 않는다.

고객 PR128의 구체적인 DTO 요청을 받은 뒤 WorkspaceView에 기존 V2Summary facts/parties를
재사용한 optional facts/people와 unknowns/notices를 공용 types/facade 계약에 반영한다.
고객의 local CustomerWorkspaceView는 호환되며 공유 서버 schema/migration은 바꾸지 않는다.

PR128이 제공한 customer-real.e2e/config의 별도60초 real transport 환경을 공용 runner에
순차 연결한다. 모듈 파일이 도착해 해당 target이 선택될 때만 config를 실행하므로 선행
공유 candidate에 모듈 코드나 fixture를 복사하지 않는다. 최종 소비자 branch의 최신 head CI로
실제 결합을 검증한다. runner 추가 뒤 전체 check/build/dry-run도 다시 통과했다.

main7943496의 [CI37488768849](https://github.com/creno-va/baro/actions/runs/37488768849)와
[preview37489693444](https://github.com/creno-va/baro/actions/runs/37489693444)가 성공했고,
별도 full SHA/schema0009 foundation smoke도 통과했다. 실제 IAB에서 저장된 합성 사건의
재접속·메뉴 Enter/ShiftTab wrap·Escape opener 복귀와 새 이용 유형 변경 링크를 확인했다.
IAB viewport override는 실제CSS760px로 남아 원격320px 성공으로 기록하지 않는다.
Chromium320px/200% 회귀는 별도 compiled/fixture browser 증거다.

공유 PR129는 latest head `d86a406a92d22606195802a1162a4eb8d9cb5e59`의
[CI37490993750](https://github.com/creno-va/baro/actions/runs/37490993750) 필수3 jobs가
성공한 뒤 main `a5130db48d673d27ce1b928c255285e2cb680ca0`로 정상 병합했다.
해당 changed-scope CI의 native job은 변경 없음으로 native 실행 단계가 skip됐으며,
실제 native 실행 증거는 앞선 Full validation와 최종 통합 candidate의 별도 run으로 구분한다.
정식 self APPROVE·admin protection 우회는 하지 않았다. #126/#128 및 #66 담당에 최신 main
rebase와 정확한 최종 head 재검증을 요청했다. reports factory는 모듈 최종 PR 통합 뒤 연결한다.

`bun run work:next` 재조회에서도 #57/#58/#59/#63은 IMPLEMENTATION_MERGED,
#19/#20/#27/#62/#64/#65/#66/#67/#68/#69/#71은 IN_PROGRESS, #70은 EXTERNAL이다.
공유 코드·합성 browser 성공으로 외부·공개 gate나 milestone을 완료 처리하지 않았다.

main a5130db의 [CI37491846210](https://github.com/creno-va/baro/actions/runs/37491846210)은
공유 design-system fixture의 role prop과 실제 session hydration 경쟁 때문에 browser
34PASS/1FAIL이었다. 로그인 부재가 확인되면 visitor로 전환하는 제품 경계는 유지한다.
fixture의 exact session API를 합성 customer/lawyer/anonymous로 제어하고 focus 재검사 뒤
메뉴를 검사하도록 수정해 local design-system6개가 통과했다. 제품에 fixture role override나
auth bypass를 추가하지 않았다. 이 실패 run 및 고객9b8ba19의 전용 API browser 실패
[37492036664](https://github.com/creno-va/baro/actions/runs/37492036664)는 보존하며 최신 head로
재검증한다. 고객 모듈의 focus/transient-session error 검토는 PR128 담당에 요청했다.

PR126은 최신 head `0faf7e961c59b2867000af6d5b6a383815b9d151`의
[CI37492533305](https://github.com/creno-va/baro/actions/runs/37492533305)3 jobs 성공과 실제 diff를
확인한 뒤 main `e619cb8beb47dcb103cd422d7189ba24819d54d2`로 정상 squash 병합했다.
self APPROVE/protection 우회 없음. 실제 외부/정책 승인과 구분한다.

리포트 모듈 PR130의 900MB/256KiB chunk별 source 재검사가 D1 invocation query 한도와
고정 d1_rows_read 비용 bound를 넘을 수 있어 모듈 담당에 P1 수정 요청을 남겼다.
[리뷰](https://github.com/creno-va/baro/pull/130#issuecomment-6020306652)는
[공식 D1 limits](https://developers.cloudflare.com/d1/platform/limits/)와 실제 코드 경로를
연결한다. 원본 I/O 전에 정량적 계획을 거부하고 owner/role/consent/삭제/lease/revision
stream fence를 유지하는 검증이 필요하다. 실제 maximum ZIP 성공으로 기록하지 않는다.

공유 후속 변경은 정확한 report review PATCH만131,072 bytes로 제한해 한글30,000자 저장을
허용하고, 다른 JSON/유사 경로/POST는 기존65,536 bytes를 유지한다. Content-Length 없는
초과 stream 거부도 검증한다. 직접 v2 account repository는 동일 recent OAuth predicate의
atomic batch에서 exact account-type metadata와 user를 삭제한다. SQL trigger/cascade가
포함되므로 영향 행 집계 대신 DELETE RETURNING의 owner ID로 성공을 확인한다.
owner session 거부/만료/미래 재인증, 다른 owner metadata 보존, SQL 실패 시 metadata·user·
journal 복구의 실제 SQLite 회귀를 포함한다. facade와 publishMine 계약 문서는 기존
모듈의 profileId/expectedRevision/published/consent 요구를 반영한다. schema/migration 변경 없음.

### 4세션 후속 통합과 외부 증거의 현재 경계

공유 PR131 final head `f8ed6e38e53d5767d9845b2884f21d0a1b4bfb06`의
[CI37493048253](https://github.com/creno-va/baro/actions/runs/37493048253)3 jobs 성공을 확인하고
main `5e094b709a0656bed21948d60d34039662e589bf`로 정상 병합했다.
동일 SHA의 [main CI37493558489](https://github.com/creno-va/baro/actions/runs/37493558489),
[preview37493898259](https://github.com/creno-va/baro/actions/runs/37493898259), 별도 full-SHA/
schema0009 smoke는 성공했다. 이전 PR129 후 main fixture 실패를 성공으로 바꾸지 않았다.

고객 PR128 final head `e49edd9e22b0065a95d3bae45a7c855d46757e6c`의
[CI37493874301](https://github.com/creno-va/baro/actions/runs/37493874301)3 jobs 성공과 실제 diff를
검토하고 main `c6b96656ee6e4d7c968486b47a994b2807bdeadd`로 정상 병합했다.
[main CI37494685736](https://github.com/creno-va/baro/actions/runs/37494685736)와
[preview37495363389](https://github.com/creno-va/baro/actions/runs/37495363389)는 성공했으며
독립 smoke도 동일 full SHA/schema0009를 확인했다. protected CI나 self APPROVE 우회 없음.
공유 PR132는 고객 통합 main에 rebase한 `d73a9d3f97810cfcbd1ca3fab6d31114f4f86465`에서
frozen ci/check1225 tests/133026 assertions, drift·fresh/upgrade6/29, build/dry-run을 통과했다.
정확한 PR head CI와 최종 모든 모듈 SHA의 Full validation는 별도 기록한다.

5e094b7 preview의 실제 IAB에서 API 예시 모드를 명시한 합성 변호사로 역할 선택·합성 동의,
프로필·합성 PNG 사진·합성 PDF 포트폴리오 저장, reload 후 복원, 공개 설정·디렉터리·공개
상세를 확인했다. 공개 상세에는 합성 정보임을 명시했다. screenshot은 ignored
`.wrangler/integration/preview-5e094b7-lawyer.jpg`에 보존했다. IAB의 portfolio download event는
10초 내 관측되지 않아 이 browser에서 파일 다운로드 성공으로 기록하지 않는다.
별도 Chromium/SQL 다운로드 증거와 구분하며 실제 OAuth/R2 공개 copy 증거가 아니다.

PR130 published19295aeb의 ZIP P1 후속은 입력 기반 예상800/전체900 query·source250행 한도,
request-local dispatch 계수와 actual D1 row metadata 검증, single-query stream source fence를
제공한다. [후속 리뷰](https://github.com/creno-va/baro/pull/130#issuecomment-6020690222)에
원본 I/O 전 초과 거부·작은 선택 재시도·권한/동의/동일 revision 변경 회귀를 연결했다.
900MB/100개는 입력 절대 상한이며 한 번의 synchronous ZIP 성공 범위가 아니다.
Paid HTTP 기본 CPU30초와 코드 cost maximum300000ms는 별개다. 실제 CPU/deadline,
remote row scans·billing·제품 처리/삭제는 미검증이며 global CPU 설정을 임의 확대하지 않는다.

readiness의 Gateway403 원인이 바뀌지 않았으므로 기본 probe를 명시적 opt-in으로 변경한다.
`check_gateway=false`의 not_requested/null은 존재·인증·호출 성공이 아니다. 법률도 신청/OC
조건 변경 증거 전에는 재호출하지 않는다. 7개 processing binding의 존재를 점검하되 secret 값,
bucket/namespace ID, model bounds 내용은 출력하지 않는다. 정상 production bundle에 API mock/
test fixture를 넣거나 synthetic pricing/funding을 실제 DB proof로 채우지 않는다.

공유132의 d73a9d3 [CI37494702283](https://github.com/creno-va/baro/actions/runs/37494702283)는
regular browser38 PASS/3 FAIL이었다. analytics fixture의 고객 session 응답 누락2개와,
menu trigger가 effect에서 enabled되기 전 Enter를 보낸1개를 수정해 focused4개가 통과했다.
5f5e818에서 frozen ci/check1225/133026·migration6/29·build/dry-run도 다시 통과했으며 새
exact-head CI37496257599를 요구한다. 제품 인증·역할·hydration guard 완화 없음.
PR13019295aeb의 [CI37495417013](https://github.com/creno-va/baro/actions/runs/37495417013)는
Linux native 실행 SUCCESS, source browser16 PASS/2 FAIL이었다. settings의 재인증 marker/
이전 화면 비동기 응답 경합을 [모듈 담당에 인계](https://github.com/creno-va/baro/pull/130#issuecomment-6020740933)했다.
이전 head의 실패를 새 head의 검증으로 지우지 않는다.

PDF 스킬의 읽기 전용 검사에서 모듈의 대역 다운로드 PDF 첫 페이지와 긴 리포트 마지막
페이지의 한글/마스킹·번호·여백을 확인했고 pypdf로13페이지·400행·마지막 문장 보존 및
전화번호/이메일 제거를 검사했다. 이는 해당 합성 artifact의 검사이며 최종 릴리스/원격 비용
증거가 아니다. 최종 candidate의 signed SQL 다운로드는 전용 no-webServer/60초 config에서
순차 실행한다. source-only report/global router 변경도 이 소비자 검사를 선택한다.

01:33 KST Cloudflare D1 인증된 목록에는 보호 preview/production2개만 있다. 로컬 CLI는
인증 부재이며 격리 restore 등록부·DB 밖 최신 journal·키 담당·rollback version·실제 alert
수신/ack가 없으므로 보호 DB를 drill 대상으로 사용하지 않았다. #19/#27/#70/#71 및
milestone4/5는 이 관측이나 CI/health만으로 완료하지 않는다.

공유 PR132 final head `5f5e818173ba0b7d0bfed04bc00dc7b7ed691227`의
[CI37496257599](https://github.com/creno-va/baro/actions/runs/37496257599)3 jobs 성공을 확인하고
main `f75bc9d24f1992ff69ea3cc4ebf7ae9893770693`로 정상 squash 병합했다. native 실행 단계는
변경 없음으로 skip됐으며 실제 native 검증으로 대신하지 않는다. PR130 final cf8d3da의
[CI37497199020](https://github.com/creno-va/baro/actions/runs/37497199020)는 native 실제 실행과
source/browser·quality gate 모두 성공했다. 공유 병합 뒤 최신 main rebase·새 head 검증을
요청했으며 그 결과 전에는 cf8의 성공만으로 병합하지 않는다. 이전 c7ca596의
[CI37496506640](https://github.com/creno-va/baro/actions/runs/37496506640)19 PASS/1 FAIL도 보존한다.

01:44 KST 동일 D1 console은 preview/production2개, 기간 rows read26.78k·written1.17k,
billable usage $0.00을 표시했다. 계정 전체 기간 관측이며 최종 candidate별 scan/청구 receipt나
무료 처리 보장이 아니다. 격리 복구 자원이 없다는 판단은 동일하다.

파일 담당 완료 인계 뒤 통합 담당이 기존 PR130을 f75bc9d로 rebase했다. range-diff에서
모듈 commit5개는 동일했다. rebase head68ebfa3의
[CI37498417740](https://github.com/creno-va/baro/actions/runs/37498417740)는 FAILURE:
report PATCH65537 거부를 기대하던 테스트가 공유128KiB 계약과 충돌했다. 실제 signed SQL
한글30000자 저장도 `RUNTIME_PROOF_TOO_LARGE`로503임을 추가 재현했다. 작은 기존 요청의
receipt hash는 보존하고 큰 검토만 exact UTF-8 SHA256을 포함하는 versioned request identity로
묶었다. 일반 금융 proof64KiB 한도는 확대하지 않았다. 같은 key 재시도는 동일 검토를 반환하고
동일 길이 한 글자 변경은409, 원본/R2 I/O 없이 저장한다. PATCH131073/POST65537 거부도 확인했다.
4665518의 [CI37498891870](https://github.com/creno-va/baro/actions/runs/37498891870)는 새 테스트의
unknown wire typing 오류로 FAILURE이며 결과를 보존한다. DTO typing만 고친 final head
`371da5db02f4f826c6f93e394cae9748c655d7ff`의 작업 트리에서 frozen ci/check1256 PASS/
133307 assertions, drift·fresh/upgrade6/29, build/dry-run 및 focused API/service12/94가 통과했다.
[새 CI37499235080](https://github.com/creno-va/baro/actions/runs/37499235080)가 병합 기준이다.

Safari preview 로그인에서 실제 페이지 확대 메뉴200%를 확인했고 역할 선택과 로그인 버튼은
세로 스크롤로 접근하며 가로 잘림이 없었다.100%로 복원하고 임시 탭을 정리했다. 이는 c6b9665
배포의 로그인 검사이며 최종 통합 전체 흐름과 구분한다. 로컬 Chromium viewport/CSS 확대
검사와 실제 browser zoom을 동일 증거로 부르지 않는다.

PR130 final head `371da5db02f4f826c6f93e394cae9748c655d7ff`의
[CI37499235080](https://github.com/creno-va/baro/actions/runs/37499235080)3 jobs(native 실제 실행
포함) SUCCESS와 최신 base f75bc9d/CLEAN을 확인해 main
`5a28053d483e47a71e7c61b7c7787d533ee5be55`로 정상 squash 병합했다. 자체 APPROVE/admin 우회
없음. 공유 통합은 native `createReportsApi()`를 `/v2`에 연결하고 scheduled 마지막에
`reconcileV2Deletion`을 연결한다. 실제 SQL/crypto/signed owner와 native factory의 global router
검사2개/39 assertions가 통과했다. 명시적 synthetic D1 billing metadata만 공급하는 test adapter는
원격 scan/청구 증거가 아니며 production composition에는 주입하지 않는다. 다른 owner404,
CSRF/role403, 미승인 production gate503/비공개 headers, 익명 directory200 및 R2 I/O 없음도 검사한다.

production 사전 build는 기존 bundle sentinel 검사를 통과했으나 API mock 저장 namespace와
합성 session/cases 및 변호사 chunk를 포함했다. 기존 검사는 test/auth-bypass sentinel에 한정됐고
API mock artifact 부재를 입증하지 못했다. 공유 core의 mock handler는 예시 모드에서만 lazy-await,
facade glob과 mock imports는 compile-time 모드 분기로 제한했다. cases consumer의 변경은
unconditional mock import 제거이며 변호사 mock import5개에도 같은 build-time guard를 적용했다.
mock namespace를 거부하는 강화된 production bundle 검사가 사전 build136 files에서 통과했다.
공유 session storage invalidation listener 문자열은 adapter 자체와 구분한다. 최종 통합의 필수
check·모든 browser·production build/bundle 및 CSP는 별도 candidate에서 실행한다.

통합 PR133의 첫 head1d6fd92는 새 test adapter의 D1 overload/optional method 타입 오류로
[CI37500419811](https://github.com/creno-va/baro/actions/runs/37500419811) FAILURE였으며 제품
guard를 바꾸지 않고 test typing만 수정했다. e4b678b에서 frozen ci/check1260 PASS/133359
assertions, drift·fresh/upgrade6/29, build/dry-run, production build/bundle139 files,
CSP4 PASS/fixture 전용1skip이 통과했다. 같은 checkout에서 signed SQL 실제 PDF/ZIP 다운로드1,
공유 lawyer API mock1, 고객 login/intake/originals/report/삭제/reload·peer purge 통합1을 순차
실행해 모두 통과했다. 다운로드 입력·SQL·D1 billing metadata는 합성이며 remote OAuth/R2/
청구 증거가 아니다. production 배포 job에도 build 뒤·migration 전 `bundle:check`를 추가해
승인된 job의 실제 산출물에서 동일 guard를 실행한다. 이 workflow 변경은 새 head에서 검증한다.

main5a28053의 [CI37500203783](https://github.com/creno-va/baro/actions/runs/37500203783)는
settings switched-account fixture1 FAIL이었다. 첫 deletionAccess 뒤 버튼 visible/삭제 disabled는
전체 초기 load 완료를 뜻하지 않아 다음 callback marker를 이전 load가 소비할 수 있었다.
expired callback의 재인증 버튼 enabled를 기다린 뒤 다음 marker를 주입하도록 fixture만 고쳤다.
AccountSettings 제품 UI/owner·최근 OAuth·callback·삭제 보호는 변경하지 않았다. settings5개를
3회 반복해15 PASS이며 이전 pagehide/늦은 access 오류/늦은 OAuth 오류가 새 marker를 지우지
못하는 기존 지연 회귀도 유지했다. 실패 main CI는 보존하고 최종 head/main에서 재검증한다.
signed SQL native report 다운로드 PDF는 pypdf/Poppler에서 한글·마스킹·버전·페이지·여백을
확인했다. 합성 입력 PDF1페이지/3126732 bytes와 ZIP의 선택 원본 정확한 byte가 보존됐다.
한글 폰트·마스킹·footer는 깨짐/겹침 없이 렌더됐으며 원격 제품 비용 증거가 아니다.

## 4세션 통합 릴리스와 현재 외부 gate (2026-10-07)

[현재 immutable 릴리스 journal](https://github.com/creno-va/baro/issues/71#issuecomment-6021564076)은
이 문서 변경 자신을 포함한 최종 main SHA의 CI·preview·독립 smoke·Full validation(manual)·
실제 browser·protected production 상태를 기록하는 정본이다. pending/실패/승인대기를
완료로 표시하지 않고 이전 SHA의 증거를 보존한다. 아래 모듈/로컬 증거와 실제 외부 성공을 구분한다.

| 대상 | 통합 구현과 검증 가능한 범위 | 아직 입증되지 않은 범위 |
| --- | --- | --- |
| 고객 | 동일 UI의 명시적 API 예시 adapter로 역할·합성 동의→사건·질문·요약 확인→chat·자료→검토·PDF/선택 원본 ZIP→reload→사건/계정 삭제. signed SQL/native PDF/ZIP는 별도 합성 다운로드 검사 | 실제 OAuth·Turnstile action·승인 모델·공식 법률·R2/Container/Whisper의 로그인부터 삭제까지 제품 처리 |
| 변호사 | 동일 UI API 예시에서 본인 프로필·사진·PDF portfolio 저장/reload·직접 공개 설정·디렉터리/공개 상세. 별도 backend 소유/역할/동의/revision/삭제 fence 검사 | 실제 OAuth·R2 public copy/download·현재 정책 승인·자격/소속 사실 검증. 자격 심사/승인대기/어드민 UX는 ADR-0014에 따라 제외 |
| 비용/quota | 실제 SQL factory의 KST 일/월 경계·동시 admission·retry별 meter와 logical quota1회·100만원 상한·정확한 FX·불명 비용 보존·삭제/다음 달 late receipt 검증 | 합성 receipt는 공급자 invoice가 아님. immutable 가격/FX/funding/allocation/model bounds 부재 시 paid admission 닫힘 |
| 공식 근거 | legal-retrieval 전용 captured/synthetic parser/cache의 ID/version/date/URL/hash·한도·취소·bounded retry·unavailable 검사 | 현재 OC/서비스/인터넷 JSON 승인과 실제 공식 응답의 근거 tuple 확인. 모델 기억은 공식 근거로 쓰지 않음 |
| 운영 | native report global router와 scheduled v2 deletion 연결, owner/CSRF/role/tombstone 보호, production mock artifact 거부 | 격리 restore·DB 밖 최신 v2 deletion journal/replay·key recovery·rollback·실제 alert 수신 ack 및 현재 비용 receipt |

공유/모듈 PR #126/#128/#130/#132는 최신 base와 정확한 head CI로 정상 병합했다.
#133은 global native report/scheduled deletion 연결과 production mock artifact 제거를 통합한다.
모듈 UI 파일을 중복 구현하거나 자체 APPROVE/admin/gate를 우회하지 않았다. migration은
`0009_storage_capacity_maintenance`를 유지하며 새 번호를 만들지 않았다.

최종 product source의 로컬 frozen ci/check1260 PASS/133360 assertions, migration drift 및
fresh/upgrade6 PASS/29 assertions, build/dry-run PASS. production bundle139 files와 CSP4 PASS/
fixture 전용1skip, signed SQL/native report 다운로드·공유 lawyer mock·고객 integrated API mock
각1 PASS, settings fixture5개×3회15 PASS. 실제 PDF1page/3126732 bytes의 한글·마스킹·footer와
ZIP 선택 원본 byte/이름을 pypdf/Poppler로 확인했다. 이 local/SQL/fixture 성공은 실제 OAuth·
공식 법률·모델·R2·청구 성공을 대신하지 않는다. 최종 main의 Full validation은 위 journal에서
actual native 실행 여부·browser 수·CI run·동일 SHA를 확인해야 한다.

production build에서 기존 검사에 잡히지 않던 mock chunk를 발견했다. shared core/facade와
consumer의 compile-time 모드 분기로 제외하고 namespace 검사를 강화했다. production job은
build 뒤/migration 전에 `bundle:check`를 실행한다. 실제 fixture/합성 proof를 production DB에
주입하지 않는다. preview 예시 adapter는 명시적 모드이고 별도 /mock UI가 아니다.

외부 담당은 [현재 readiness](../operations/ENVIRONMENT-READINESS.md)의 구체적 필드/행동을
수행해야 한다. Cloudflare 콘솔 로그인은 완료됐으나 GitHub/CLI 자원 권한 확대·새 결제·자동
충전·예산 확대를 하지 않았다. 법률 신청/OC와 Gateway GET403 원인이 그대로여서 기본
metadata 점검은 `check_legal=false/check_gateway=false`; not_requested는 성공이 아니다.
`CURRENT_POLICY_VERSIONS`2026-10-04와 draft2026-10-06-v2-draft를 구분한다.
#19/#20/#27/#70/#71와 milestones4/5는 실제 외부/운영/정책 승인 증거 전 OPEN을 유지한다.
production foundation 승인과 공개 gate는 서로 별개이며 최종 상태는 위 journal에 연결한다.

PR133 final head `d4bd155908cbb6e3f56b19737f290fc59b152241`의
[CI37501545916](https://github.com/creno-va/baro/actions/runs/37501545916) source/browser·native job·
quality gate3개 SUCCESS와 CLEAN을 확인해 main
`b89318c47f15923f5eb8c95745fb5596fbe38deb`로 정상 squash 병합했다. native 실행 단계는 변경 없음
skip이므로 최종 Full validation(manual)에서 실제 실행을 요구한다. main
[CI37502658428](https://github.com/creno-va/baro/actions/runs/37502658428)와 후속 preview는 이 문서
작성 시 아직 진행 중이다. 마지막 독립 preview smoke c6b9665와 production foundation ca6e15b의
실제 성공 기록을 새 main 병합만으로 갱신하지 않는다. 문서까지 포함한 최종 candidate와 검증은
현재 #71 journal에서 참조한다.

최종 candidate18316a2의 [main CI37503235338](https://github.com/creno-va/baro/actions/runs/37503235338),
[preview37503586211](https://github.com/creno-va/baro/actions/runs/37503586211), 독립 smoke의 full SHA/
schema0009는 SUCCESS다. 그러나 [Full37503242587](https://github.com/creno-va/baro/actions/runs/37503242587)은
Linux native 실제 build/fixture·전체 unit·production bundle·regular browser46 PASS 뒤 v1 corpus
첫 상세에서 FAILURE였다. 이 실패를 보존하며 production 제출 조건으로 쓰지 않는다.

최신 고객 boundary는 `/api/me/session`을 실제 확인하지만 corpus loopback 서버는 case ID가 있는
요청만 격리 환경을 선택해 session 요청을404로 반환했다. native auth/session endpoint가 signed
cookie의 해당 SQL DB에서 검증하도록 test-only 환경 선택을 연결했다. 익명은 실제 null session,
50개 각 owner는 customer/current consent를 응답하는지 확인한 뒤 기존 실제 상세·공식 링크·
320px·WCAG A/AA 검사를 수행한다. cookie/token/HTML은 artifact에 남기지 않는다. 제품 UI·
역할·동의/auth를 완화하지 않았다. 고친 harness의 fresh production build/compiled Worker에서
50개 모두 접근성 findings0으로 통과했다. corpus/harness/config/pipeline 변경 자체도 PR browser
선택에 포함해 해당 테스트 변경을 CI가 조용히 skip하지 않게 했다. 새 head 필수/CI와 새 최종
main Full은 [current release journal](https://github.com/creno-va/baro/issues/71#issuecomment-6021564076)에 연결한다.

18316a2의 [metadata-only readiness37503944457](https://github.com/creno-va/baro/actions/runs/37503944457)은
동일 deployed SHA·publicBetaClosed·processing7개 존재, OAuth6필드/bounds 부재를 확인했다.
Gateway/법률은 조건 변경 없어 not_requested이며 성공으로 표시하지 않는다. allowlisted JSON을
`docs/quality/integration-2026-10-07/preview-readiness-18316a2.json`에 보존했다. 02:28 KST 인증된
production D1의 읽기 전용 count 집계에서 runtime proof/allocation/workspace/profile/file/job/
report/maintenance evidence 각0행을 확인했다. payload·사용자 정보·SQL/DB 식별자는 증거로
보내지 않았으며 실제 유료 처리·삭제/복구나 새 production 배포 성공을 대신하지 않는다.

18316a2 실제 IAB에서 합성 고객 login/기존 동의→새 사건·답변/모름/skip→요약 확인→chat·합성
TXT 원본/처리 범위→리포트 검토/마스킹 저장/reload·미리보기를 확인했다. ZIP 원본은 reload 후
재선택하고 직접 확인해야 한다. PDF/ZIP 시작 안내는 관측했지만 IAB download event는 관측되지
않아 파일 저장 성공으로 기록하지 않는다. 별도 Chromium/SQL 다운로드 byte 증거와 구분한다.
자료 modal Escape는 닫히고 trigger로 focus가 복원됐다. screenshot은 ignored
`.wrangler/integration/preview-18316a2-report.png`에 보존했다.

corpus 보완 작업 트리의 frozen ci/check1261 PASS/133365 assertions, drift/fresh/upgrade6/29,
production bundle139 files, build/dry-run도 통과했다. 실제 IAB의 명명된 합성 비운영 workflow에서
사건 삭제 접수 뒤 재접속은 내용을 비우고 NOT_FOUND를 표시했으며, 합성 계정 삭제 접수 뒤
세션과 최근 사건 UI가 제거됐다. 이는 API 예시 adapter의 접근 차단 검증이며 실제 원격 정리/
late workflow/복구 증거가 아니다. 후자는 기존 SQL 회귀와 외부 운영 gate로 별도 보존한다.

자료 선택 안내의50MB/300MB와 settings/실제 V2_LIMITS100MB/1GB가 달라
[고객 Workspace 담당](https://github.com/creno-va/baro/pull/128#issuecomment-6021889675)과
[파일 담당](https://github.com/creno-va/baro/pull/130#issuecomment-6021890274)에 계약 재사용·동일
copy 수정을 요청했다. 모듈 UI 충돌을 피하기 위해 통합 세션은 해당 화면을 직접 수정하지 않았다.
작은 합성 입력의 성공을 한도 전체 성공이나 이 미수정 안내의 해결로 표시하지 않는다.

## 실제 API 배포 전환 (2026-10-07 사용자 후속)

통합 main `e8b18c72a88a31ec9d4ae0c6f6855c6a59dfd48f`의
[main CI37506090574](https://github.com/creno-va/baro/actions/runs/37506090574),
[Full37506109883](https://github.com/creno-va/baro/actions/runs/37506109883),
[preview37507174492](https://github.com/creno-va/baro/actions/runs/37507174492),
[production37507920363](https://github.com/creno-va/baro/actions/runs/37507920363)는 SUCCESS다.
production은 지정 리뷰어 hyunhomon의 정상 Environment 승인으로 배포됐다. 두 도메인의
독립 fullSHA/schema0009 smoke, 운영 report5verbs/session/directory의 BETA_NOT_OPEN503,
login200/CSP/frame DENY/nosniff와 예시 배너·storage sentinel 부재를 확인했다.
Full은 unit1261/133365, migration6/29, 실제 Linux native, browser73(corpus50사례1test 포함),
CSP4/fixture전용1skip, production bundle139 및 dry-run을 통과했다. 비민감 JSON을
[정본 journal](https://github.com/creno-va/baro/issues/71#issuecomment-6021564076)에 영구 보존했다.

production은 이미 real transport이며 후속 변경은 preview workflow의 강제 mock을 제거한다.
같은 UI/domain client가 해당 환경의 same-origin API를 호출하고 배포 전에 production과 같은
bundle 검사를 통과해야 한다. local/격리 mock 검증과 기존 성공/실패 기록은 보존한다.
missing OAuth/model bounds/가격·funding/공식 승인 오류를 합성 성공으로 대체하지 않는다.
현재 preview OAuth6필드와 model bounds가 없으며 공개 정책·운영 drill 증거도 미완료다.
이슈 종료는 각 인수 조건을 실제 구현·fixture·외부 증거의 요구 범위와 대조해 결정하며,
#19/#20/#27/#70/#71 및 공개 gate를 외부 증거 없이 완료 표시하지 않는다.

전환 PR의 로컬 frozen install/check(1261 tests/133365 assertions, drift 없음,
fresh/upgrade6/29), real preview build/bundle139, 일반 build 및 Cloudflare dry-run은
통과했다. 명시적 mock preview를 별도로 빌드하면 bundle 검사가 TEST_CODE_IN_BUNDLE로
거부했고, 실제 preview build/bundle/dry-run을 다시 통과시켜 최종 산출물을 복원했다.
schema/migration, 정책 버전, 공개 gate 및 공급자 설정은 변경하지 않았다.

이슈 종료 감사에서 #66의 실제 SQL/native HTTP 브라우저 PDF/ZIP 성공은 원격 R2·D1
CPU/청구/다운로드 증거와 구분했다. 담당자의 남은 원격 인수 조건은 아직 입증되지 않았으므로
이슈를 닫지 않는다. #65/#69의 자료 한도 안내 불일치도 앞선 담당 수정 요청에 남아 있다.

### 자료 한도 안내 후속 수정

사용자의 논스톱 통합 지시 뒤 담당 세션 비실행/열린 제품 PR 없음과
[소유 조율](https://github.com/creno-va/baro/issues/65#issuecomment-6022704458)을 확인했다.
통합 #69의 좁은 후속에서 Workspace의 50MB/300MB 고정 안내를 기존 V2_LIMITS의
문서·이미지100MB/음성·영상1GB로 맞춘다. validation/admission/계약 한도를 확대하거나
모듈 흐름을 수정하지 않는다. 큰 파일 전체의 실제 원격 처리 성공을 뜻하지 않는다.
PR136은 exact head2c179f81e8525d7376321c32d7e8d8a5ba8f4e14의
[CI37510574519](https://github.com/creno-va/baro/actions/runs/37510574519) 필수3jobs
SUCCESS/CLEAN 확인 뒤 정상 병합됐으며 main은73cc78324bcaa9302339c3f8e6da51aa1a8915a3이다.
native는 변경 없음에 따라 fixture 실행을 skip했다. 최종 통합 Full에서 실제 native를 재검증한다.

### 실제 인증 설정·응답·산출물 경계 후속

PR137 head a7e4eaa7f8b7f0820cd806e8bd34b1596b21ea26의
[CI37511218163](https://github.com/creno-va/baro/actions/runs/37511218163) 필수3jobs
SUCCESS/CLEAN 및 로컬 필수/자료 browser4/CUA 안내 확인 뒤 정상 병합했다.
main d487ab1f4fecaf2cfb419622394ac0eb66adf6e7의
[CI37513067434](https://github.com/creno-va/baro/actions/runs/37513067434)와
[preview37513622882](https://github.com/creno-va/baro/actions/runs/37513622882)는 SUCCESS다.
배포 단계 성공과 별도의 독립 SHA smoke/최종 Full/production을 구분한다.

사용자가 제공한 local .dev.vars.txt의 소셜6필드·서명 key를 Git-ignored .dev.vars(0600)에
적용했다. local callback은 localhost4321이며 remote preview/production에 복제하지 않았다.
실제 값은 로그·PR·산출물에 기록하지 않는다. OAuth 설정 부족 오류를 typed safe503으로
매핑하고 me/auth 정상·오류·공개 차단을 private,no-store/nosniff로 보완했다. 기존 쿠키
갱신/만료/실제 OAuth timestamp·origin·역할·공개 gate 회귀를 보존했다.
local frozen install/check1263·133388/driftfreshupgrade6·29/build/bundle137/dry-run과
local migration0009를 통과했다. cleanup hook의 경로 보완 뒤 build/bundle/dry를 재검증했다.

Cloudflare adapter가 local preview용 dist/server/.dev.vars를 생성하는 것을 확인했고,
빌드 완료 후 dotenv 파일을 제거한다. guard는 숨김 dotenv 파일도 배포 전에 거부한다.
실제 소셜 key/서명 key의 dist 검출0·tracked diff 검출0과 임시 dotenv 삽입의 실제
guard 거부/제거 후 성공을 확인했다. source .dev.vars는 dev 서버에 보존한다.
산출물 검사는 OAuth 성공과 별개다. 이후 실제 브라우저에서 제공된 local 앱의
Google/Naver/Kakao callback → 기존 필수 확인 완료 화면 → 고객 화면 이동을 검증했다.
각 공급자별 재로그인 직후 local native D1의 최근 oauth_authenticated_at 세션1개와
공급자 access/refresh/id token 저장0을 집계로 확인했다. 계정·이메일·ID·토큰 값은
증거에 포함하지 않았다. 로그아웃 후 다음 공급자로 전환했으며 예시 adapter나 세션
seed는 사용하지 않았다. 사용자가 완료한 동의를 새로 대신 수락하지 않았다.
이 결과는 localhost4321 앱·제공된 key의 실제 인증 성공이며 remote preview/production
키·callback·공개 gate의 성공을 대신하지 않는다. 실제 관측과 새 SHA의 CI/Full/배포는
[정본 journal](https://github.com/creno-va/baro/issues/71#issuecomment-6021564076)에 이어 기록한다.
