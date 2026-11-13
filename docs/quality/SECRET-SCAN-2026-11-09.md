# 최종 리디자인 이력 스캔의 공개 Git object 분류

추적: [#751](https://github.com/creno-va/baro/issues/751),
[통합 PR #778](https://github.com/creno-va/baro/pull/778).
한국 시각 2026-11-09의 후속 검증이며 제품·저장·배포 계약은 바꾸지 않는다.

## 실패와 재현

최종 main `74396a4d3754cb0a05dbd47d3335ee9612ec416e`의 수동
[full 42492794662](https://github.com/creno-va/baro/actions/runs/42492794662)에서
core의 `Scan committed history (fully redacted)`가 세 건을 탐지해 exit1로 끝났다.
이 때문에 뒤의 full core 검사는 실행되지 않았다. main push CI 성공이나 병행
browser/native 결과를 전체 full 성공으로 대신하지 않는다. preview는 보류했다.

총괄은 공식 Gitleaks v8.30.1 Darwin arm64 archive를 공식 체크섬 목록과 대조했다.
SHA-256은 `b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5`다.
같은 버전으로 정확한 위 main의 전체 이력을 `--redact=100`으로 검사해 동일 세 건과
exit1을 재현했다. 마스킹한 JSON은 로컬 임시 경로에 보존하고 공개 문서에는
rule·commit·파일·행과 분류 근거만 남긴다. 실제 credential을 읽거나 게시하지 않았다.

## 분류 근거

세 건의 rule은 모두 `generic-api-key`, commit은 위 `74396a4…`이며 파일은
`docs/quality/redesign-integration/reports-d77d42d/resolution-source-comparison.json`이다.
이 문서는 과거 검증 당시 두 실행 대상의 소스가 같은지 비교한 기록이다.

| 행 | `/blobHashes` 아래 필드 | 검증한 값의 종류 |
| --- | --- | --- |
| 30 | `packages/api-client/src/mobile-auth.ts` | Git blob object ID |
| 122 | `src/contracts/mobile-auth.ts` | Git blob object ID |
| 180 | `tests/helpers/resolution-default-api.ts` | Git blob object ID |

각 값은 40자리 16진수이며 `git cat-file -t`로 실제 `blob` object임을 확인했다.
문서의 비교 대상인 `396927f876fdf73f2527bd5faf3897f75fa90050`과
`d77d42d198b9d6509f333b4880243aa267ca9d39` 각각에 대해
`git rev-parse <commit>:<위 파일 경로>`의 결과와 일치했다.
인증키·토큰이 아니라 공개 소스 파일의 Git object ID다.

## 처리와 검증 범위

[기존 정확한 과거 오탐 분류 정책](./SECRET-SCAN-2026-10-27.md)에 따라
위 세 개의 immutable `commit:path:rule:line` fingerprint만 `.gitleaksignore`에 추가한다.
다른 commit에서 같은 파일·행을 다시 탐지하면 제외되지 않는다. 경로 전체·규칙·vendor
면제, 이력 재작성, scanner 버전 변경이나 실패 무시는 추가하지 않는다.

01은 scanner 분류 파일을, 총괄은 이 provenance 문서와 PR 통합을 소유한다.
후속 PR에서 전체 이력 재스캔 exit0과 같은 ignore file을 사용한 새로운 합성 탐지의
exit1을 확인하고 frozen 설치·quick 결과 및 정확한 검사 SHA를 PR에 남긴다.
원래 실패와 산출물은 보존한다.

복구 PR의 CI 성공·main 반영 후 새 최종 main SHA에서 core/browser/native/join을 모두
다시 수행한다. 05만 같은 SHA의 preview와 제한 smoke를 진행하며 결과는 #751에 남긴다.
이 문서는 full 성공, preview 완료 또는 production 배포 증거가 아니다.
