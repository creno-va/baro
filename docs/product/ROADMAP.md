# BARO 실행 로드맵

- Updated: 2026-10-14; [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), [현재 실행](../development/EXECUTION.md).

M2/M3의 v1 구현과 M6의 동일 client/API mock UX 완료 이력을 유지한다. M4/M5는 정책 초안
인수 범위와 실제 기능·외부 잔여를 구분한다. #20/#70의 제목·완료는 초안/플레이스홀더
수용이며 실제 법률 승인이 아니다. 새 정비 마일스톤은 만들지 않는다.

## 현재 우선순위

1. 공개 서비스를 유지하고 신규 기능 확장을 멈춘다. 고객/변호사 두 역할과 v1 데이터를 유지한다.
2. PR230→229·233/235/241과0014는04f25f8로 배포됐다. 비용 관측과 writer/cleanup·
   변호사 원본/공개 복사의 기술 경계를 분리한다. `APPLICATION_COST_LIMITS_ENABLED=false`에서
   금액·가격/FX/funding 누락/만료·월할당·refresh·유지비·비용 IO가 기능/배포를 막지 않는 것이
   [현행 정책](../operations/PREBETA-COST-POLICY.md)이다. 분리 구현은 PR247에 병합했으며 배포·실제 결과는 #71 receipt를 따른다.
   새 환경 가격 proof bootstrap 결합은 잔여다. 사용자 재지시 전 비용 차단을 재도입하지 않는다.
3. PR232의 후보 결합 증거와 정확한 SHA 운영자 승인, PR234의 D1 공개 projection/keyset 검색을
   적용한다. 디렉터리 원격 reindex·제한 smoke는 M5/#231로 추적한다.
4. 현재 문서·설정·이슈/마일스톤 정합성을 확인하고 최종 main SHA를 수동 validate:full로 검사한다.
5. 같은 SHA preview 제한 합성 검증 후 유효한 운영자 승인으로 production을 수동 배포한다.
   비공개 합성 고객 흐름을 확인하고 자료를 정리한다. production 가짜 공개 변호사를 게시하지 않는다.

## 종료와 후속

정비 종료는 문서/작업 정합성·hold 보존 재개·정확한 증거 결합·bounded 검색·최종 회귀·
같은 SHA 배포·제한 실제 검증·자료 정리로 판정한다. 전체 MVP 인수 #71은 OAuth·실제 모델/
공식 출처·자료 처리·다운로드·정산·삭제/복구·운영의 남은 담당과 실제 증거를 확인한 뒤 닫는다.
정책 초안 수용을 독립 법률 승인으로 바꾸지 않는다. 실패한 외부 검증은 조건 변화 전 반복하지 않는다.

팀 공동 workspace·내부 상담/메시징·대리 연락/제출/결제·유료 노출·소개 수수료·승소 예측/
법률 전략·완성 제출 문서는 범위에 없다. 확대 AI 품질·신규 기능은 운영 정비 후 별도 결정한다.
이전 sprint 계획은 [로드맵 이력](../development/ROADMAP-HISTORY.md)에 보존한다.
