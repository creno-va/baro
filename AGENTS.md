# BARO agent working agreement

## 작업 시작

1. `README.md`, `docs/development/EXECUTION.md`, 맡은 GitHub 이슈와 그 명세를 읽는다.
2. `bun run work:next`로 실제 GitHub 상태와 선행 이슈를 확인한다. 이 명령은 읽기 전용이며 에이전트를 실행하지 않는다.
3. 선행 구현 PR의 CI 성공과 main 병합을 확인한 뒤 제품 코드를 시작한다. 실제 외부 검증이 남은 선행 이슈는 OPEN으로 보존하며 종료를 개발 선행 조건으로 요구하지 않는다. 외부·정책·공개 승인 gate는 별도로 유지한다. 계약·fixture 작업은 이슈의 명시적 독립 범위에서 시작할 수 있다.
4. 이슈에 작업 시작과 브랜치를 남기고 `status:in-progress`를 붙인다. 동일 이슈에 열린 PR/작업자가 있으면 재사용하거나 다른 ready 이슈를 선택한다.
5. 깨끗한 main에서 `codex/<issue>-<purpose>` 브랜치를 만든다. 현재 변경과 secret을 보존한다. 여러 작업자는 별도 checkout/worktree를 사용한다.

## 판단과 경계

- 제품 범위는 PRD/MVP, 기술 선택은 유효 Accepted ADR, 상세 실행 계약은 architecture 문서와 계약 테스트를 따른다.
- v2 전체 개발은 `docs/development/V2-EXECUTION.md`와 #53~#71을 따른다. #53 병합/완료 뒤 제품 코드를 시작하며 미완료 P0.3 외부/공개 gate를 보존한다.
- 일반 구현 선택과 오류 수정은 이슈 범위 안에서 판단해 진행한다. 새 모델/공급자, 공개 정책 법률 승인, 사업자 정보, 새 결제/자동 충전, production 공개 전환은 별도 결정이 필요하다.
- 사용자 승인은 합의한 R2/Containers/Whisper 리소스와 월 기술100만원 내 실제 처리 비용, 검증된 PR 병합, preview/production 배포와 승인 요건 충족 후 최초 공개를 허용한다. 기존 Goal은 삭제됐으며 재생성하지 않는다. 새 결제수단·자동 충전·예산 확대·승인 증거 조작은 허용하지 않는다.
- 런타임은 Workers다. Bun은 도구·테스트용이다. 제품 코드에 `Bun.*`, Node filesystem/process를 추가하지 않는다. Better Auth를 위한 `nodejs_compat`는 허용된다.
- 다른 모듈은 `llm-gateway` 밖에서 모델을 호출하거나 `legal-retrieval` 밖에서 법률 API를 호출하지 않는다.
- 공유 계약은 `src/contracts/`, schema/migration은 DB 이슈가 소유한다. 공유 파일 변경은 선행 PR을 먼저 통합하며 서로 다른 migration 번호를 임의 생성하지 않는다.
- OAuth 실제 키·사건·토큰·오류 stack/SQL을 로그, 이슈, PR, artifact로 보내지 않는다. 개발은 합성 입력·test adapter로 가능해야 한다.
- 사용자 요청이나 별도 지시 없이는 자동 에이전트 생성·스케줄링을 하지 않는다.

## 검증과 완료

`bun ci`, `bun run check`, `bun run build`, `bun run cf:dry-run`을 실행하고 이슈별 실패 시나리오를 검증한다. DB 변경은 schema 생성 drift와 fresh/upgrade migration 검증이 필수다. 외부 키가 없어도 offline 검증과 PR은 완료한다.

기능 코드는 PR로 제출한다. 모든 인수 조건과 CI가 통과한 경우에만 `Closes #N`을 쓴다. 실제 외부 smoke가 남으면 `Refs #N`과 해당 외부 검증 이슈를 연결하고, 로컬 대역 테스트를 실제 로그인 성공으로 표현하지 않는다. CI 실패는 수정하며 변경 없음 상태를 반복 보고하지 않는다.

merge/배포 권한은 현재 사용자 지시를 따른다. 권한이 없으면 검증된 PR을 남긴다. production Environment 승인·공개 출시 게이트를 우회하지 않는다. 범위 내 작업이 막히면 다른 ready 이슈를 진행할 수 있으며 blocker는 GitHub와 실행 문서에 구체적인 필드·행동으로 기록한다.
