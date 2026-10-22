# 에이전트 실행 기준

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
| 모바일 전체 구현·M2 client | 모바일 담당 / #334·#335 (M1 #330 인수) | PR329·331·333 통합, 앱 `d757018` 두 OS native build 성공. PR340 main `0d5b984`의 공통 DTO·HTTP·session/directory와 모바일 공개 목록 연결 완료, 두 OS native39782039545 성공. 사건/intake PR341 main `6a2b500` 통합. `codex/335-shared-workspace-client`에서 작업공간·채팅/행동/타임라인·metadata/job 저장 port 추출. 선행 PR338의 schema 수정과 실제 workerd 시작 검사 유지 | quick/build·계정/요청/검색·기존 웹 회귀 뒤 PR 통합. 사건/workspace 등 나머지 client와 인증/고객/변호사/첨부/UI·기기/릴리스까지 #334에서 지속. 웹 표현 경로 보존, 미패치 audit #339는 전체 보안/릴리스 인수에 유지 |
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
