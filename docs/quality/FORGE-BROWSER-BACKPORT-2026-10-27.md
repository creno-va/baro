# forge 브라우저 RSA 검증 보완

추적은 [#545](https://github.com/creno-va/baro/issues/545), 상위 릴리스 보안은
[#339](https://github.com/creno-va/baro/issues/339)다. `codex/545-forge-browser`는 깨끗한
mainebdff2f에서 독립 fixture를 시작했다. PR544/headb880b0e CI40377051321 SUCCESS와
mainbfaf63e 정상 병합 뒤 배포 파일을 보완했다. 랜딩·native 앱 제품·DB·공급자 설정은
변경하지 않는다.

## 바뀐 범위

기존 CommonJS `lib/rsa.js`의 검증은 보존한다. 공식1.4.0의 두 UMD 파일
`dist/forge.min.js`, `dist/forge.all.min.js`에서 ASN.1 DigestInfo 검증 조건만 확장했다.
기존 outer sequence2개 검사 뒤 nested AlgorithmIdentifier의 자식 수가 OID+선택 NULL의
정확한 수인지 확인하고, NULL 값은 비어 있어야 한다. 조건은 기존 CJS 보완과 같다.
[공식 advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)의 nested element-count
범위이며 새 암호 알고리즘·버전·공개 API를 추가하지 않는다.

각 원본 파일의 알려진 hash와 AST의 해당 오류/조건을 먼저 대조하고, 일치한 조건만
바꿨다. minified bundle을 재빌드하지 않았다. [manifest](../../patches/manifest.json)의
full before tree는 원래 npm package를 유지하며 기존 CJS와 새2파일의 after hash를
고정한다. 버전/registry integrity·license·나머지 파일은 보존한다. source map2개와
prime worker2개는 수정하지 않는다. 원래 map은 self-file의 첫 mapping을 가리키며
새 원본 소스 매핑이나 디버깅 정확성을 주장하지 않는다.

Bun patch 생성 중 빈 `.bun-tag-<16hex>` 설치 marker가 new-file hunk로 포함됐고 기존
scope/mode 검사가 거절했다. 정확히 빈 설치 marker hunk만 제거했으며 mode/path 검사와
원본·전체 설치 byte 검사를 완화하지 않았다. 최종 patch는 위3개 파일만 수정한다.

## 재현과 회귀

수정 전 새2개 검사는 미보완 coverage와 실제 malformed 수용으로 실패했다. 원본
역복원은 CommonJS 보완도 되돌려 npm 전체 tree hash를 복원한다. 두 브라우저 번들을
각각 격리 Node VM의 browser 전역으로 로드해 전후를 대조한다.

- extra child, NULL 대신 garbage, 반복 NULL, 비어 있지 않은 NULL, constructed NULL의
  합성5종은 원본 두 파일에서 수용되고 수정본 두 파일에서 거절된다.
- SHA1/224/256/384/512의 NULL 유무, MD5의 필수 NULL, trailing bytes/잘못된 digest,
  self-signed certificate와 CSR의 정상/거절 결과는 원본과 같다.
- Node/OpenSSL은2048-bit·e65537 ephemeral key로 정상 PKCS1 padding fixture를 만든다.
  브라우저 public verifier는 원본/수정본 그대로다. certificate/CSR API도 해당 browser
  forge로 호출한다. private key나 원문을 출력·저장하지 않는다. 이는 parser gap 회귀이며
  private-key-free signature forgery의 시연이 아니다.
- VM에는 Node process/module/require·fetch/XHR를 제공하지 않는다. WebCrypto와 timer를
  제공하고 forge.all의 jQuery form/network helper는 호출 시 실패하는 대역으로 격리한다.
  실제 브라우저 UI·jQuery 기능·전 API·전체 메모리 안전을 인수한 검사가 아니다.

frozen Bun1.4.0 설치와 표준 security:patches9개/166 assertions가 성공했다. 각 Node
child는 old-space128MiB·10초, VM module 초기화는5초로 제한한다. 실제 두 번들 전체
전후 대조는8초 이내였으며 기존 CJS·braces·CLI3/root4 분리·native byte 검사를 함께 유지했다.
최종 quick/build와 exact PR CI/main 통합 결과는 이슈/PR에 이어 기록한다.

공식 fixed release가 없다는 사실과 원본 raw audit는 별도다. 버전을 위장하거나 알려진
advisory를 allowlist하지 않는다. 이번 확대가 #339/#71 전체 SDK·외부·릴리스 인수,
legacy unknown 해소나 production 배포 성공을 뜻하지 않는다.

최종 로컬 quick(보안9개·공통/mobile525·RN108·마지막601성공/기존host전용2제외)와
production build/bundle/dry-run/local built workerd가 통과했다. 새 patch 조건에서 원본
audit를 한 번 실행했으며 여전히 exit1·node-forge 및 Zod high2건이었다. 실제 공급자
호출·native 앱 배포·preview/production 배포를 하지 않았다. 원격 exact CI는 PR에 기록한다.
