# BARO v2 검증 증거 기록

- 기준일: 2026-10-06
- 상태: #53 명세·#54 strict 계약·#56 공통 UI 시스템 완료. #55 DB 구현과 후속 기능은 진행 중이며 v2 전체 제품·실제 외부 연동·공개 완료 증거 없음.
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
| 문서/이미지/음성/영상 처리 | #59/#64/#65 | #69/#71 actual processor/Whisper/model·coverage/timestamps/gaps | 미검증 |
| quota·월100만원·실제 비용·retry | #57/#58/#59/#64 | #69/#71 동시성·KST·usage/cost reconciliation | 미구현 |
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

## 최종 감사

각 원래 Goal 항목과 PRD 요구사항을 위 ledger 및 UX 시연에 대응시킨다. 누락된 기능이나
승인·명령·artifact·실패 조건이 있으면 완료하지 않는다. 모든 역할의 실제 동작, 다운로드 내용,
저장/삭제/복구, 외부 제공자, 같은 릴리스 배포, 공개 승인 근거까지 강한 증거로 확인한 뒤에만
milestone 5와 Goal을 완료한다. 이번 명세 PR은 이후 실제 성공을 미리 기록하지 않는다.
