# 프리베타 MVP 실제 인수 추적

- 시작: 2026-10-14 KST, #71. 직접 사용자 지시에 따른 preview 우선 검증.
- 작업 브랜치: `codex/71-preview-mvp-completion` → `codex/71-live-verification`.
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
| F010~011 / UI19~20 | 변호사 자기 프로필·사진·텍스트/이미지/PDF 포트폴리오 저장·재접속·미리보기·공개·철회 | d2c825f 실제 Kakao 변호사 로그인, 합성 프로필 저장(관측 상한3.534초)·새로고침 후 이름/사무실/연락처/지역 유지 확인. 텍스트 포트폴리오 저장·미리보기·실제 공개 및 익명 상세 본문 확인. 재로그인 후 텍스트 유지, 비공개 전환 뒤 로그아웃·익명 상세 차단·목록 제외 확인. 사진/PDF 업로드 무반응(P07) 수정 후 재확인 대기 |
| F012 / UI17~18 | 익명 목록/프로필, 검색/필터/페이지/부족 결과, 연락/길찾기 URL | d2c825f 익명 목록·합성 프로필 상세·이름+서울+부동산 결합 검색(관측 상한1.352초)·새로고침 조건 유지·불일치 형사 필터 결과 없음·초기화 복구 성공. 이메일 href 확인, example.org 외부 상담·네이버/카카오/Google 지도 실제 화면 이동과 합성 목적지 전달 확인. 실제 메시지/전화 미발송. 복수 페이지 경계는 미확인 |
| F014 / UI24~26 | 합성 자료/사건 삭제·재인증·늦은 완료 차단·legacy 보존 | 미확인 |
| F015 | 비용 관측 누락/만료/금액 비차단, quota/물리/보안 유지, 실제 원장 보존 | 코드·외부 설정 조사 중 |
| UI27~28,30~34 | 화면 폭·키보드·CSP·동의/재동의·역할/소유권·새로고침 | d2c825f 고객 역할로 /lawyer 직접 진입 시 편집 숨김·변호사 로그인 안내 확인. 다른 권한/소유권 시나리오 미확인 |
| 최종 릴리스 | 변경별 검사·최종 SHA full·preview 전체 핵심 흐름·동일 SHA production | 미완료; production 배포 미실행 |

## 단일 문제 목록

| ID | 재현 방법 / 사용자 영향 | 확인된 원인 | 수정 / 상태 | 배포 버전 | 재확인 결과 |
| --- | --- | --- | --- | --- | --- |
| P05 | Kakao OAuth 후 `/login?error=oauth&error=account_not_linked`; 로그인 불가, 일반 재시도 안내만 표시 | `disableImplicitLinking=true`가 검증된 동일 이메일도 차단. 중복 error query에서 첫 값만 읽음 | PR252 병합: 양쪽 검증된 이메일 연결·owner 보존·중복 오류 안내. DB20검사175assert와 로컬 브라우저 callback 안내 검사 통과 | preview1059887에서 재현 → d2c825f 수정 배포 | Safari 실제 Kakao 로그인 성공(클릭→callback 화면4.95초 상한, UI 자동화 포함), 기존 동의 완료·10/7 기존 사건 목록 유지. DB 삭제 없음 |
| P01 | 기존 법률 질의 POLICY_REJECTED; 답변 미제공. 현재 preview에서 합성 법률 질문으로 재현 예정 | 미확정. 제공자 거절·출처·draft/audit 정책을 구분해야 함 | PR250 진단 및 PR254 검증된 sourceClaims의 공식 출처 반영 배포. 실제 법률 질문 재현 후 policyReason 확인 필요 | d2c825f | 미확인 |
| P02 | 간헐 작업 접수 실패 및 native full 실패. 실제 UI 실패와 테스트 실패를 분리 조사 | native 과거 실패는 HTTP202·lease 획득 뒤 admission INTERNAL_ERROR. true/false 비용 모드 모두 발생. 단순 접수 거절/lease renew false와 다름. 정확한 throw 위치 미확정 | PR251 실패 진단/fixture 수정 배포. 이미 통과한 반복 검사는 중단 | d2c825f | 이전 full 실패는 미해결 유지. 실제 UI 실패 원인은 별도 재현 필요 |
| P03 | 비용 관측 원본 없는 신규 환경/필수 SKU 누락 시 기능 차단 가능 | `processing-proofs`가 가격/funding head·SKU를 필수 요구하고 기존 hold의 금액/FK가 실행과 결합 | PR253 비용 정산 DB 장애 격리 병합. additive0016 기술 admission·선택적 비용 관측 분리 구현 중. 원장/hold와 실제 값 보존 | PR253 정산 장애 격리는 d2c825f 배포; 0016 미배포 | 현행 preview 가격/재원은 존재하므로 누락 조건 성공으로 기록하지 않음 |
| P04 | 주요 AI 흐름 장기 대기 | 이전60초 timeout→120초 변경만 존재. 실행 중 단계가 admission으로 남아 사용자에게 실제 진행 구간을 알리지 못함. 현재 실제 단계별 지연 원인은 미확정 | PR255 실제 generation/retrieval/audit/publication 단계·단계 소요시간·새로고침 진행 상태 배포 | d2c825f | stage 시간에는 admission/settlement 등 해당 구간 오버헤드 포함. 순수 provider latency로 표현하지 않음 |
| P06 | 설정 화면이 false 비용 모드에서도 ‘처리 예산이나 용량에 따라 대기’라고 안내 | 공통 한도 안내에 과거 비용 정책 문구 잔존 | 실제 처리 용량·서비스 장애 안내로 수정 | d2c825f에서 재현; 수정 미배포 | 배포 후 재확인 예정 |
| P07 | Safari 프로필 사진 image-markers.png 및 포트폴리오 text-two-pages.pdf 선택·업로드: 잠깐 busy 후 성공/실패 안내나 등록 자료 없이 종료 | file picker 복귀 focus의 인증 재조회와 upload verify가 같은 request counter를 공유. supersede 시 조용히 null 반환. 사진/PDF × preflight/postflight 경합 로컬 브라우저4개에서 원본 코드 실패 재현 | [#256](https://github.com/creno-va/baro/issues/256), PR257 최신 authoritative 인증 결과 추종과 owner/role/epoch 보호·작업별 대기 안내 수정. 원본 실패4개 포함 보호 반례·기존 흐름·진행 안내30개, quick/build 통과 | d2c825f 실제 UI 재현 | 두 종류 모두 재현, 자료 상태 확인 후에도 빈 목록. 업로드 성공으로 기록하지 않음 |

## 외부 설정 관측

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
