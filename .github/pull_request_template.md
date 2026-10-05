## 요약

<!-- 무엇을 왜 변경했는지 2~5문장으로 설명해 주세요. -->

## 연결된 이슈

Refs #

<!-- 모든 인수 조건 완료/검증 뒤에만 Closes #N. 부분 PR은 Refs와 남은 blocker를 적습니다. -->

## 변경 유형

- [ ] 제품 기능
- [ ] 버그 수정
- [ ] 리팩터링
- [ ] 보안·개인정보
- [ ] AI·법률정보 파이프라인
- [ ] 인프라·CI/CD
- [ ] 문서

## 구현 범위

<!-- 주요 변경과 의도적으로 제외한 범위를 적어 주세요. -->

## 사용자 영향

<!-- 화면, 상태, 오류, 접근성, 데이터 또는 정책 변화가 없다면 "없음"으로 적어 주세요. -->

## 보안·개인정보·AI 검토

- [ ] 사용자 입력·결과·인증정보가 로그나 분석 이벤트에 추가되지 않았습니다.
- [ ] 권한·소유권·CSRF·입력 검증 영향을 확인했습니다.
- [ ] DB·암호화·보존·삭제 변경을 관련 문서와 migration에 반영했습니다.
- [ ] AI prompt/schema/model 또는 법률 출처 변경 시 고정 eval과 citation 검사를 통과했습니다.
- [ ] 해당 없음 — 이유를 아래에 적었습니다.

검토 메모:

## 검증

- [ ] `bun run check` (docs/work/boundaries/migration 포함)
- [ ] `bun run lint`
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] `bunx wrangler deploy --dry-run` 또는 CI 동등 검사
- [ ] 관련 E2E/접근성/수동 smoke

검증 결과와 재현 방법:

<!-- offline synthetic 검증과 실제 공급자 smoke를 구분하고, 미실행 검증은 이유/후속 이슈를 적습니다. -->

## 배포와 롤백

<!-- 필요한 migration, binding, secret, feature flag, 배포 순서와 rollback 방법을 적어 주세요. -->

## 최종 확인

- [ ] PR 범위가 하나의 리뷰 가능한 목적에 집중되어 있습니다.
- [ ] 관련 PRD/ADR/API/DB/운영 문서를 함께 갱신했습니다.
- [ ] 새 secret 또는 실제 사용자 데이터를 커밋하지 않았습니다.
- [ ] 호환성 변경과 운영 위험을 위에 명시했습니다.
