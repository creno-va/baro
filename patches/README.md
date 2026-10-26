# Toolchain 보완 (#339)

패키지 버전과 npm registry integrity·원래 LICENSE는 보존한다. `bun ci`는 Bun의
`patchedDependencies`를 적용하며 `bun run security:patches`는 patch/lock/전체 설치 tree와
license byte를 검사하고, patch를 역적용한 원본과 수정본을 offline subprocess로 대조한다.
빈 `.bun-tag-<16hex>` 설치 metadata만 tree hash에서 제외한다. 실제 direct consumer 집합·버전·entry와
consumer에서 resolve하는 패키지도 확인해 중첩된 원본 copy를 사용하는 경우를 거부한다.

- braces3.0.3: 문자열 parse·compile/expand/stringify·queue/flatten/parent traversal을
  고정 깊이128로 제한한다. 옵션으로 끌 수 없다. 정상 glob/범위/escape 동작과 기존 range
  제한을 보존하며 과도한 중첩은 `ERR_BRACES_DEPTH`로 거부한다.
- node-forge1.4.0: CommonJS `lib/rsa.js`와 `dist/forge.min.js`, `dist/forge.all.min.js`의
  nested DigestAlgorithm 자식 수와 empty NULL을 검사한다. [검토한 upstream commit](https://github.com/nitrog7/forge/commit/85446800199c4995d3cd4b0ab5a8409df4455859)의
  CJS 파일 post-image와 byte가 같고 두 원본 브라우저 번들에도 같은 조건을 이식했다.
  정상 RSA/SHA·MD5의 기존 NULL 요건·인증서/CSR·padding/
  trailing-byte 검사를 보존한다. 합성 runtime key로 잘못된 구조를 서명하는 검사는 parser gap
  회귀이며 private key 없는 signature forgery를 시연했다고 표현하지 않는다.

**범위 제한:** 두 브라우저 번들에서는 RSA verifier 조건만 바꾼다. source map과 prime worker는
원본 byte를 보존한다. manifest에 각각의 수정/미수정 hash와 이 범위를 명시한다. RN/Worker에 배포되는
모듈 도달성과 CLI 입력 경계·SDK/native 호환은 별도 인수다. upstream PR은 아직 공식 fixed
release가 아니며 package version을 올려 audit를 통과시키지 않는다.

`validate:security`의 raw `bun audit`를 보존한다. 이 patch/단위 검사만으로 raw audit나
#339/#71 전체 release 보안 인수가 성공했다고 선언하지 않는다. 이후 명시적인 보완 인수도
source/patch/lock 일치·새 advisory 거부와 실제 관련 실행 증거를 함께 확인해야 한다.

## 도달성 확인 범위

`CLOUDFLARE_ENV=production bunx astro build --config scripts/toolchain-build-observer.mjs`는
원래 Astro 설정에 출력 관측 hook만 추가한다. `.wrangler/toolchain-exposure/`에 각 실제
출력 chunk의 byte hash와 Vite가 연결한 module ID를 남긴다. 이것은 수동 증거 생성이며
raw audit를 대체하거나 배포하지 않는다. 해당 관측 파일은 실행 전 소유 디렉터리에서
정리하고, 관측한 전체 graph와 RN `expo export --source-maps`의 sources를 대조한다.
문자열 검색만으로 minified 코드의 부재를 단정하지 않는다.

CLI는 배포 앱과 별도 경계다. 현재 lock의 direct consumer는 micromatch4.0.8,
@expo/cli58.1.14, @expo/code-signing-certificates0.0.7이다. 실제 설치 source에서
micromatch의 brace API/parse 경로와 Metro watcher의 glob 입력을 확인한다.
Expo iOS signing은 macOS `security find-certificate` 결과를 parse하고, development
manifest signing은 요청의 `expo-expect-signature` header·project config와 개발 cache/
명시한 certificate/private-key 파일을 사용한다. 인증서 검증·서명 확인의 CJS 코드도
실행되므로 모든 입력을 신뢰한다고 간주하지 않는다. 이 검토를 위해 실제 keychain,
실제 인증서·private key·Expo 계정을 읽거나 서버에 서명을 요청하지 않는다.

## CLI Zod3 constrained collection 보완 (2026-10-27)

`cli-zod.json`은 root/shared의 Zod4.6.6과 별도로 실제 @expo/cli58.1.14가 resolve하는
중첩 Zod3.25.76을 검사한다. [Zod의 공식 수정](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd)의
명시적 상한 사전 검사 방향을 v3의 array max/length와 set max에 이식했다. 원본 source와
CJS/ESM3파일만 바꾸며 정상 입력의 결과·현재 major·registry SRI·license를 유지한다.
과도한 입력의 issue 목록과 refinement 수행은 조기 거절로 줄어든다. 타입 선언·새 제한·
global 오류 개수 상한·자동 major override를 추가하지 않는다.

원본을 역적용한 전체 tree와 수정 tree를 실제 Node child에서 대조한다. 두 module 형식과
동기/비동기 array/set의 초과512개는 원소 방문512/issue513에서 방문0/issue1로 바뀐다.
정상 값, 범위 안 오류, 부족한 배열 길이, catch와 상한 없는 배열은 별도로 보존 검증한다.
현재 CLI의 실제 plugin/output/command schema도 계속 검사한다. package 내 옛 v4 export와
상한 없는 collections를 보완했다고 주장하지 않으며 raw audit를 그대로 유지한다.

설치 검사에는 기존 CJS2개/native1개와 이 CLI1개가 포함된다. 각 범위를 따로 attestation하고,
root Zod4가 CLI의 원래 Zod3을 대신한 것으로 오인하지 않는다. [검증과 잔여](../docs/quality/CLI-ZOD-BACKPORT-2026-10-27.md)를 따른다.

두 브라우저 분포의 보완은 [#545 검증 범위](../docs/quality/FORGE-BROWSER-BACKPORT-2026-10-27.md)를
따른다. Node VM은 browser 전역과 CSPRNG만 제공하고 jQuery form/network API는 호출 시
실패하는 대역으로 격리한다. 실제 브라우저 UI나 다른 forge API의 전체 인수가 아니다.
현재 후보의 byte/graph 대조 결과·시각·SHA와 native 호환 잔여는 #339에 기록한다.

## iOS TextInput native source backport (#379)

`react-native-ios-input.json`은 CJS 두 보완과 분리한 native3파일 범위다. RN0.88.0의
version/registry SRI/원래 MIT LICENSE·전체 설치 tree를 보존·검사한다. 실제 모바일
workspace가 같은 패키지를 resolve하는지도 확인한다. native 범위는 이1개이며 위의
CJS2개/CLI1개와 함께 검사한다. raw audit 검사나 #339 잔여를 제거하지 않는다.

후보는 [RN59197의 a91468ffe6](https://github.com/react/react-native/pull/59197/commits/a91468ffe62122bc49d964a08b493374f0af4775)의
비교 경로만 이식했다. `defaultTextAttributes`/기존 typing attributes와 single-line의
paragraph 비교를 다루고 기존4-argument 함수/실제 text·style 변경의 비교를 보존한다.
후속59198의 state/selection replay는 포함하지 않는다. upstream은 이 검토 시점 미병합이며
정식 fixed release나 BARO 원인 확정으로 표시하지 않는다.

upstream과 registry source의 주석1줄·FrameworksGuard include 차이는 유지한다.
Bun patch의 line offset 적용 때문에 최초 upstream hunk가 헤더 내부에 잘못 놓이는 것을
검출했고 정확한 registry before/post-image로 hunk를 다시 생성했다. frozen 설치 후 모든
post-image와 전체 tree를 확인하며 reverse patch가 원래 tree를 복원하는 회귀를 둔다.
설치 byte 검사는 native 동작 증거가 아니다.

`expo-build-properties`58.0.11은 Expo58의 권장 범위에 맞춰 iOS만
`buildReactNativeFromSource=true`로 설정한다. prebuilt React.xcframework를 사용한 채
native source patch가 반영됐다고 인수하지 않는다. 내부 iOS compiler는 생성 property·
RNCore/Dependency prebuilt OFF와 두 .mm의 양 architecture CompileC 관측을 요구한다.
새 compiler/runtime 성공 전에는 기존4ba1d39 앱/receipt를 새 보완 앱으로 재명명하지 않는다.
전체 한국어 조합/접근성·실기기·계정/API·스토어 인수는 별도로 남는다.
