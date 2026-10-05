# 보안 및 개인정보 설계

- Status: Required for public beta
- Data owner: CRENOVA
- Scope: web app, Worker, Workflow, D1, OAuth, AI and legal-source adapters

기존 섹션은 v1 통제이며 v2의 private 자료·공개 변호사 자산·심사·Container·리포트는
아래 확장과 [v2 실행 계약](../architecture/V2-CONTRACTS.md)을 추가로 따른다. 사업자 사실,
법률 검토·국외 이전/공급자 조건·실제 공개 승인은 별도 evidence가 필요하다.

## 위협 모델

보호 대상은 OAuth 계정, 세션, 사건 원문·답변·결과, 데이터 암호화 키, 외부 API secret,
서비스 가용성, 법률 인용 무결성이다. 주요 위협은 계정 탈취, IDOR, CSRF, prompt
injection, 모델의 데이터 재노출, 로그 유출, secret 유출, 자동화 남용, 출처 위조,
삭제 누락, 공급망 의존성이다.

## 데이터 분류

| 등급 | 예 | 저장·전송 규칙 |
| --- | --- | --- |
| Restricted | 사건 원문, 추가 답변, AI 결과, OAuth token | 필요 최소화, TLS, AES-GCM 저장, 로그·분석 금지 |
| Confidential | 이메일, provider account ID, 내부 실패·workflow ID | 권한 제한, 로그 시 해시/내부 ID 사용 |
| Internal | prompt/policy/schema, 운영 지표 | 저장소·운영자 접근 제한 |
| Public | 공개 법령 원문·정책 문서 | 무결성·버전 확인 |

주민등록번호, 계좌번호 전체, 제3자 연락처는 제품 기능에 필요하지 않다. 입력 UI에서
수집하지 말도록 안내하고 탐지 시 외부 전송 전 최소화한다. 완벽한 자동 마스킹을
보장하지 않으므로 Restricted 처리 자체는 유지한다.

## 인증과 권한

- Better Auth의 지원되는 session cookie와 OAuth state/PKCE 검증을 사용한다.
- OAuth scope는 기본 프로필·이메일의 실제 필요 범위로 제한한다.
- 상태 변경은 CSRF/origin 검사를 거친다.
- 모든 사건 쿼리는 session user ID를 repository 조건에 포함한다.
- 관리자용 사건 원문 열람 UI는 P0에 만들지 않는다.
- 운영 DB·secret 접근은 최소 인원, MFA, 개별 계정, 감사 가능한 경로만 허용한다.

## 암호화와 키

- 전송은 HTTPS만 허용하고 HSTS를 적용한다.
- Restricted 본문은 [데이터 모델](../architecture/DATA-MODEL.md)의 AES-256-GCM envelope를
  사용한다.
- Workflow event/params/step 저장 결과도 저장 경계다. 평문 대신 ID/revision/reference
  또는 envelope만 사용한다. Gateway caching도 끄고 provider 보존 조건은 따로 확인한다.
- 환경마다 별도 키를 쓰고 키는 코드·D1·로그에 저장하지 않는다.
- 키 ID만 행에 저장하며 최소 연 1회 또는 노출 의심 시 즉시 회전한다.
- production secret을 local/preview에서 사용할 수 없다.
- backup/복구 검증에는 복호화 가능성과 접근 통제를 모두 포함한다.
- 키 생성·등록·회전·분실 대응은 [사건 데이터 키 운영](../operations/CASE-DATA-KEYS.md)을 따른다.

## AI와 prompt injection

- 사용자 입력과 검색 원문은 명령이 아니라 데이터 경계로 전달한다.
- 도구 이름·URL·citation ID는 서버 allowlist에서만 선택한다.
- 모델은 네트워크와 DB에 직접 접근하지 않고 adapter가 전달한 최소 데이터만 본다.
- 모델 출력은 HTML로 신뢰하지 않고 텍스트/구조화 필드로 escape해 렌더링한다.
- payload log를 끄고 provider의 보존·학습·국외 이전 조건을 공개 전 법률·계약 검토한다.

## 남용과 가용성

- 사건 생성에 Turnstile Managed, IP/계정 단기 rate limit, 계정별 KST 하루 10회를
  겹쳐 적용한다.
- Turnstile token은 서버에서 hostname, action, 만료를 검증하고 재사용을 거부한다.
- API body size, 입력 길이, Workflow 동시 실행과 외부 호출 timeout을 제한한다.
- OAuth/Turnstile 장애 시 인증·남용 방지를 우회하지 않고 안전하게 실패한다.

## 로그와 분석

허용: request/analysis/workflow ID, route template, 단계, 상태 코드, latency, token count,
model ID, error code. 금지: URL query의 원문, request/response body, 이메일, OAuth token,
cookie, 프롬프트 본문, 사건 제목·원문·결과, 전체 IP. IP가 보안에 필요하면 단기 salt의
비가역 prefix hash 등 법률 검토된 최소 형태만 쓴다.

## 보존과 삭제

- 사건·결과: 사용자가 사건 또는 계정을 삭제할 때까지
- 인증 계정·동의: 계정 삭제까지. 법정 보관이 필요하다고 확정된 경우 정책과 구현을
  함께 변경한다.
- 보안·운영 로그: 기본 30일 이내, 목적 달성 후 자동 삭제
- 공개 법령 캐시: 개인정보가 아니며 최신성 정책에 따라 유지
- 삭제 요청은 primary D1에서 즉시 처리하고 platform backup의 만료·복구 시 재삭제
  절차를 운영 정책에 기록한다.
- 비민감 deletion journal은 backup 범위+5일 목표로 남겨 restore 시 재삭제한다. 목표
  35일과 실제 보존·Workflow 상태 제거는 #17/#20의 구현·정책 검증 조건이다.

## 보안 헤더

최소 `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, 제한적 `Permissions-Policy`,
frame embedding 차단을 배포 테스트한다. CSP는 OAuth와 Turnstile의 필요한 origin만
허용하고 inline script 예외를 일반화하지 않는다.
scaffold는 secure headers와 API body limit를 제공하며 CSP/Turnstile script 정책은
#18/#19에서 실제 Astro islands 및 widget과 함께 검증한다. Workers 자동 invocation log는
OAuth callback query의 code/state 노출을 피하도록 끄고, 향후 로그는 allowlist만 출력한다.

## 사고 대응

1. 탐지: 민감 로그, 권한 우회, 키/토큰 노출, 인용 변조, 삭제 실패를 P0으로 분류한다.
2. 봉쇄: 배포 중단, 영향 route/model 차단, 세션·secret·키 회전.
3. 조사: request ID와 비민감 메타데이터로 범위 확인. 원문을 새 로그에 복사하지 않는다.
4. 복구: 수정·검증·단계적 배포, 필요 시 영향 결과 숨김과 재분석.
5. 통지: 관계 법령과 계약상 기한을 법률 담당과 판단하고 기록한다.
6. 사후: 원인·통제 실패·후속 owner와 기한을 남긴다.

## 공개 전 차단 항목

- 정책 초안의 사업자 주소·등록번호와 국외 이전 세부사항 확정
- 개인정보 처리방침·이용약관·AI 고지 법률 검토
- Google/Naver/Kakao/Cloudflare AI Gateway 실제 계약·콘솔 설정과 공개 문구 일치 확인
- 삭제·키 회전·backup 복구 drill 완료
- SAST/dependency/secret scan, IDOR/CSRF/XSS, rate limit, prompt injection 테스트 통과

## 법률 참고

- [개인정보 보호법 제30조](https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029335711)
- [개인정보 보호법 제28조의8](https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1034292881)
- [개인정보보호위원회 정책·지침](https://pipc.go.kr/np/cop/bbs/selectBoardList.do?bbsId=BS217&mCode=D010030000.Updated)

## v2 자료·프로필의 데이터 경계

원본 증거를 보존하기 위해 v2 업로드의 이름·식별정보를 임의 삭제하지 않는다. 사용자에게
불필요한 민감정보 업로드를 줄이도록 안내하지만 원본은 private Restricted로 다룬다.
외부 AI 입력은 필요한 최소 구간만 선택/최소화하며 원본 보존과 별도다. PDF 내보내기의
식별정보 유지 기본값과 사용자 마스킹·제외 검토를 제공하고, PDF 표시 마스킹이 ZIP의 원본
byte까지 제거했다고 주장하지 않는다. 공개 portfolio의 제3자 정보는 별도 검토·동의/게시 근거가
필요하며 실제 자격·대리 권한·법률 승인 사실을 만들어내지 않는다.

| 영역 | 저장/권한 | 위험 통제 |
| --- | --- | --- |
| 사건·채팅·요약·자료·보고서 | owner-only D1 envelope/private R2 chunked AEAD | IDOR·cross-owner blob/job/report·cache 차단, 로그·QA artifact 금지 |
| 변호사 인증 서류 | private staging, applicant/지정 심사 권한 | 사건 namespace와 key permission 분리, 공개 projection 제외 |
| 승인 전 profile/portfolio | private staging·revision | 제출본 불변, 심사자 자기 승인 금지, pending 수정의 공개본 오염 차단 |
| 승인된 공개 profile/portfolio | public projection/public R2의 안전화된 파생본 | 공개 허용 항목만, 승인 pointer·withdraw/delete·CDN purge |
| Container/Workflow | opaque refs/encrypted state, job별 일시 평문 | shared disk/로그/state snapshot 금지, 종료/실패 정리·late write guard |

심사자 역할은 DB/route 권한으로 제어하고 case decrypt repository를 호출할 권한이 없다.
심사 화면의 사건 원문 링크·검색·다운로드를 만들지 않는다. 운영 합계·허용된 verification
문서만 볼 수 있다. 로그인 사용자 role 전송, 화면 경로, 임의 object key로 권한을 얻을 수
없다. 자신의 일반 사용자 사건을 읽는 권한과 심사 역할은 별도 조건이다.

## v2 대형 파일과 실행 격리

file DEK는 환경 KEK로 wrap하고 원본/파생물/report의 chunk마다 새로운 IV와
owner/file/revision/part/length AAD를 사용한다. 순서·총길이·hash manifest와 암호 tag를
검증해 교체·잘림·복제 공격을 막는다. Worker upload gateway는 bounded part를 받아 암호화
뒤 private R2에 쓴다. private bucket에 r2.dev/custom-domain 공개 경로를 켜지 않는다.
key filename/header metadata도 공개하지 않는다. 플랫폼 R2 기본 암호화는 별도 application
key/소유권·삭제 요구를 대신하지 않는다.
[R2 data security](https://developers.cloudflare.com/r2/reference/data-security/)

MIME/magic/크기·PDF 페이지·media duration을 서버 검증한다. 압축 폭탄·decoder 폭증·
path traversal·shell injection·office 매크로·PDF JavaScript·SVG/HTML·외부 참조·SSRF를
거부/안전화한다. 파일명과 command argument를 연결한 shell 실행을 하지 않는다. renderer는
파일명/text를 escape하고 portfolio는 안전한 별도 origin/content-disposition 정책으로 제공한다.
avatar 이미지에서도 EXIF·불필요한 식별정보를 제거하며 임시 브랜드 SVG와 사용자 SVG를
같은 신뢰 수준으로 다루지 않는다.

Container Node/Docker 예외는 top-level 별도 package에 한정하고 Worker source boundary는
그대로 유지한다. non-root image·pinned digest·최소 도구·시간/메모리/disk/동시 job 상한·
network allowlist와 인증된 Worker/DO 경로를 갖춘다. Container에 영구 AI/법률 key·bucket-wide
R2 token·환경 KEK를 제공하지 않는다. job capability는 대상/작업/시각/nonce/revision에 제한하고
삭제/취소/재전송 때 gateway가 살아 있는 job을 확인한다. 일시 평문은 job별 디렉터리에서
finally/shutdown 정리하며 disk snapshots/FUSE를 평문 보존 수단으로 쓰지 않는다.

## v2 동의·공개·보존과 복구

자동 파일 처리·외부 AI/ASR/Container 목적·처리 위치·보존·제3자 자료 권한을 정책 초안과
UI에 반영하고 동의 version을 job admission snapshot으로 기록한다. privacy/필수 정책 변경은
새 처리에 재동의를 요구하지만 자신의 과거 자료 읽기·다운로드·삭제를 차단하지 않는다.
공식 법률 API query와 모델 prompt에는 자료에서 얻은 개인 식별정보를 무조건 전달하지 않는다.
Whisper의 Cloudflare-hosted 경로와 third-party Gateway provider 조건을 구분해 검증한다.

사건·원본·파생물·채팅·보고서는 사용자가 삭제할 때까지 보존한다. 임시 업로드·Container
일시 평문·단기 download capability는 처리/취소 후 정리한다. 검토 서류의 보존 기간과
공개 프로필 철회 후 보관 근거는 정책 승인에서 명시하고 편의를 위한 영구 shadow copy를
만들지 않는다. profile/verification 삭제는 account 삭제의 별도 public purge 단계까지 포함한다.

삭제 admission은 session/job/download 권한을 폐기하고 tombstone+비민감 cleanup journal을
남긴다. D1 primary cascade만으로 file/Workflow/Container/CDN 삭제 완료를 주장하지 않는다.
불명확한 R2 write·늦은 job·부분 업로드·obsolete report를 reconciliation에서 대조한다.
복구 시 deletion journal을 먼저 적용한 다음 key/DEK manifest·R2·public pointer·CDN 상태를
검증한 뒤 traffic/jobs를 연다. journal을 복원한 D1 안에만 보관해 삭제 사실이 사라지게 하지 않는다.

다운로드 PDF·ZIP은 사용자가 직접 전달한다. 외부 수신처로 자동 업로드/메일/상담 메시지를
보내지 않는다. public-beta 미승인 상태의 production 코드 배포와 일반 사용자 공개 전환을
구분한다. 실제 provider·법률 승인·사업자 사실·공개 정책이 없으면 gate를 닫아 둔다.
전체 threat/실패 검증은 [v2 시연 증거](../quality/V2-UI-EVIDENCE.md)에 연결한다.
