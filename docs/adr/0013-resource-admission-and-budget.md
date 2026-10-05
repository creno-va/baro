# ADR-0013: 자료·AI 사용량과 기술 예산 admission

- Status: Accepted
- Date: 2026-10-06
- Owners: Product, Engineering
- Decision scope: User-approved v2 target; implementation, live capability and public approval remain unverified
- Partial supersession: ADR-0005의 durable idempotency·bounded retry·exactly-once 과금 불가를 유지한다. v1의 과거 일 10 분석 계약은 역사로 남기고 새 서비스 신규 생성에는 일 3 사건 한도를 적용한다. 기존 v1 읽기·답변·retry·삭제와 월 비용 집계를 유지한다.

## 맥락

문서 100개·1GBmedia·반복 chat은 사건수만 제한하면 비용/저장량을 통제할 수 없다. 동시에 retry를 새요청으로 세면 사용자 quota를 부당하게 소비하고 실제 vendor 비용을 누락한다.

## 결정

1. 새 v2 사건 KST 일 3개·사용자 AI 응답 30회·음성/영상 합계 60 분을 서버에서 제어한다. 질문묶음/사용자응답과 내부 generation phase를 구분하고 숨은 호출비용을 모두 계산한다.
2. 사건 원본 100개/5GB·문서/이미지 100MB·media 1GB/60분·PDF 500쪽·계정전체 10GB를 시행한다. decimal bytes 와 duration/page validation·reservation·finalize/reconcile를 계약에 둔다.
3. 월 기술예산 1,000,000 원은 AI/ASR/Container/storage/기타기술운영을 포함한다. 법률검토는 별도이며 새결제수단·자동 충전·예산확대는 별도승인이다.
4. 외부호출 전 estimated cost를 durable 예약하고 call/attempt·실제 provider usage·Container duration/storage를 정산한다. 환율·단가버전을 기록하고 uncertainty 여유를 두어 상한 전에 멈춘다.
5. 동일논리작업 idempotency/retry는 사용자 quota를 중복 차감하지 않는다. 실제시스템 retry/ambiguous success 비용은 모두 ledger에 기록하며 bounded attempt를 적용한다.
6. budget/사용량/저장예약 부족은 처리 waiting/명시적 reject 와 사용자행동으로 표시한다. 저장된자료·자신의조회/삭제를 제한때문에 막지 않는다.
7. 환경별 spend limit·실제 plan/가격·alarm·예약회수·동시 admission·KST 자정·월경계·crash/replay를 검증한다. Gateway credit 잔액만으로 총예산을 제어한다고 주장하지 않는다.

## 고려한 대안

UI 카운터·파일확장자·Gateway 한도 하나만 쓰면 동시쓰기/Container 비용/파생저장이 누락된다. retry를 무료라고 비용 ledger 에서 빼면 월예산을 과소보고한다.

## 결과

usage/reservation/cost ledger·정산 scheduled 작업·비민감수치 alert가 필요하다. 외부실시간 usage 지연 때문에 보수적예약과 여유상한을 사용한다.

## 후속 결정 또는 미결 사항

실제가격/plan/환율과 호출비용은 리소스생성/배포전에 확인한다. 기술예산권한은 공개법률승인이나 자동충전권한이 아니다.

## 참고

- [제품한도](../product/MVP-SPEC.md)
- [실행계약](../architecture/DOMAIN-LIFECYCLE.md)
- [운영](../operations/DEPLOYMENT-OPERATIONS.md)
- [ADR-0005](./0005-durable-execution-and-release-gates.md)
