# ADR-0006: 지속적 사건 작업 공간과 준비 내비게이션

- Status: Accepted
- Date: 2026-10-06
- Owners: Product, Engineering
- Decision scope: User-approved v2 target; implementation, live capability and public approval remain unverified
- Partial supersession: ADR-0001의 파이프라인 안전 경계와 ADR-0005의 CAS/outbox/삭제 보장은 유지한다. v1 단일 분석·한 묶음 질문은 새 v2 사건에만 대체하며 기존 데이터 계약은 유지한다.

## 맥락

한 번의 분석으로 끝나는 개인 간 대여 UI는 반복 질문·자료 추가·사실 정정·변호사 상담 전후 준비를 표현하지 못한다. 상태와 원문을 느슨한 채팅 기록만으로 저장하면 수정·삭제·출처·재시도 정합성이 무너진다.

## 결정

1. 개인과 기업의 KR 사건 가족 전체를 단일 사용자 소유의 지속적 workspace로 만든다. 기업 공동 편집/팀 권한은 추가하지 않는다.
2. 초기 intake는 답변 기반 최대 3 묶음·묶음당 5 질문, 모름/건너뛰기·저장·중단·재개를 지원한다. 공백이 남으면 명시하고 요약 확인 이후 chat 에서 이어간다.
3. 사용자 요약 확인 revision을 정본으로 만들고 facts/timeline/actions/files/messages/report snapshots를 revision 과 attribution 으로 연결한다. 수정·새 자료는 필요한 재확인을 표시한다.
4. chat 과 준비 행동도 최소화→공식 자료→generation→안전/사실/인용 검증→암호화 저장 경로를 따른다. 검증 전 streaming은 사용자 응답으로 공개하지 않는다.
5. 법률 검토된 행동 범주만 활성화한다. 승소/유불리·협상/소송 전략·완성 제출 문서 대신 사실·자료·상담 질문 준비를 지원하고 변호사 직접 연락으로 연결한다.
6. v2 계약·schema를 additive로 추가하고 schemaVersion 1의 읽기/삭제·기존 사용자 데이터는 보존한다. 자동 재분석·모델 비용은 발생시키지 않는다.
7. 외부 실행 params/events는 opaque references만 담고 새 outbox·CAS·삭제 guard를 적용한다. quota 와 실제 retry 비용은 ADR-0013을 따른다.

## 고려한 대안

v1의 max5 와 terminal enum을 일괄 느슨하게 바꾸는 방식은 과거 계약을 파괴한다. 채팅만 저장하는 방식은 summary·자료·report의 정본이 불명확하다.

## 결과

다중 revision·요약 확인·작업 별 상태가 필요하지만 사건 준비를 다시 열어 이어갈 수 있고 사용자 진술과 AI 정리의 경계를 검증할 수 있다.

## 후속 결정 또는 미결 사항

실제 모델·다중 유형 평가·요약 확인/재개·법률 행동 승인 증거는 미완료다. Accepted는 목표 결정이며 공개 승인/구현 완료가 아니다.

## 참고

- [PRD](../PRD.md)
- [실행 계약](../architecture/DOMAIN-LIFECYCLE.md)
- [ADR-0005](./0005-durable-execution-and-release-gates.md)
