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
| F010~011 / UI19~20 | 변호사 자기 프로필·사진·텍스트/이미지/PDF 포트폴리오 저장·재접속·미리보기·공개·철회 | d2c825f 실제 Kakao 변호사 로그인, 합성 프로필 저장(관측 상한3.534초)·새로고침 후 이름/사무실/연락처/지역 유지 확인. 텍스트 포트폴리오 저장·미리보기·실제 공개 및 익명 상세 본문 확인. 미저장 변경 계속 편집/버리기·저장 값 복원 확인. 재로그인 후 텍스트 유지, 비공개 전환 뒤 로그아웃·익명 상세 차단·목록 제외 확인. 71892c5 사진 접수·busy·서버 작업 생성 확인, 정제 실패(P09). PDF 실제 재확인 대기 |
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
| P02 | 간헐 작업 접수 실패 및 native full 실패. 실제 UI 실패와 테스트 실패를 분리 조사 | 과거 실패는 HTTP202·lease 획득 뒤 admission INTERNAL_ERROR. 71892c5 full에서는 비용 false 변형의 **false 전환 전 legacy true baseline** 첫 질문이 failed. runtime diagnostic unclassified/unknown이며 정확한 throw 위치 미확정 | PR251 진단 배포. 새 실패의 단계·시간·호출 수·안전한 DB 상태를 수집하는 test-only 진단 준비. timeout 변경 없음 | 71892c5 | full38582027656의 bun test 2099 pass/1 fail. 진단 추가 후 native 1회 2 pass/470assert/5.34초는 비재현이며 해결 증거 아님. 실제 UI 실패는 별도 확인 필요 |
| P03 | 비용 관측 원본 없는 신규 환경/필수 SKU 누락 시 기능 차단 가능 | `processing-proofs`가 가격/funding head·SKU를 필수 요구하고 기존 hold의 금액/FK가 실행과 결합 | PR253 비용 정산 DB 장애 격리. PR259 additive0016 기술 admission·선택적 비용 관측 분리. 독립 검토와 DB/native/복구/빌드 검증 통과. 원장/hold와 실제 값 보존 | 71892c5·schema0016 배포 | 실제 schema 및 이전 reserved/ambiguous 원장 보존 확인. 현행 preview 가격/재원은 존재하므로 누락 조건 실제 성공으로 기록하지 않음 |
| P04 | 주요 AI 흐름 및 업로드 장기 대기 | AI 단계가 admission으로 남던 문제 확인. 업로드는 합성 runtime에서79 SQL/52 D1 호출, 동일 물리 조건과 비용 관측 전용 접근 검사 중복4회 확인. 실제 네트워크/AI 지연 원인은 추가 측정 필요 | PR255 실제 AI 단계·단계 소요시간 배포. false mode 중복 조회만 제거해 합성 fixture75 SQL/48 D1 호출, 보안/용량/마감 경쟁 반례7개 및 기존49검사 통과 | AI 단계 d2c825f; 중복 조회 수정 미배포 | 로컬 SQLite/AES reserve5.5ms/upload21.1ms는 실제20.5초 구간의 원인·개선 증거가 아님. stage 시간은 admission/settlement 등 오버헤드를 포함하며 순수 provider latency로 표현하지 않음 |
| P06 | 설정 화면이 false 비용 모드에서도 ‘처리 예산이나 용량에 따라 대기’라고 안내 | 공통 한도 안내에 과거 비용 정책 문구 잔존 | PR258 실제 처리 용량·서비스 장애 안내로 수정 | 71892c5 | Safari 실제 설정 화면에서 비용 예산 안내 제거 및 AI200/일·문서/미디어/물리 한도 안내 유지 확인 |
| P07 | Safari 프로필 사진 image-markers.png 및 포트폴리오 text-two-pages.pdf 선택·업로드: 잠깐 busy 후 성공/실패 안내나 등록 자료 없이 종료 | file picker 복귀 focus의 인증 재조회와 upload verify가 같은 request counter를 공유. supersede 시 조용히 null 반환. 사진/PDF × preflight/postflight 경합 로컬 브라우저4개에서 원본 코드 실패 재현 | [#256](https://github.com/creno-va/baro/issues/256), PR257 최신 authoritative 인증 결과 추종과 owner/role/epoch 보호·작업별 대기 안내 수정. 원본 실패4개 포함 보호 반례·기존 흐름·진행 안내30개, quick/build 통과 | d2c825f 재현 → 71892c5 수정 배포 | 실제 사진은 busy 안내→자료 접수→Workflow 생성까지 진행하여 무응답 경합 해소 확인. 후속 정제 실패 P09로 전체 업로드 성공은 아님. PDF 실제 재확인 대기 |
| P08 | chat의 정확한 거절 문장 ‘소송 전략은 제공하지 않으며 사실과 자료 정리를 돕겠습니다.’가 audit 전에 POLICY_REJECTED | 금칙 키워드가 명시적 거절 문장에도 적용됨. 합성 재현이며 P01 실제 외부 원인과 구분 | PR260 chat 첫 줄 완전 일치만 구분; 전체 개인정보/원문 audit 및 나머지 필드 검사 유지. focused121검사502assert, quick 통과 | 71892c5 | 실제 외부 재확인 미확인 |
| P09 | 합성 PNG를 프로필 사진으로 선택하면 접수 후 자료 상태 확인에서 처리 실패. 실제 이미지 조회·연결 불가 | 23:41 KST 실제 정제 단계16.099초 후 FILE_PROCESSING_FAILED. Container Stopped, 상세 위치 Newark, VMStopped는 Workflow 종료5초 뒤 cleanup일 수 있어 원인으로 단정하지 않음. 15초 instance 확보 timeout은 가설이며 아직 미확정. 별도로 성공한 합성 sanitizer 응답 뒤 R2 PUT bound 누락으로 BUDGET_UNAVAILABLE가 발생하는 후속 결함은 로컬 재현 | 실제 Container/Workflow 증거 조사, 정제 결과의 물리 용량·writer 보호를 유지하는 저장 경로 수정 중. 동일 실패 조건의 업로드 반복 없음 | 71892c5 | 업로드 시작14:41:04.497Z, busy5.457초·접수 안내 관측33.268초(자동화 포함 상한). Workflow14:41:25~41Z, 총16.668초/정제16.099초. Workflow Completed는 제품 output stopped/FILE_PROCESSING_FAILED이므로 성공 아님 |
| P10 | 리포트 R2 PUT 정확한 응답 뒤 writer 종료 기록 DB 오류를 주입하면 transport response를 unknown으로 덮음 | catch가 확인된 R2 응답과 sent 여부를 구분하지 않으며 종료 기록 실패가 cleanup을 막을 수 있음 | [#264](https://github.com/creno-va/baro/issues/264), 실제 response 보존·writer 종료와 cleanup 독립화. 원본 실패 재현 후 신규6검사30assert, 기존리포트 회귀·타입·독립검토 통과 | 미배포 | 합성 R2와 실제 SQLite/runtime에서만 확인. unknown/잘못된 크기 응답은 writer running·의무 보존, 실제 외부 검증 대기 |

## 후속 수정·실제 재확인 대기

- P09 / [#262](https://github.com/creno-va/baro/issues/262): 정제 결과의 단일 R2 PUT 기술 승인, 동일 claim의 물리 용량, 정확한 writer 종료·unknown 보존 경계를 연결했다. 실제 runtime factory 대역으로 가격/funding proof 없이 암호화 저장→복호화 원본 일치까지 확인했다. 원본 코드의 BUDGET_UNAVAILABLE 재현 후 집중42검사456assert, quick/build/DB 통과; 독립 검토의 writer-stop DB 장애 cleanup 누락·기존 fixture 물리 전제 2건을 수정하고 해당 회귀43개(중복 제외)와 타입 검사를 통과했다. 외부 성공으로 기록하지 않는다.
- P09 startup 실패는 고정 stage/category/duration만 Worker 로그에 남기도록 진단을 추가한다. 원문 native 로그, timeout, 재시도, max_instances는 변경하지 않는다. 별도4 suites26검사224assert로 안전한 진단·정리 경계를 확인했다. 실제 startup 원인은 다음 배포 검증에서 확인해야 한다.
- 71892c5 고객 Kakao 재로그인·역할 전환 후 합성 사건 입력을 다시 확인했다. 수동 Turnstile 체크가 계속 필요하여 완료하지 않았다. 취소 시 합성 입력 보존, 보안 확인 미완료 안내, 다시 시도·저장 버튼 복구를 확인했다. 사건 생성 자체는 여전히 미확인이다.

## 외부 설정 관측

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
