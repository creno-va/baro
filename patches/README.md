# Toolchain CJS backports (#339)

패키지 버전과 npm registry integrity·원래 LICENSE는 보존한다. `bun ci`는 Bun의
`patchedDependencies`를 적용하며 `bun run security:patches`는 patch/lock/전체 설치 tree와
license byte를 검사하고, patch를 역적용한 원본과 수정본을 offline subprocess로 대조한다.
빈 `.bun-tag-<16hex>` 설치 metadata만 tree hash에서 제외한다. 실제 direct consumer 집합·버전·entry와
consumer에서 resolve하는 패키지도 확인해 중첩된 원본 copy를 사용하는 경우를 거부한다.

- braces3.0.3: 문자열 parse·compile/expand/stringify·queue/flatten/parent traversal을
  고정 깊이128로 제한한다. 옵션으로 끌 수 없다. 정상 glob/범위/escape 동작과 기존 range
  제한을 보존하며 과도한 중첩은 `ERR_BRACES_DEPTH`로 거부한다.
- node-forge1.4.0: CommonJS `lib/rsa.js`의 nested DigestAlgorithm 자식 수와 empty NULL을
  검사한다. [검토한 upstream commit](https://github.com/nitrog7/forge/commit/85446800199c4995d3cd4b0ab5a8409df4455859)의
  해당 파일 post-image와 byte가 같다. 정상 RSA/SHA·MD5의 기존 NULL 요건·인증서/CSR·padding/
  trailing-byte 검사를 보존한다. 합성 runtime key로 잘못된 구조를 서명하는 검사는 parser gap
  회귀이며 private key 없는 signature forgery를 시연했다고 표현하지 않는다.

**범위 제한:** node-forge의 prebuilt browser dist/map은 원본 그대로이며 이 CJS backport의
보완 대상이 아니다. manifest에 각 byte hash와 이 잔여 범위를 명시한다. RN/Worker에 배포되는
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

Browser dist/map은 보완하지 않았으며 배포 module graph에 나타나면 별도 수정·검증이
필요하다. 현재 후보의 byte/graph 대조 결과·시각·SHA와 native 호환 잔여는 #339에 기록한다.
