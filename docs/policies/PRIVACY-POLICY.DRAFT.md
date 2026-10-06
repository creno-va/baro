# 개인정보 처리방침 (v2 공개 초안)

- Status: Draft — legal/business/processing/publication review required
- 문서 버전: 2026-10-06-v2-draft
- 시행 예정일: `[PUBLICATION_BLOCKER: 실제 처리·법률 검토·동의 구조·게시 승인 확정]`

#53의 구현 목표를 위한 문서다. R2·Containers·Whisper·지속 workspace가 실제 운영 중이거나
새 정책에 동의가 끝났다는 증거가 아니다. 기존 2026-10-04-draft와 v1 동의 기록은 보존하고
새 기능의 목적·항목·국외 처리 변경을 실제 공개 정책/동의 버전과 함께 검토한다.

## 1. 개인정보 처리자와 이용 대상

기존 초안의 CRENOVA / 황은찬 / hechec3534@naver.com / 010-4580-3534는 확인 대상 정보다.
실제 사업자 실체·주소·등록번호·책임자 역할과 연락 가능 여부를 확인한 뒤 공개본에 넣는다.
`[PUBLICATION_BLOCKER: 처리자 상호·대표자·주소·사업자 정보·개인정보 책임자·문의처 검증]`

만 14세 이상을 대상으로 하고 가입 때 연령 확인을 받되 생년월일을 수집하는 기능은 계획하지
않는다. 만 14세 미만 이용이 확인되면 처리 제한과 삭제 조치를 한다. 회사 사건도 단일 작성자
계정 소유로 관리하며 조직 공동 접근을 자동 부여하지 않는다.

## 2. 목적·항목·수집 방식

| 목적 | 처리 항목 | 방식/공개 범위 |
| --- | --- | --- |
| 로그인·계정 | 공급자 식별값·이름/프로필명·email·제공 시 프로필 이미지·세션 | Google/Naver/Kakao OAuth; 비공개 |
| 동의·권한 | 정책/AI/자료 처리 동의 버전·시각·14세 이상 확인·신뢰된 역할 | 이용자 확인·서버 생성; 비공개 |
| 사건 준비 | 서술·질문/답변·모름/건너뛰기·요약 revision·chat·사람/사실/타임라인·행동·출처 | 입력/AI 생성/이용자 수정; owner에게만 |
| 자료 처리 | 원본·filename/format/bytes/duration/pages·text/OCR·음성 전사·sampled frame·timestamps/coverage/gaps | 업로드·Container·ASR/AI; 비공개 |
| 리포트 | 사실/주장/미확인·상반/불리 자료·출처·편집/가림/제외·PDF/선택 원본 ZIP | 이용자 확인 후 생성/download; 비공개 |
| 역할·자기 프로필 관리 | 본인이 선택한 고객/변호사 역할·프로필 초안/revision·공개 항목/시각 | 로그인 계정의 자기 프로필만; 선택은 자격 확인 아님 |
| 공개 프로필 | 이름·사진·소개·주소·분야·전화/email/외부 링크·활동 제목/이미지/PDF 포트폴리오 | 본인 공개 동의와 최신 공개 revision만 비로그인 제공 |
| 기존 확인 자료·심사 기록 | 기존 backend에 존재하는 자료와 결정 | 과거 기록 보존; MVP에 신규 심사/어드민 이용 흐름을 제공하지 않음 |
| 제한·비용·삭제 | opaque operation/job/file ID·사용량/예약/actual 비용·상태·삭제 tombstone/inventory | 서버 생성; owner 상태/운영 aggregate |
| 보안·장애 | request/workflow/job ID·route template·status·latency·고정 error 코드 | application allowlist; 플랫폼 수집은 별도 확인 |
| 선택 지표 | 가명 분석 ID·허용 UI 이벤트·사건 ID HMAC hash | 명시적 opt-in, 해당 탭 sessionStorage |
| 선택 피드백 | helpful boolean·분석 reference | 독립 선택 요청, D1 |

비밀번호·OAuth access/refresh token·IP/UA를 애플리케이션 인증 테이블에 보관하는 기능은
사용하지 않는다. 그러나 공급자/edge 보안 처리에서 접속 정보가 처리될 수 있으므로 실제
플랫폼 설정과 항목을 별도로 확인한다. 사건 자료에는 이용자/제3자의 민감정보가 들어갈 수
있다. 입력 권한과 필요 범위를 확인하고 불필요한 주민등록번호·전체 계좌번호·신분 자료를
사건에 넣지 않는다. 자격 확인용 자료는 사건 업로드와 다른 최소 항목/권한으로 제한한다.
`[PUBLICATION_BLOCKER: 민감정보·고유식별정보·제3자 정보의 적법 처리 근거·최소화·동의 검토]`

## 3. 처리 흐름과 선택

사건 입력→작은 질문 묶음→이용자 요약 확인→지속 chat/행동·자료 정리→리포트 검토→download
순서로 처리한다. 모름·건너뛰기·중단·재개를 지원한다. 검증되지 않은 사실을 확정하거나 AI가
법률/수임 결정을 내리도록 사용하지 않는다. 사건 내용을 분석한 변호사 적합도 순위를 만들지 않는다.

자료별 자동 분석·외부 AI/음성 처리 목적과 범위를 확인한 후 job을 시작한다. 거부/철회하면
새 자동 처리를 시작하지 않고 진행 중 job 취소·늦은 결과 차단을 수행한다. 원본 보관과
삭제/내보내기 이용 가능 범위는 실제 기능·동의 구조에서 명확히 안내한다. 전역 quota/예산 부족은
대기로 표시한다. 기존 동의만으로 새로운 media/공개 프로필/국외 처리를 자동 허용하지 않는다.

Container는 job에 필요한 한 파일의 평문 stream을 임시 처리하고 환경 master key나 전체
사건 snapshot을 받지 않는다. Workers가 `llm-gateway`에서 AI/ASR을 호출하고 `legal-retrieval`에서
공식 법령·판례·기관 자료를 조회한다. source 조회에는 필요한 개념을 최소화하며 사용자 원문/
식별정보를 검색어로 그대로 보내지 않도록 설계한다. 텍스트·private 파일은 애플리케이션
암호화로 보관하지만 처리·전사·AI 생성에 필요한 구간은 해당 처리자에게 평문으로 전달될 수 있다.

변호사는 공개할 자기 프로필을 저장하고 공개 범위를 확인·동의한 뒤 직접 게시한다. 기존 작은
JPEG 사진은 encrypted D1 snapshot에 보관하며 새 사진·포트폴리오 파일은 기존 #58/#59 API의
R2 private 원본→정제 derivative를 사용한다. 정제 완료한 자기 사진/portfolio만 프로필에 연결하며
public serving에서 최신 공개 revision·role·현재 동의·삭제 상태와 자산 owner/profile/purpose/ready를
검사한다. self-service 자산은 private R2의 정제된 derivative를 권한 검사한 API로 제공한다.
원본·private 사건 파일·신분/자격 증빙·처리 중 자료를 공개 endpoint로 제공하지 않는다.
기존 심사 승인 공개 R2 copy와 그 증거는 별도로 보존하며 이번 MVP에 심사 UI를 추가하지 않는다.

사진·포트폴리오의 권리/제3자 식별정보와 공개 자료의 저장·전달 가능성을 확인한다. 공개된
프로필의 수정은 새 저장 revision에 반영된다. 비공개 전환·role 변경·현재 동의 불일치·계정/자산
삭제 후 신규 공개 제공과 진행 중 자료 stream을 차단한다. 제3자가 저장한 사본까지 파기할 수는
없다. 역할 선택과 프로필 저장은 변호사 자격 확인이나 법률 승인 증거가 아니다.

## 4. 제3자 제공·처리위탁·국외 이전

아래는 실제 계약/계정 설정으로 확정해야 하는 예정 처리 경로다. 법인명·국가·시점/방법·항목·
기간·근거·거부 방법과 서비스 영향을 확인한 뒤 필요한 고지/동의를 갖춘다. 공개 문서만으로
실제 계약이나 ZDR·국내 전용 처리를 확정하지 않는다. 국외 처리에는 개인정보 보호법 제28조의8
등의 근거/고지 요건을 법률 검토로 확정한다.
[개인정보 보호법 제28조의8](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1034292881)

| 처리자/외부 경로 | 목적·전달 범위 | 확정되지 않은 사항 |
| --- | --- | --- |
| Google/Naver/Kakao | 로그인 요청·공급자 인증/식별 | 실제 계약 법인·처리 국가·token 처리/보존·거부 영향 |
| Cloudflare Workers/D1/Workflows/KV/R2 | hosting·계정/사건/private 원본/파생/report·self-service 공개 derivative 및 과거 승인 public assets·삭제/보안 | 법인·region/전송/보관·backup/로그 기간·접근/삭제 조건 |
| Cloudflare Containers/DO | job-scoped 임시 document/image/audio/video 처리·상태 | 실행/egress 국가·temporary disk/로그·종료/삭제 보장 |
| Cloudflare Workers AI/Whisper 경로 | audio 전사·영상 audio/선택 frame 처리에 필요한 자료 | 실제 모델/수탁 법인·처리 국가·전달 범위·보존/학습/삭제 조건 |
| AI Gateway와 모델 공급자(현재 합의 OpenAI 경로) | 최소화된 사건·파일 추출 정보와 생성 지시 | Unified Billing 계약·법인·국가·provider 보존/학습·ZDR 실제 적용 |
| 공식 법령/판례/기관 사이트 | 최소 개념·문서 ID/version 조회 | credential 사용 조건·접속 정보·검색 데이터 처리 조건 |
| Naver/Kakao/Google 지도·외부 상담 사이트 | 이용자가 주소/외부 link를 직접 열 때 | 외부 사이트의 별도 정책·접속 정보 처리 |

`[PUBLICATION_BLOCKER: 각 수탁/제공 구분·실제 법인·국가·항목·시점/방법·근거·기간·보호조치·거부 영향 확정]`

제품 요청의 `collectLog:false`, `skipCache:true`, `store:false`와 Gateway logging/cache OFF는
모든 공급자/platform 보존·학습 없음이나 ZDR 계약을 보장하지 않는다. 실제 settings/예외 logs/
tail/Container process output·접근/기간과 계약을 함께 확인한다. 선택 지표를 외부 analytics
공급자에 전송하거나 사건 내용을 모델 학습 자료로 임의 전용하는 기능은 제공하지 않는다.

BARO는 사건 자료를 변호사에게 자동 제공하지 않는다. 이용자가 PDF/선택 원본을 download해
외부로 전달하는 것을 직접 결정한다. 전화/email/상담 링크를 열면 해당 외부 관계의 정책이
적용된다. 내부 상담 메시지와 수임 결제는 없다. 공개 프로필 게시·신고 처리의 제3자 제공
해당 여부와 근거도 실제 구조를 검토한다.

## 5. 보관 기간

| 항목 | 목표/확정 경계 |
| --- | --- |
| 계정·동의·private 프로필·기존 자격 자료 | 계정/자료 삭제까지 목표; 기존 증빙/법정 보존 근거·최소 기간은 미확인 |
| 사건·chat·요약·행동·원본/파생/PDF/ZIP | 이용자가 사건/자료 또는 계정을 삭제할 때까지 |
| 공개 프로필/자산 | 본인이 선택한 공개 기간; 비공개·role 변경·동의 불일치·삭제 시 제공 차단, 원격 정리는 별도 절차 |
| 세션 | 만료·logout·계정 삭제까지 |
| 임시 Container 평문·부분 upload/export | job 종료·실패·취소/만료 시 정리; sleep만으로 삭제 완료를 보장하지 않음 |
| 기술/보안 logs | 30일 이내 목표, 실제 platform/provider·계약/접근 설정 확인 후 확정 |
| opaque 삭제 journal | backup window+5일, 목표35일; 미완료/실패는 해결 전 만료시키지 않음 |
| 비용·심사/신고 기록 | 최소 비민감 항목, 법정 보존 근거/항목/기간을 검토하고 공개본에 확정 |
| 선택 UI 지표 | 탭 sessionStorage 최대500개, 철회 시 삭제; browser session 복원 시 재보관 가능 |
| helpful boolean | 관련 사건/분석/계정 삭제까지; 지표 동의 철회와 독립 |

사용자가 삭제하지 않은 사건을 일정 기간 경과나 비용 때문에 자동 파기하지 않는다. 신규
admission은 저장/유지비 예측과 예산으로 제한한다. 실제 platform backup 기간이 journal
목표35일과 같다고 쓰지 않는다. 별도 법정 보존이 필요하면 해당 근거·항목·기간과 접근 분리를
확정한다. `[PUBLICATION_BLOCKER: 실제 보존·backup/국외 처리·증빙/비용 기록의 기간과 파기 검토]`

## 6. 파기와 복구 재삭제

최근 실제 OAuth 재인증·명시적 DELETE 확인 후 primary 접근과 모든 세션을 즉시 폐기하고
opaque deletion journal을 원자적으로 기록한다. 원본·part·파생·report/ZIP·job·public 자산/
cache는 durable cleanup으로 비동기 삭제한다. 202는 접수/primary 접근 차단이며 모든 원격
상태/backup의 즉시 파기 완료가 아니다. partial failure는 완료로 표시하지 않고 해결한다.

취소된 Container/Workflow의 늦은 응답이 삭제 자료를 재등록하지 못하도록 가드한다. backup
복구는 DB 밖 최신 삭제 journal을 traffic/cron/dispatch/processing/public serving 재개 전에
적용한다. 필요한 key/복구 inventory가 없거나 삭제 검증이 실패하면 재개하지 않는다.
이미 download·외부 전달된 자료와 인터넷 제3자가 저장한 공개 copy를 원격 파기할 수 있다고
보장하지 않는다. 서비스가 통제하는 public pointer/object/cache의 철회·삭제는 수행한다.

## 7. 권리·안전 조치

이용자는 자신의 자료 열람·수정·처리 동의 철회·삭제·계정 종료를 요청할 수 있다. 공개 프로필
수정은 저장한 revision과 공개 여부를 구분해 안내한다. 개인정보 열람/정정/삭제/처리정지·
법률상 권리 행사와 대리인 확인은 실제 문의처에서 본인/권한을 확인한 뒤 관련 법령에 따라 처리한다.

환경별 key/secret·소유권/역할·전송 암호화·private text/chunk 저장 암호화·job-scoped capability·
CSP·최소 권한·bounded 비용/삭제·취약점 검증을 적용하는 목표다. 앱 logs/artifact에는 원문·
filename/file hash·OCR/transcript/frame·신분 자료·token/cookie·signed URL·SQL/stack을 넣지 않는다.
변호사 역할로 고객 사건 원문에 접근하는 권한을 제공하지 않는 것을 목표로 한다. 동일 owner의 고객→변호사
전환 후 사건/chat/private 자료 차단은 4번 공유 역할 가드 통합·검증이 남아 있으며 공개 전에 확인한다.
MVP에 어드민/심사 UI를 추가하지 않는다.

## 8. 쿠키와 선택 지표

인증/보안 쿠키가 필요하다. 선택 지표는 opt-in 후 탭 sessionStorage에 허용 UI 이벤트·무작위
분석 ID·salt와 사건 ID HMAC hash만 최대500개 저장하며 익명정보가 아닌 가명정보로 취급한다.
철회 시 지표/ID/salt/진행 기록을 삭제하고 거부해도 사건 이용 자격에 영향을 주지 않는다.
브라우저가 종료된 탭 세션을 복원할 수 있으므로 탭 종료 즉시 영구 파기를 보장하지 않는다.
helpful boolean은 별도 선택 요청으로 D1에 저장되고 지표 철회로 자동 삭제되는 것은 아니다.
`[PUBLICATION_BLOCKER: 실제 cookie 이름/기간·tab 지표/피드백 목적·가명정보·동의/철회 고지 승인]`

## 9. 변경·문의·게시 승인

처리 목적·항목·public 게시·공급자/국외 처리·보존의 변경은 버전/시행일·영향을 알리고 법률상
추가 고지/동의 필요성을 확인한다. 기존 사건의 동의 기록을 덮어쓰지 않는다. 문의와 권리구제
기관 정보는 실제 담당/최신 공식 연락처 검증 뒤 공개본에 넣는다. #70의 qualified human review와
사업자/공급자/보존 근거, #71의 실제 기능/처리/삭제 증거 없이는 Approved 상태로 바꾸지 않는다.

## 10. 현재 코드의 동의 경계와 공개 전 확인

개발용 필수 동의는 `2026-10-04`, 이 v2 초안/화면은 `2026-10-06-v2-draft`이며 게시 승인 전이다.
파일 예약은 현재 `aiNoticeVersion`을 `autoProcessConsentVersion`으로 전달하고 서비스가 현재
필수 동의와 대조한다. 이 기술적 검사만으로 국외 처리/민감정보에 필요한 법률상 동의 구조가
충족되었다고 판단하지 않는다. 자료별 자동 처리 거부·철회 및 진행 중 job 차단의 실제 UI/원격
효과는 #58/#59/#67/#71에서 확인해야 한다. 구현 목표를 완료 사실로 표시하지 않는다.

프로필 공개 기술 기록은 `mvp-self-profile-public-v1`과 항목·시각·revision이며 약관/국외 처리
동의 승인 버전을 대신하지 않는다. #20/#70의 실제 법률 검토·사업자·국가·계약·보존·게시 증거가
없으므로 blocker와 Draft를 유지한다. [필드별 인계](../development/LAWYER-POLICY-HANDOFF.md).
