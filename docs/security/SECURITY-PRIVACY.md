# 보안 및 개인정보 설계

- Status: Required for public beta
- Data owner: CRENOVA
- Scope: web app, Worker, Workflow, D1, OAuth, AI and legal-source adapters

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
- 환경마다 별도 키를 쓰고 키는 코드·D1·로그에 저장하지 않는다.
- 키 ID만 행에 저장하며 최소 연 1회 또는 노출 의심 시 즉시 회전한다.
- production secret을 local/preview에서 사용할 수 없다.
- backup/복구 검증에는 복호화 가능성과 접근 통제를 모두 포함한다.

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

## 보안 헤더

최소 `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, 제한적 `Permissions-Policy`,
frame embedding 차단을 배포 테스트한다. CSP는 OAuth와 Turnstile의 필요한 origin만
허용하고 inline script 예외를 일반화하지 않는다.

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
