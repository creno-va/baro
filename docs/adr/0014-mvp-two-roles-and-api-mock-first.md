# ADR-0014: 고객·변호사 MVP와 API mock 우선 병렬 개발

- Status: Accepted
- Authority: 2026-10-06 사용자 명시 지시
- Date: 2026-10-06
- Partial supersession: ADR-0007의 수동 자격 확인·공개 편집 심사·moderator portal을 이번 MVP에서 제외한다. 기존 구현과 증거는 보존한다.

## 맥락

기반 구현에 비해 끝까지 사용할 수 있는 화면이 부족하다. 사용자는 AI 답변 품질 개선보다 모든 UX 완성을 우선하고, 실제 client UI를 API mock으로 먼저 만들어 수정할 수 있게 하도록 요청했다.

## 결정

1. 통합 로그인에서 고객/변호사를 선택한다. 변호사는 자기 프로필을 관리한다. 승인 어드민·자격 신청·반려·재신청·승인대기 UX는 MVP 범위에서 제외한다. 역할 선택은 자격 확인 증거가 아니며 moderator 권한을 부여하지 않는다.
2. mock은 공통 client API facade의 응답/adapter다. 제품 UI 동일 구현체를 사용하고 별도 `/mock` UI를 만들지 않는다. mock과 real adapter를 교체하며 production에 인증 우회를 추가하지 않는다.
3. 계획과 동결 client 계약을 먼저 확정하고 사용자가 A~E 다섯 세션을 직접 시작한다. 실제 착수 시각부터 2시간 내 모든 주요 UX를 클릭 가능하게 제공한다. B~E의 독립 scaffold는 A 완료/병합이나 DB·AI·OAuth·외부 gate를 기다리지 않는다.
4. 각 세션은 API mock UI를 먼저 완성하고 같은 UI의 실제 backend 연결을 병렬 진행한다. 기존 병합 구현과 #64 PR100을 재사용한다. 새 DB/비용 선행 이슈를 추가하지 않는다.
5. AI 답변 정교화·전체 법률군 품질 재평가는 모든 UX 연결 뒤로 둔다. 사실/비자문·출처·소유권·삭제·비용 경계는 유지한다.

## 대안과 결과

별도 mock UI는 실제 UI와 이중 구현이 되므로 채택하지 않는다. backend 전체 완료 후 UI를 만드는 순서도 채택하지 않는다. [client 계약](../development/CLIENT-API-CONTRACT.md)과 [5세션 계획](../development/PARALLEL-UI-SPRINT.md)이 소유 파일·route·DTO·통합 순서를 고정한다.

## 후속과 미결

[마일스톤 6](https://github.com/creno-va/baro/milestone/6), #101~#106은 API mock을 통한 실제 client UX 시연이다. [마일스톤 5](https://github.com/creno-va/baro/milestone/5)는 두 역할의 실제 기능 연결이다. P0.3 및 #70/#71의 실제 연동·법률·사업자 사실·정책 게시·production Environment·최초 공개 승인 gate는 그대로 남는다. self-service 프로필을 검증된 자격/법률 승인으로 표시하지 않는다. mock 성공은 실제 외부/공개 완료 증거가 아니다.
