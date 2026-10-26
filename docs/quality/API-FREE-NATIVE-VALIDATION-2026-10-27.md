# API 키 없는 native 검증과 iOS CI 병목 정비

추적은 [#553](https://github.com/creno-va/baro/issues/553), 브랜치는
`codex/553-ios-architecture-ci`다. CI가 성공한 main7ddec6d에서 시작한다.
네이티브 앱 제품·랜딩·API/계약·DB·모델과 비용/실제 처리 한도를 변경하지 않는다.

## 관측과 설계

Java action 업데이트 [PR538](https://github.com/creno-va/baro/pull/538)의
exact2ecc3196 / native40374351473 iOS job은40분 제한으로 취소됐다. compiler 오류 대신
두 아키텍처를 source build하는 동안 취소된 기록이다. 로그에서 x86_64 CompileC1207개,
arm641204개와 `ONLY_ACTIVE_ARCH=NO`를 확인했다. source-build fallback 때문에 precompiled
Expo/RN framework를 사용하지 않은 관측도 보존한다. 임의 precompiled 전환으로 기존
native source patch 검증을 대체하지 않는다.

두 Simulator 아키텍처를 모두 검증하되 각각 같은40분 job으로 분리한다. Android의 기존
두 ABI compile/core probe도 유지한다. [Apple의 아키텍처 지침](https://developer.apple.com/documentation/technotes/tn3117-resolving-build-errors-for-apple-silicon)에
맞춰 명시적인 검증 대상을 선택하며, 기본 universal/runtime/키체인 control 빌드 경로의
설정은 그대로 둔다. CI 전용 `--verify-architecture=arm64|x86_64`만 `ARCHS`를 고정하고
`ONLY_ACTIVE_ARCH=NO`로 요청한 slice를 빌드한다. platform/CI/추가 인자·source SHA와
clean checkout을 먼저 검사한다. 시간 제한이나 아키텍처 coverage를 줄여 성공시키지 않는다.

각 실제 산출물에서 plist의 preview app/Simulator identity, executable과 존재하는 debug
dylib의 `lipo` 단일 아키텍처와 `vtool` IOSSIMULATOR platform을 확인한다. binary digest는
stream으로 계산하고 fresh receipt만 쓴다. matrix ID·source SHA·실제 architecture가
맞아야 최종 receipt를 기록하며 artifact 이름도 세 job별로 다르다. x86_64 job의 Swift
core probe는 해당 macOS host에서 실행하는 기존 독립 core 검사이며 x86 앱 runtime 성공을
의미하지 않는다. 두 slice 모두 앱/기기/스토어 실행 인수를 주장하지 않는다.

## 독립적인 파일 처리 검증

기존 full은 원본 audit 실패 뒤의 native Docker profile을 실행하지 못했다. 로컬 Docker
daemon 부재를 가짜 성공으로 바꾸지 않고, `native-validation.yml` 수동 workflow가 같은
exact main의 기존 `validate:native`를 직접 실행하도록 한다. 전체 fixture·네트워크 차단·
메모리/CPU/물리 한도는 기존 profile을 그대로 사용한다. workflow는 contents:read만 가지며
provider credential을 전달하지 않는다. 현재 checkout과 main ancestry를 먼저 검사한다.

이 workflow는 native profile이 실제 성공한 경우에만 별도의 scoped receipt를 만든다.
`fullValidationPassed`, `providerAcceptanceVerified`, `appRuntimeVerified`, `deployed`는
모두 false다. full workflow/성공 release receipt나 preview/production gate를 대체하지 않는다.

## 로컬 검증과 실제 검증 경계

집중3파일20개/490 assertions가 통과했다. 명시 CI 모드와 기존 모드 불변, invalid/추가
인자 거절, 양 architecture의 독립 proof, fat/wrong slice·debug dylib 불일치·실제 device
platform·executable 경로 이탈·stale receipt 거절, matrix 두 iOS/Android와40분 보존,
scoped workflow의 exact SHA/권한/비밀정보 미전달/실패 전파를 검사했다. readback 단위
fixture는 합성 command adapter이며 실제 Mach-O compile 성공으로 표시하지 않는다.

frozen 설치와 quick이 성공했다. 보안9·공통/mobile525·RN108·마지막610성공/기존host2제외다.
실제 각 architecture compile/core·Docker 결과와 정확 PR/main SHA는
이슈/PR에 기록한다. CI가 실패하면 원인을 수정하며 통과 전 병합하지 않는다. PR538은
이 보완이 main에 통합된 뒤 최신 main을 반영해 검증하고 병합한다. 원본 raw 보안 진단과
legacy genuine unknown, 미발급4종 API 및 실제 공개/릴리스 조건은 각각 유지한다.
