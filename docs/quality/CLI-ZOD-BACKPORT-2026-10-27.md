# CLI Zod3 상한 사전 검사 보완

추적은 [#339](https://github.com/creno-va/baro/issues/339), 브랜치는
`codex/339-constrained-zod-backport`다. main249b957에서 시작한 뒤 PR543/main ebdff2f의
CI 성공과 정상 병합을 통합했다. 사용자 지시로 필요한 호환 보완을 진행하며 랜딩·native
앱 제품·DB·모델·실제 API 설정을 변경하지 않는다.

## 구현과 근거

[GitHub advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)는4.6.6 이전 버전을
영향 범위로 지정한다. root/shared/API client의 Zod4.6.6은 이미 유지된다. CLI58.1.14는
Zod^3.25.76을 요구하므로 v4로 강제하지 않고, [공식 수정 commit](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd)의
constrained collection upper bound 조기 거절을 v3에 이식했다.

`array.max`, 너무 긴 `array.length`, `set.max`가 원소 파싱 전에 기존 too_big issue를
기록하고 실패를 반환한다. 원래 승인된 값과 validator API는 유지한다. 너무 큰 입력의
오류 열거와 후속 refinement 실행은 조기 거절에 따라 줄어든다. 새 크기 정책이나 모든
validation issue에 대한 global cap은 추가하지 않는다.

정확한 범위는 source `src/v3/types.ts`, CJS `v3/types.cjs`, ESM `v3/types.js`다.
[별도 manifest](../../patches/cli-zod.json)는 consumer/entry·기존 package/registry SRI·
전체 before/after tree·license·patch·각 파일 hash와 이 범위를 고정한다. CLI의 실제
resolve를 확인하고 root Zod4와 분리한다. Bun frozen 설치와 공통 보안 patch 검사가
새 patch를 포함한다. 기존 CJS/native 보완의 원본 bytes와 graph는 변경하지 않는다.

## 검증 범위와 한계

원본 전체 package를 역적용해 원래 tree hash를 복원한 뒤, 두 module 형식에서 sync/async
각3종 초과 collection을 실제 Node child로 비교한다. 고정 합성512개에서 원본은 원소
방문512/issue513, 보완은 방문0/issue1이다. 정상 값·기존 undersize/within-bound 오류·
catch 결과는 유지한다. 상한 없는 잘못된16개 배열은 방문16을 유지해 이 보완의 한계를
명시적으로 검증한다. Node old-space128MiB와7.5초 child deadline은 검사의 실행 제한이며
전체 peak 메모리/OOM/실제 악용 가능성의 증명이 아니다.

실제 CLI PluginSchema·DevToolsPluginOutputSchema·MCP command의 정상/잘못된 입력도
별도로 검사한다. 실제 무제한 output schema에서 잘못된128/256/512개의 issue가 계속
발생하는 사실은 보존한다. 새 max1 반례가 실제 CLI에 설정됐다고 주장하지 않는다.
2026-10-24 원본 관측 JSON/시각/graph와 그날의 실패 수치는 덮어쓰지 않는다.

원본 package의 옛 v4 export, 상한 없는 array/set/map, node-forge browser distributions,
전체 CLI 도달성·native/SDK 실제 인수와 raw audit는 별도다. 이 patch는 공식 수정 release나
#339/#71 전체 보안·릴리스 완료가 아니다. 원본 audit의 알려진 high도 숨기지 않는다.

## 로컬 호환 결과

Bun1.4.0 frozen 설치와 최종 quick이 통과했다. 보안 patch7개/123 assertions, 공통/mobile525·
RN UI108·마지막601 성공/기존host전용2제외다. 새 manifest와 root/shared Zod4 분리,
실제 CLI validator·기존 원본 관측 보존을 함께 확인했다. 초기 직접 집중 검사에서 cold
Windows 설치 트리 검사가 기존5/20초 test deadline을 넘었으며 제한을 늘리지 않았다.
표준 security:patches의 선행 전체 byte 검사 뒤에는 기존 검사가830ms/3.7초로 성공했고,
최종 quick에서도824ms/3.4초로 성공했다. 실제 Node probe의128MiB/7.5초 제한은 유지한다.

실제 Expo CLI의 Android/iOS Metro/Hermes export가 둘 다 성공했다. [유한 graph receipt](./cli-zod-2026-10-27/export-graph.json)는
local dirty candidate의 patch manifest hash와 실제 bundle/map hash를 기록한다. source
ebdff2f에 미커밋 보완이 있는 검사이며 clean exact compiled app으로 표현하지 않는다.
각 graph에서 Zod4 source93·Zod3 source0·CLI loader1을 관측했다. compiler 산출물 byte
대조와 실제 SDK/device/API·스토어 검증을 대신하지 않는다. 새 native 개발이나 배포는 없다.

바뀐 보완 조건에서 원본 `bun audit --json`을 한 번 실행했고 exit1·node-forge 및 Zod
high2건이 그대로 남았다. version/advisory를 바꾸거나 allowlist로 숨기지 않았다.
최종 build와 정확 PR/CI/main 통합 결과는 #339/PR에 이어 기록한다.
