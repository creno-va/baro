# 프리베타 MVP 실제 인수 추적

- 시작: 2026-10-14 KST, #71. 직접 사용자 지시에 따른 preview 우선 검증.
- 작업 브랜치: `codex/71-preview-mvp-completion` → `codex/71-live-verification` → `codex/71-preview-validation`.
- 시작 시 main: `f44f8d09c79ab402c08b0b85cfb014c632048a01`.
- 시작 시 실제 preview live/ready: `1059887ae8ad1998b6e5432c6ba2da4d5ed4679e`, schema `0015_cost_observation_only`.
- 이전 세션의 성공은 재검증 출발점이며 현재 인수 결과가 아니다. production 반복 검증/배포는 preview 핵심 흐름 완료 후 같은 SHA로만 한다.
- 실제 계정 테스트는 사용자 후속 지시에 따라 Kakao OAuth만 사용한다. Google 2차 인증과 Naver 로그인은 이번 실제 검증 범위에서 미확인으로 남긴다.
- 합성 입력만 사용한다. 기존 데이터·원장·hold를 보존하며 DB 전체 초기화로 테스트 조건을 만들지 않는다.
- [MVP](../product/MVP-SPEC.md), [시연 행렬](../product/UI-DEMONSTRATION.md), [비용 관측 전용 정책](../operations/PREBETA-COST-POLICY.md)이 범위 정본이다.

## 현재 기능 목록과 실제 결과

| 범위 | 실제 확인할 흐름 | 현재 결과 |
| --- | --- | --- |
| F001 / UI01 | 고객·변호사 Kakao 로그인, 취소·복귀·로그아웃·재로그인, 역할/동의 | d2c825f 실제 Kakao 고객 로그인·로그아웃·변호사 재로그인 성공. 기존 동의 완료·기존 사건 목록 유지, 설정에서 기존 Google 및 Kakao 연결 모두 확인. 다른 탭에도 로그아웃 반영 확인 |
| F002~004 / UI02~05 | 개인/기업 사건, 2×3 질문, 모름/건너뛰기, 저장·재개, 요약 수정·확인 | 새 개인 합성 입력에서 실제 Turnstile 수동 체크가 나타남. 브라우저 도구의 실행 시점 확인 대기. 챌린지 미완료 후 명시적 오류·입력 유지·다시 저장 버튼 확인; 생성 성공 미확인 |
| F005 / UI06,08 | 일반 채팅·공식 출처 법률 질의, 실제 답변·저장, 실패·복구·대기 상태 | 미확인; 이전 POLICY_REJECTED 재현/원인 조사 |
| F006 / UI07 | 사실·인물·타임라인·다음 행동 편집, 날짜 정밀도, 새로고침 유지 | 미확인 |
| F007~008 / UI09~13 | 문서·이미지·음성·영상 업로드/실제 처리, 조회·다운로드·교정·제외·coverage | 미확인 |
| F009 / UI14~16,29,35 | 새 리포트·마스킹/제외·HTML/PDF/선택 ZIP, 실제 파일 내용·열기 | 미확인 |
| F010~011 / UI19~20 | 변호사 자기 프로필·사진·텍스트/이미지/PDF 포트폴리오 저장·재접속·미리보기·공개·철회 | f2a4fd5 실제 PNG 정제→사진 연결·저장·새로고침·공개 익명 이미지 표시 성공. PDF 정제→포트폴리오 연결·저장·다운로드 성공; 실제 파일 두 쪽을 렌더해 합성 영문·한글·도형 확인. 재로그인 뒤 연결 유지, 비공개 전환(4.360초 관측 상한)→로그아웃→상세와 이전 PDF URL NOT_FOUND 확인. 앞선 텍스트 저장·검색·미저장 변경 복구 성공 포함. 처리 지연 P04 조사 중 |
| F012 / UI17~18 | 익명 목록/프로필, 검색/필터/페이지/부족 결과, 연락/길찾기 URL | d2c825f 익명 목록·합성 프로필 상세·이름+서울+부동산 결합 검색(관측 상한1.352초)·새로고침 조건 유지·불일치 형사 필터 결과 없음·초기화 복구 성공. 이메일 href 확인, example.org 외부 상담·네이버/카카오/Google 지도 실제 화면 이동과 합성 목적지 전달 확인. 실제 메시지/전화 미발송. 복수 페이지 경계는 미확인 |
| F014 / UI24~26 | 합성 자료/사건 삭제·재인증·늦은 완료 차단·legacy 보존 | 미확인 |
| F015 | 비용 관측 누락/만료/금액 비차단, quota/물리/보안 유지, 실제 원장 보존 | 코드·외부 설정 조사 중 |
| UI27~28,30~34 | 화면 폭·키보드·CSP·동의/재동의·역할/소유권·새로고침 | d2c825f 고객 역할로 /lawyer 직접 진입 시 편집 숨김·변호사 로그인 안내 확인. 로그아웃 후 /app 로그인 요구, 익명 자기 프로필·private assets API401 확인. 비공개 public profile API404 확인. 다른 소유권 시나리오 미확인 |
| 최종 릴리스 | 변경별 검사·최종 SHA full·preview 전체 핵심 흐름·동일 SHA production | 미완료; production 배포 미실행 |

## 단일 문제 목록

| ID | 재현 방법 / 사용자 영향 | 확인된 원인 | 수정 / 상태 | 배포 버전 | 재확인 결과 |
| --- | --- | --- | --- | --- | --- |
| P05 | Kakao OAuth 후 `/login?error=oauth&error=account_not_linked`; 로그인 불가, 일반 재시도 안내만 표시 | `disableImplicitLinking=true`가 검증된 동일 이메일도 차단. 중복 error query에서 첫 값만 읽음 | PR252 병합: 양쪽 검증된 이메일 연결·owner 보존·중복 오류 안내. DB20검사175assert와 로컬 브라우저 callback 안내 검사 통과 | preview1059887에서 재현 → d2c825f 수정 배포 | Safari 실제 Kakao 로그인 성공(클릭→callback 화면4.95초 상한, UI 자동화 포함), 기존 동의 완료·10/7 기존 사건 목록 유지. DB 삭제 없음 |
| P01 | 기존 법률 질의 POLICY_REJECTED; 답변 미제공. 현재 preview에서 합성 법률 질문으로 재현 예정 | 미확정. 제공자 거절·출처·draft/audit 정책을 구분해야 함 | PR250 진단 및 PR254 검증된 sourceClaims의 공식 출처 반영 배포. 실제 법률 질문 재현 후 policyReason 확인 필요 | d2c825f | 미확인 |
| P02 | 간헐 작업 접수 실패 및 native full 실패. 실제 UI 실패와 테스트 실패를 분리 조사 | 71892c5 full은 false 변형의 **false 전환 전 legacy true baseline** HTTP202 뒤 failed. f8a7328 full은 true 모드의 populated0013→0016 migration 뒤 두 번째 intake/advance에서503(기대202). 서로 다른 지점의 unclassified/unknown이며 실제 throw 원인 미확정 | PR267 실패 경계의 allowlist 진단·정확한 요청 단계·D1 메타데이터·작업 존재 여부 수집. timeout·재시도 변경 없음 | 현재 main9ec128e, 실제 preview f2a4fd5 | full38582027656은2099 pass/1 fail, full38586839689는2134 pass/1 fail. 진단 보강 후 exact9ec128e full38591421650은2149 pass/1 fail, true 시나리오30초 테스트 timeout. 이번5xx 재현은 없으며 아래 상세 기록. 통과/비재현을 해결 증거로 확대하지 않음 |
| P03 | 비용 관측 원본 없는 신규 환경/필수 SKU 누락 시 기능 차단 가능 | `processing-proofs`가 가격/funding head·SKU를 필수 요구하고 기존 hold의 금액/FK가 실행과 결합 | PR253 비용 정산 DB 장애 격리. PR259 additive0016 기술 admission·선택적 비용 관측 분리. 독립 검토와 DB/native/복구/빌드 검증 통과. 원장/hold와 실제 값 보존 | 71892c5·schema0016 배포 | 실제 schema 및 이전 reserved/ambiguous 원장 보존 확인. 현행 preview 가격/재원은 존재하므로 누락 조건 실제 성공으로 기록하지 않음 |
| P04 | 주요 AI 흐름 및 업로드 장기 대기 | AI 단계가 admission으로 남던 문제 확인. 업로드는 합성 runtime에서79 SQL/52 D1 호출, 같은 물리 조건과 비용 관측 전용 접근 검사 중복4회 확인. 정제는 별도 합성 factory 기준209 SQL/173 D1 호출, 31개 current 검사 각각 동의→실행→동의 3번 왕복 | PR255 실제 AI 단계·소요시간, PR265 false mode 업로드 중복 조회4회 제거 배포. 정제 current 검사의 동일한 동의·owner·source·lease 조건을 한 SQL로 합치는 수정 검증 중 | AI 단계 d2c825f; 업로드 중복 제거 f2a4fd5 포함 | 실제 f2a4fd5 PNG는 시작→ready 약53.2초(정제32.957초), PDF 약61.5초(정제24.750초). 서버 ready와 UI 관측 상한을 구분. 로컬 호출 감소만으로 실제 지연 개선을 선언하지 않음 |
| P06 | 설정 화면이 false 비용 모드에서도 ‘처리 예산이나 용량에 따라 대기’라고 안내 | 공통 한도 안내에 과거 비용 정책 문구 잔존 | PR258 실제 처리 용량·서비스 장애 안내로 수정 | 71892c5 | Safari 실제 설정 화면에서 비용 예산 안내 제거 및 AI200/일·문서/미디어/물리 한도 안내 유지 확인 |
| P07 | Safari 프로필 사진 image-markers.png 및 포트폴리오 text-two-pages.pdf 선택·업로드: 잠깐 busy 후 성공/실패 안내나 등록 자료 없이 종료 | file picker 복귀 focus의 인증 재조회와 upload verify가 같은 request counter를 공유. supersede 시 조용히 null 반환. 사진/PDF × preflight/postflight 경합 로컬 브라우저4개에서 원본 코드 실패 재현 | [#256](https://github.com/creno-va/baro/issues/256), PR257 최신 authoritative 인증 결과 추종과 owner/role/epoch 보호·작업별 대기 안내 수정. 원본 실패4개 포함 보호 반례·기존 흐름·진행 안내30개, quick/build 통과 | d2c825f 재현 → 71892c5 수정; f2a4fd5 실제 전체 흐름 재확인 | 실제 사진·PDF 모두 파일 선택→busy→접수→ready→프로필 연결·저장 성공. 사진 픽셀과 다운로드 PDF 두 쪽 실제 내용 확인. 저장 후 새로고침·재로그인 유지 |
| P08 | chat의 정확한 거절 문장 ‘소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.’가 audit 전에 POLICY_REJECTED | 금칙 키워드가 명시적 거절 문장에도 적용됨. 합성 재현이며 P01 실제 외부 원인과 구분 | PR260 chat 첫 줄 완전 일치만 구분; 전체 개인정보/원문 audit 및 나머지 필드 검사 유지. focused121검사502assert, quick 통과 | 71892c5 | 실제 외부 재확인 미확인 |
| P09 | 합성 PNG를 프로필 사진으로 선택하면 접수 후 자료 상태 확인에서 처리 실패. 실제 이미지 조회·연결 불가 | e1028b1 실제 dispatch unknown/0ms와 동일한 실패를 pinned workerd의 제품 proxy로 재현: 지원하지 않는 redirect:error에서 Request 생성 즉시 예외·native 호출0회. 별도 정제 후 R2 PUT bound 누락도 로컬 재현 | PR263 R2 물리 승인·writer/unknown 보존, PR266 지원되는 manual 요청 및 기존3xx 거절 유지. timeout·재시도·max_instances 변경 없음 | f2a4fd5 | 실제 PNG·PDF 모두 Workflow output ready, 저장·실제 조회 성공. 기존 실패 합성 사진1개 삭제 접수와 새로고침 후 목록 제외 확인; 원격 물리 정리는 미확인. 지연은 P04 계속 조사 |
| P10 | 리포트 R2 PUT 정확한 응답 뒤 writer 종료 기록 DB 오류를 주입하면 transport response를 unknown으로 덮음 | catch가 확인된 R2 응답과 sent 여부를 구분하지 않으며 종료 기록 실패가 cleanup을 막을 수 있음 | [#264](https://github.com/creno-va/baro/issues/264), 실제 response 보존·writer 종료와 cleanup 독립화. 원본 실패 재현 후 신규6검사30assert, 기존리포트 회귀·타입·독립검토 통과 | f2a4fd5 | 합성 R2와 실제 SQLite/runtime에서만 확인. unknown/잘못된 크기 응답은 writer running·의무 보존, 실제 외부 검증 대기 |
| P11 | 공식 법률 source v1/v2 요청이 외부 전송 전에 실패할 수 있음 | file processor와 동일한 redirect:error 옵션이 두 법률 transport에도 있음. pinned workerd의 Request 생성에서 해당 옵션이 동기 TypeError를 발생시키는 것을 재현 | 지원되는 manual로 변경하고 기존3xx 거절 유지. 301/302/303/307/308 × 두 transport에서 외부 Location 추종·재시도 없이 실패하는 반례 포함90검사553assert 통과 | f2a4fd5 | 실제 법률 질의 미확인. 과거 POLICY_REJECTED의 원인이라고 단정하지 않음 |

## 후속 수정·실제 재확인 대기

- f2a4fd5 실제 사진: 업로드 시작2026-10-14T15:35:34.779Z, busy5.543초·접수19.158초 관측 상한. Workflow 정제15:35:55~15:36:28UTC(32,957ms), 총33,430ms, output ready. 시작→서버 ready 약53.2초. 연결·저장3.957초 관측 상한, 새로고침 후 실제 초록 삼각형09 표시 유지 및 공개 익명 픽셀 확인.
- 같은 SHA 실제 PDF: 원본25,842B/2쪽, 시작15:39:17.468Z. Workflow 정제15:39:54~15:40:19UTC(24,750ms), 총25,109ms, output ready. 시작→서버 ready 약61.5초. UI 접수42.574초·ready98.426초는 늦은 관측의 상한이다. 다운로드136,621B PDF1.4/2쪽, SHA256 `2e35e10bd2ce364f05ff2d40867317d416e29655841a6486900543694c6eeeaf`. 두 쪽 모두 렌더하여 한글·영문 표식, BLUE BOX17·ORANGE CIRCLE42 확인. 공개 후 익명 다운로드도 동일 hash. 비공개·로그아웃 후 이전 링크 NOT_FOUND 확인. 프로필은 최종 비공개로 보존.
- 정제 지연 수정: current 검사를1 SQL로 통합하여 로컬 합성 factory111 D1 호출/147 SQL(각62 감소), 검사 시점31회 유지. 동의3버전·철회·삭제·source·lease·fence 반례 통과. 내부 Workflow의 고정 단계/duration만 추가하여 초기화·권한 확인·원본 열기·처리 응답·출력 준비/저장·게시·정리를 분리한다. 실제 preview 개선과 접수→Workflow 시작 구간은 아직 미확인.
- P04 추가 원인: 프로필 자료는 outbox commit 후 매분 cron만 실제 Workflow를 만들며, 앞선 정리 작업도 기다린다. 따라서 접수→실행 대기를 단순 native 처리 시간으로 보지 않는다. 현재 수정은 전체 업로드/readback 성공 뒤 해당 owner/job/runtime만 기존 CAS·동의·삭제 검사로 전달하고 동일900 SQL 제한과 cron 회복을 유지한다. 동시 cron 중복 방지·동의 철회·unknown/throw·foreground 실패·실행 context 부재·기존 meter 반례 통과. 실제 시간 개선은 배포 뒤 측정한다.
- P02 다음 진단은 고정 단계/실행 위치/시간과 마지막 측정 D1 상태만 메모리에서 기록한다. 25초 단일 snapshot과 테스트 종료 보완을 추가하며 DB/외부 호출·timeout 상향·재시도는 없다. 로컬 Bun timeout에서 종료 보완이 실행됨을 확인했다. 기존503 및 timeout의 선행 원인은 계속 미확정이다.
- [#268](https://github.com/creno-va/baro/issues/268) 고정 합성 intake 준비 도구는 PR270으로 병합했다. 실제 역할/동의·삭제·3건/일 quota와 암호화 저장을 지키며 단 한 건을 준비하고, UI 생성·Turnstile은 성공으로 표시하지 않는다. 현재 기존10/7 사건은 합성 표시가 없어 읽기만 했으며 테스트 입력을 추가하지 않았다. 원격 준비·UI readback은 미실행이다.
- f2a4fd5 고객 재로그인 뒤 기존 동의 완료·목록 로딩 종료, 선택 사용 지표 거부 뒤에도 목록과 사건 링크 유지 확인. 개인/기업 입력 선택 반응은 확인했으나 기업 사건 저장은 미확인이다.
- P09 / [#262](https://github.com/creno-va/baro/issues/262): 정제 결과의 단일 R2 PUT 기술 승인, 동일 claim의 물리 용량, 정확한 writer 종료·unknown 보존 경계를 연결했다. 실제 runtime factory 대역으로 가격/funding proof 없이 암호화 저장→복호화 원본 일치까지 확인했다. 원본 코드의 BUDGET_UNAVAILABLE 재현 후 집중42검사456assert, quick/build/DB 통과; 독립 검토의 writer-stop DB 장애 cleanup 누락·기존 fixture 물리 전제 2건을 수정하고 해당 회귀43개(중복 제외)와 타입 검사를 통과했다. 외부 성공으로 기록하지 않는다.
- P09 안전한 진단은 고정 stage/category/duration만 Worker 로그에 남긴다. 원문 native 로그, timeout, 재시도, max_instances는 변경하지 않는다. 별도4 suites26검사224assert로 안전한 진단·정리 경계를 확인했다. e1028b1 실제 로그에서 startup 실패가 아니라 dispatch 즉시 실패를 관측했다. SDK의 onError hook 뒤 원래 예외를 다시 throw하는 구현도 확인하여, 빈 onError가 startup 실패를 숨겼다는 가설은 배제했다.
- e1028b1 두 번째 합성 사진: 업로드 클릭2026-10-14T15:10:39.903Z, busy5.619초, 접수 안내17.229초(모두 UI 자동화 포함 관측 상한). 새 Workflow 정제 단계15:11:24~40Z, 제품 output stopped/FILE_PROCESSING_FAILED. 2026-10-15 00:11:39.400 KST Worker 진단은 stage dispatch/category unknown/durationMs0, entrypoint FileProcessorContainer/eventType alarm. 이후 pinned workerd의 동일 제품 proxy에서 같은0ms 예외를 재현해 지원하지 않는 redirect 옵션으로 좁혔다. 접수 뒤 정제 시작까지의 간격은 별도 지연 조사 대상이다. 실제 자료 상태 확인3.183초 상한 뒤 두 항목 모두 실패/재업로드 안내로 갱신되며 연결 버튼은 비활성화됨을 확인했다.
- redirect 수정 검사: container/lifecycle16검사106assert, 공유 workerd 회귀1검사4assert, 법률90검사553assert 및 응답 body 해제 후 변경된5검사30assert 통과. 공식 법률 v2 원본은 native Request 생성 실패로3회 재시도/upstream_unavailable, 수정 후1회/manual/합성 JSON 성공. 로컬 native 계약 검증이며 실제 외부 연동 성공이 아니다. 법률 두 커밋 독립 검토 추가 문제 없음.
- 71892c5 고객 Kakao 재로그인·역할 전환 후 합성 사건 입력을 다시 확인했다. 수동 Turnstile 체크가 계속 필요하여 완료하지 않았다. 취소 시 합성 입력 보존, 보안 확인 미완료 안내, 다시 시도·저장 버튼 복구를 확인했다. 사건 생성 자체는 여전히 미확인이다.

## 외부 설정 관측

- 현재 preview `f2a4fd50d06c0deba20515de2214bc6c6122de8c`: [main CI38589633724](https://github.com/creno-va/baro/actions/runs/38589633724), [배포38589926425](https://github.com/creno-va/baro/actions/runs/38589926425) 성공. live/ready 동일 SHA·schema0016 확인. PR265 리포트 receipt·중복 조회 제거와 PR266 redirect 수정 포함. production 미변경.
- 현재 main `9ec128e5a76148af1c87c7eb18fe447f0cf2bc66`: PR267 테스트 진단 보강. [main CI38590886330](https://github.com/creno-va/baro/actions/runs/38590886330) 성공, [full38591421650](https://github.com/creno-va/baro/actions/runs/38591421650) 2149 pass/1 fail. true native AI 시나리오30,037.86ms에서30초 테스트 timeout, false12,391.83ms 통과. 이번에는 API5xx/실패 receipt가 없어 앞선503의 재현이라고 할 수 없다. timeout 시점과 종료 후 오류를 조사하며 반복 실행하지 않는다.
- 이전 preview `e1028b13ff5ff1b85621961e77042f2b6652fd58`: [main CI38586148471](https://github.com/creno-va/baro/actions/runs/38586148471), [배포38586468409](https://github.com/creno-va/baro/actions/runs/38586468409) 성공. 다음 main `f8a7328f1b683ffdda32f06ea17afb00b1da438c`의 [full38586839689](https://github.com/creno-va/baro/actions/runs/38586839689)은2134 pass/1 fail(P02)이며 개별 preview 배포 없이 f2a4fd5에 포함됐다.
- 두 번째 preview `71892c5c6fa27175afd8557e7d4c738a0bfd27e8`: PR257~260 병합. [main CI38582009239](https://github.com/creno-va/baro/actions/runs/38582009239), [배포38582240689](https://github.com/creno-va/baro/actions/runs/38582240689) 성공. live/ready 동일 SHA·schema0016 확인. [full38582027656](https://github.com/creno-va/baro/actions/runs/38582027656)은 bun test 2099 pass/1 fail이며 이후 build/DB/browser/native 단계 미실행. production 미변경.
- 0016 배포 뒤 비용 읽기 [run38582642732](https://github.com/creno-va/baro/actions/runs/38582642732), 2026-10-14T14:40:52.317Z: 이전 reserved0/ambiguous21895 및 funding 관측 보존. 최초 실제 사진 업로드 전 admissions0/unpricedAdmissions0/knownObservedKrw null. null을 비용0으로 표현하지 않으며 기존 physical capacity100GB를 재초기화하지 않음.
- 첫 수정 preview: `d2c825fd593dcc18c056b825db463e91276100a2`, [main CI38577059453](https://github.com/creno-va/baro/actions/runs/38577059453), [배포38577245433](https://github.com/creno-va/baro/actions/runs/38577245433) 성공. live/ready 동일 SHA·schema0015를 직접 확인. PR252~255 포함이며 새0016 비용 분리는 아직 미포함.
- 같은 d2c825f의 진행 단계 변경 뒤 필요한 native D1 회귀 `ai-runtime-workerd.test.ts` 1회: true/false2검사194assert 통과(4.43초), 외부 provider는 대역. 간헐 원인이 해결됐다는 증거로 확대하지 않고 동일 상태 반복 검사는 하지 않음.

- 2026-10-14 22:57~23:00 KST Safari Cloudflare dashboard: Workers Paid plan 유지. preview/production AI Gateway 모두 Spend Limits OFF, Rate Limit Requests OFF, Collect Logs OFF, Authenticated Gateway ON, Zero Data Retention ON. 설정/결제 변경 없음.
- 같은 시점 AI Gateway 총관측: credit USD39.01, 요청103, token236.77k, 비용USD0.99. 이 값은 당시 UI 관측이며 원장의 관측 시각·금액을 덮어쓰지 않는다.
- preview 비용 상태 읽기 [run38575496184](https://github.com/creno-va/baro/actions/runs/38575496184): 2026-10-14T13:52:39.483Z, schema0015, control active, reserved0, ambiguous21895, recordedBlobs0/storageExecutions0/unfinishedJobs0/physicalBindings0. 비용 IO50은 물리/보안 한도가 아니며 false 모드 차단 근거로 사용하지 않는다. 가격·funding 존재를 누락 조건 검증과 혼동하지 않는다.

## 측정·증거 규칙

각 실제 검증에는 환경·SHA·시각·합성 시나리오·동작 시작/완료 시간·실제 저장/파일 내용을 기록한다.
접수/성공 문구만으로 통과시키지 않으며 외부 실패는 조건 변화 없이 반복하지 않는다.
원문/계정 식별자/cookie/token/오류 stack/SQL은 공개 기록에 넣지 않는다.
미확인·실패·외부 승인 범위는 완료로 바꾸지 않는다. 기록은 작업 중 갱신한다.
