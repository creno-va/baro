# ADR-0005: durable 실행·개인정보 경계와 출시 게이트

- Status: Accepted
- Date: 2026-10-05
- Owners: Engineering
- Supersedes: ADR-0004의 외부 호출 중복 방지 해석을 보완, 나머지 결정 유지
- Related: [실행 계약](../architecture/DOMAIN-LIFECYCLE.md)

## 맥락

D1 commit과 Workflow 시작은 하나의 트랜잭션이 아니다. 모델 호출이 성공한 직후 결과 저장 전에 실행이 끊기면 재실행에서 비용이 중복될 수 있다. Workflow step 결과와 event payload도 저장되므로 D1만 암호화해서는 원문 저장을 제한할 수 없다. 또한 현재 production CD는 preview 검증 커밋을 고정하지 않는다.

## 결정

1. D1의 quota·idempotency·사건·분석·dispatch outbox는 조건부 SQL과 `DB.batch()` 하나로 commit한다. 0행 조건부 update는 SQL 오류가 아니므로 각 statement는 같은 admission predicate에 종속시킨다. Drizzle interactive transaction을 가정하지 않는다.
2. Workflow 시작은 outbox로 at-least-once 전달한다. instance ID는 `analysisId-attempt`로 고정하며 이미 존재하면 기존 상태를 확인한다. 외부 호출의 exactly-once 과금은 보장하지 않는다. timeout 후 결과 불명확한 호출과 재시도 횟수는 bounded retry 정책으로 관리한다.
3. Workflow params/event/step 반환값에는 opaque ID·revision·비민감 상태 또는 암호문만 넣는다. 평문 사건·답변·모델 응답은 step 내부에서만 다룬다. 저장 checkpoint는 envelope 또는 D1 reference다.
4. 모든 step 쓰기는 살아 있는 case·동일 revision·현재 analysis 조건을 함께 검사한다. 삭제 API는 primary D1 데이터를 삭제하고 opaque 삭제 작업을 지속 저장해 Workflow 상태 제거와 backup 복구 시 재삭제를 완료한다. 취소 호출만으로 race 방지를 주장하지 않는다.
5. Gateway 호출은 `collectLog:false`, `skipCache:true`를 명시한다. 모델 공급자의 보존은 별도 검증하며 Gateway log 비활성화로 무보존을 주장하지 않는다. 가능한 요청은 저장을 끄고, 미지원 설정은 추측해 보내지 않는다.
6. production은 성공한 CI·preview 배포가 있는 immutable SHA를 배포한다. build/dry-run 뒤 migration을 적용한다. scaffold 배포와 공개 베타 전환을 구분하고 기본은 `PUBLIC_BETA_ENABLED=false`다. 공개 베타 전환에는 #17~#20/#27의 실제 검증·정책 승인 증거가 필요하다.

## 고려한 대안

- 요청에서 DB 저장 후 Workflow를 한 번 호출: 장애 시 고립된 사건을 복구할 durable 기록이 없어 제외.
- Workflow 결과를 평문 step 반환값으로 유지: 손쉬운 replay 대신 개인정보 저장 경계를 넓혀 제외.
- 매 번 새로운 workflow ID로 재시도: 중복 작업·과금과 revision 혼동을 만들어 제외.
- 최신 main을 수동 production 배포: preview 검증 후 main이 바뀌면 검증하지 않은 커밋이 배포되어 제외.

## 결과

outbox/reconciliation·삭제 작업·실행 attempt의 schema가 필요하다. 사용자 개입 없는 offline 구현은 가능하며 외부 OAuth 승인·법률 검토·공개 전환은 별도 게이트로 남는다. 플랫폼의 보장과 앱의 보장을 구분한 fault-injection 테스트가 필수다.

## 후속 작업과 근거

#8/#11/#13/#17은 [실행 계약](../architecture/DOMAIN-LIFECYCLE.md), #19/#27은 배포·운영 문서를 구현한다.

- [D1 batch 원자성](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Workflow instance 생성·상태·삭제](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Workflow 저장 상태와 보존](https://developers.cloudflare.com/workflows/reference/limits/)
- [AI binding logging/cache 옵션](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)
