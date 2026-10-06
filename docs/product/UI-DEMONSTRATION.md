# BARO v2 기능별 실제 UI 시연 행렬
> **2026-10-06 사용자 개정 — 아래 이전 범위보다 우선한다.** MVP는 고객/변호사 두 역할이며 통합 로그인에서 선택한다. 변호사 승인 어드민·자격 심사·반려·승인대기 UX는 제외한다. 실제 제품 client UI 동일 구현체를 API mock adapter로 먼저 완성하고 기능 연결을 병렬 진행한다. 별도 /mock UI는 만들지 않는다. [5세션 계획](../development/PARALLEL-UI-SPRINT.md)의 실제 착수부터 2시간 sprint를 적용하며 독립 UI는 DB/AI/OAuth/backend CI/A 이슈 종료를 기다리지 않는다. 완료된 코드/이슈/증거를 보존하고 새 DB/비용 선행 이슈를 추가하지 않는다. AI 품질 확대는 모든 UX 연결 뒤다. P0.3/#70/#71 외부·정책·production·공개 gate는 보존하며 mock 성공을 실제 외부 성공으로 표시하지 않는다. [ADR-0014](../adr/0014-mvp-two-roles-and-api-mock-first.md)가 대체 범위를 기록한다.

- Version: 2.0
- Updated: 2026-10-06
- Status: Required scenarios; no v2 demonstration is claimed complete
- Milestone: [BARO MVP — Customer/lawyer functional UX](https://github.com/creno-va/baro/milestone/5)
- Related: [PRD](../PRD.md), [MVP](./MVP-SPEC.md), [UX](./UX-SPEC.md)

## 증거의 기준

각 시나리오는 배포 candidate SHA·environment·시각·수행 역할·합성 fixture ID·
수행 단계·기대/실제 결과·자동 test/run·안전한 수동 화면/파일 검토 evidence를 기록한다.
항목별 상태는 미착수/구현됨/합성검증됨/실제검증됨/차단으로 구분한다.
이 문서는 시연 요구사항이며 현재 모든 v2 evidence는 미확보다.

E2E mock 이나 signed test session 성공은 실제 OAuth/AI/법률 API/Container/R2의 증거가 아니다.
직접 browser 에서 렌더링과 작업 흐름을 확인하고 새로고침/재로그인/다른 기기 폭에서
서버 정본이 유지되는지 확인한다. 화면·PDF·ZIP 검토는 실제 산출물을 연다.
자동 axe 성공을 모든 수동 접근성·화면 품질 검증으로 표시하지 않는다.

preview 에서 합성 사건·원본·가상 변호사·테스트 역할을 사용한다. production 에는 가상
변호사를 게시하지 않으며 승인 전 공개 전환을 하지 않는다. 운영자의 사건 원문 접근은
테스트 시연용으로도 추가하지 않는다. 로그/증거에 token·cookie·비밀번호·실제사건을 넣지 않는다.

## 고객·변호사 필수 시연

마일스톤 6/#101~#106은 아래 흐름을 실제 제품 client UI에서 API mock으로 먼저 시연한다.
해당 증거는 `API-mock UI`로 표시하며 실제 OAuth·서버 저장·자료 처리·PDF/ZIP·삭제 증거와 구분한다.
UI-21~23은 ADR-0014에 따라 MVP 제외이며 원래 요구는 아래 역사 행에 남긴다.

| ID / 기능 | 역할·정상 시연 | 실패·경계·persistence 확인 | 구현/증거 이슈 |
| --- | --- | --- | --- |
| UI-01 / F001 | 통합 고객/변호사 선택→세 OAuth 로그인·동의·역할별 복귀·로그아웃 | 취소·state/만료·재동의·14 세미만 차단·moderator 승격 금지·실제 callback | #102,기존#27,#69,#71 |
| UI-02 / F002 | 개인/기업 KR 사건 생성→dashboard | 20/5,000자·Turnstile 실패/재사용·더블클릭·일 3/4 동시·기업단일 owner | #57,#64,#65,#69 |
| UI-03 / F003 | 답변에 따라 달라지는 2개 이상 질문묶음 | max 3×5·unknown/skip·중복·다른탭 revision·폼 오류 | #54,#64,#65,#69 |
| UI-04 / F003 | 질문 중 저장→이탈→재로그인→재개 | 24 시간지난 v2 답변 보존·실패재시도·quota 대기·저장상태 | #64,#65,#69 |
| UI-05 / F004 | 사용자진술·AI 정리·공백/모순→편집→요약확인 | 확인전 chat 차단·중복확인·revision 변화·새자료재확인 | #64,#65,#69 |
| UI-06 / F005 | 지속 chat→검증응답→출처/자료 위치→재접속 | quota30/31·timeout/schema/safety·삭제중응답·미검증 stream 비노출 | #57,#64,#65,#69 |
| UI-07 / F006 | 사실수정·timeline·미상날짜·행동완료/보류 | 불리한사실/모순유지·자동허구날짜금지·reload 상태·cross-owner404 | #64,#65,#69 |
| UI-08 / F006 | 전략질문→변호사확인·허용준비행동 | 확정판단/승패/유불리/기한계산/완성서류/대리연락 거부·긴급안내 | #63,#64,#68,#69 |
| UI-09 / F007 | 문서/PDF100MB 이하·이미지 실제 upload/처리 |100MB 경계·PDF 500/501쪽·손상/암호보호·MIME 위조·삭제/취소 | #58,#59,#65,#69 |
| UI-10 / F007 | 실제음성 upload→전체전사→시간위치 | 1GB/60 분경계·무음/언어/손상·day 60분·retry 이중 quota 방지 | #57,#58,#59,#65,#69,#71 |
| UI-11 / F007 | 실제영상→전체음성·1초/장면 frame→내용확인 | failed/timegap·coverage 표시·매 frame 확인주장금지·실제 codec | #59,#65,#69,#71 |
| UI-12 / F007 |동의→upload→처리,대기→재개/삭제 |동의없음·월예산·병렬예약·원본 100/101개·case5GB·account10GB | #57,#58,#59,#65,#69 |
| UI-13 / F008 |원본 preview/download·자동추출확인/수정 |page/time 근거·privateURL 만료·cross-owner·cache·deleted 자산 404 | #58,#59,#65,#69 |
| UI-14 / F009 |summary/files→reportversion→PDFpreview |stale 표시·포함/제외·이름등기본유지·마스킹편집·공백/모순 | #66,#69 |
| UI-15 / F009 |한글 PDF 다운로드후실제로열기 |폰트/줄바꿈/긴 text·pagebreak·timestamp/인용·생성실패/중복 | #66,#69,#71 |
| UI-16 / F009 |선택원본 ZIP 다운로드→실제파일목록/내용 |미선택파일없음·원본미마스킹안내·cross-owner·중복 filename·삭제중 export | #66,#67,#69 |
| UI-17 / F012 |비로그인변호사필터/목록→프로필 |지역/분야부족·empty/error·회전기준·pagination; 과거 pending 심사는 MVP 제외 | #61,#106,#69 |
| UI-18 / F012 |사진/이름/소개/주소/포트폴리오→연락/길찾기 |phone/email/외부상담·세 map 목적/URL·없는/숨김프로필·수임보장금지 | #61,#69 |
| UI-19 / F010 |통합 고객/변호사 선택→변호사 자기 portal |moderator 승격 금지·타계정 접근 차단·실제확인 없는 인증표시 금지 | #102,#106,#62,#69 |
| UI-20 / F011 |프로필·text/image/PDF portfolio 편집→저장→미리보기→재접속 |공개 동의·업로드 실패·민감표현·타인 portfolio 접근 차단 | #106,#62,#69 |
| UI-21 / F013 |MVP 제외: 과거 자격심사·반려·재신청·승인 |기존 backend/증거 보존, 이번 필수 시연 아님 | ADR-0014 |
| UI-22 / F011/13 |MVP 제외: 과거 공개 revision 운영 승인 |기존 backend/증거 보존, 이번 필수 시연 아님 | ADR-0014 |
| UI-23 / F013 |MVP 제외: 과거 프로필 신고·운영 조치 |기존 backend/증거 보존, 이번 필수 시연 아님 | ADR-0014 |
| UI-24 / F014 |자료삭제→case 삭제→계정최근 OAuth 재인증/삭제 |취소·만료/다른계정·자동 submit 금지·원본/파생물/report/context 정리 | #67,#69,#71 |
| UI-25 / F014 |삭제중 upload/처리/chat/export 완료와충돌 |latewrite 부활금지·후속 cleanup 실패/재시도·logout·private404 | #67,#69,#71 |
| UI-26 / legacy |기존 v1 목록→기존질문/결과→삭제 |schema1 인용/5개 기존질문·migration 후 read·v1 생성우회차단·무단 reanalysis 없음 | #55,#65,#67,#69 |
| UI-27 / all |320px/mobile·desktop·200%·keyboard 전체 flow |focus/dialogrestore·aria/errors/status·44px·contrast·reduced motion | #56,#69 |
| UI-28 / all |builtWorkerCSP의 font/icons/dialog/upload/chat/Turnstile |blockedscript·hydration/fallback·동일 SVG 교체모든사용처·font 라이선스 | #56,#69,#71 |
| UI-29 / F005/09 |변호사연락링크선택→case 로돌아와자료추가/report 갱신 |contact 완료강요없음·자료자동전송없음·전략대신사실준비계속 | #61,#64,#65,#66,#69 |
| UI-30 / privacy |선택 analytics 동의/거부→실제기능사용 |optout 기능동일·동의철회정리·원문/검색어/파일명/PII 없는 allowlist | #68,#69 |

contact 시연은 실제 링크 이동까지만 한다. 실제 상담 메시지 발송·전화 발신은 이
목표의 검증에 필수하지 않으며 별도 사용자 지시 없이는 실행하지 않는다.

## UI 외 필수 증거

| 요구 | authoritative evidence | 담당 |
| --- | --- | --- |
| 계약/version·DB 보존 | strict rejection·fresh/upgrade·schema drift·실제 SQL concurrency/IDOR·v1 fixture 유지 | #54,#55,#69 |
| 모델/법률출처 | 기본 사실/비자문·출처 경계 및 실제 pinned model/Whisper/source smoke 유지; 광범위 가족별 품질 개선은 UX 연결 뒤 | #59,#63,#64,#69,#71 |
| 원본/처리 coverage | 실제 R2/Container의 4 범주처리·timestamps/pages/hash·누락/제한·private cipher/object 권한 | #58,#59,#69,#71 |
| quota/비용 | concurrency/KST/월경계·operation replay·예약회수·actualretryledger·기술 100 만원 hardstop | #57,#69,#71 |
| 삭제/복구 | 실제 object/instance 삭제·격리 restore+최신 journal·rollback·경보수신 receipt | #67,#71, 기존#19/#27 |
| public 기능/정책 | approved 문서 URL/version·검토자/시각/범위·사업자사실·행동승인·자기 프로필 표현 정합 | #68,#70, 기존#20 |
| 지속배포 | PRCI→previewSHA→smoke→productionSHA, migration/image/font/asset release 일치 | #71 |
| 전체완료 | 본행렬전행의증거충분성검토·남은 blocker0·실제공개 gate 충족 | #69,#70,#71 |

보안·파일 내용·법률의 truth를 테스트 manifest의 green 만으로 판단하지 않는다.
증거가 누락·간접·불충분하면 해당 항목은 미완료로 남긴다. preview/provider 로그 OFF가
공급자 무보존을 의미하지 않는다. 고객/변호사 소유권과 private 사건 비공유를
역할별권한/API로 확인하고, 검증 근거가 없는 자격/법률 승인을 표시하지 않는다.
