# 전체 이력 비밀정보 스캔의 실행과 정확한 오탐 분류

추적: [#551](https://github.com/creno-va/baro/issues/551),
`codex/551-secret-scan`, CI가 성공한 mainf7d65be에서 시작했다.

## 발견한 검증 공백

기존 수동 full workflow의 Secret scanner 단계는 고정 binary 설치만 했다.
실제 `validate:full`은 browser/CSP 다음 `bun audit`를 실행하며, raw advisory가 남으면
이후 Gitleaks와 native 검증은 실행되지 않는다. 설치 단계의 SUCCESS를 스캔 성공으로
확대하지 않는다. 새 workflow는 같은 고정 Gitleaks8.30.1로 전체 HEAD 이력을 실제로
스캔한 뒤 full을 실행한다. 기본 검사 규칙·100% redaction·이력 fetch-depth0·실패 전파를
유지한다. full/security profile과 raw audit도 그대로다.

## 탐지와 독립 분류

공식 Windows x64 zip의 SHA-256은
`d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`다.
[공식 v8.30.1 release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)의 digest와
검증한 뒤 실행했다. shallow가 아닌 exactmainf7d65be HEAD 이력에서 원래20개 탐지/exit1을
보존했다. 동일 commit/path/line의 중복을 합치면8개 immutable fingerprint다.

- 역사적 공개 JSON 4개 중2개는 `authReceiptSha256`의64자리 checksum, 다른2개는
  `observedApiRelease`/`apiSourceSha`다. 후자2개는 실제 Git commit object가 존재함을
  확인했다. 인증 receipt 원문·OAuth token·키를 읽거나 게시하지 않았다.
- patch의4개 줄에서 반복 탐지된16개는 공개 TLS 함수 dispatch 구문과 정적 PKCS#12
  algorithm OID다. 공식 npm의 node-forge1.4.0 tarball을 기존 manifest의 SHA-512 SRI로
  검증하고, 두 원본 UMD의 SHA-256 및 탐지 fragment 전체가 원본과 같은지 대조했다.
  보완한 RSA guard와 무관한 공개 원본 구문이다. vendor 전체 경로나 규칙을 제외하지 않는다.

기존 `.gitleaksignore`의 역사 fingerprint 방식을 그대로 사용해 확인한8개만 추가했다.
각 항목은 정확한40자리 commit·파일·rule·행이다. immutable commit 안의 내용은 바뀔 수
없으며 다른 commit의 같은 파일/행은 제외되지 않는다. 원문 탐지 보고서는100% 마스킹한
로컬 ignored 산출물로만 보존했다. 공개 [분류 receipt](./secret-scan-2026-10-27.json)는
fingerprint·타입·내용 digest·공개 vendor provenance와 결과만 포함한다.

## 검증

- full을 먼저 실행하면 scanner가 미실행되는 원래 workflow에 새 회귀는 실패했다.
  실제 scanner 명령을 full 전에 실행하고 조건/continue-on-error 없이 실패를 전파하며
  전체 이력을 읽는지 검사한 뒤 workflows11개/347 assertions가 통과했다.
- 같은 ignore file로 전체 HEAD 이력 재스캔은0개/exit0이다. 최종 PR head의 실제 결과는
  이슈/PR에 기록한다. 후보 상태 검사와 최종 커밋 검사를 구분한다.
- 독립적인 새 로컬 Git repo에 런타임 생성한 합성 PAT canary를 commit했다. 같은 ignore
  file을 복사해 실행해도 `github-pat` 탐지/exit1이며 보고서 원문은100% 마스킹된다.
  실제 자격 증명은 사용하지 않았다. 원래 저장소 history를 재작성하지 않았다.
- frozen 설치와 quick이 성공했다. 보안9·공통/mobile525·RN108·마지막604성공/기존host2제외다.
  정확 PR CI 결과는 이슈에 기록한다. 제품/랜딩·DB/API·모델·native 앱
  코드와 dependency advisory 설정은 변경하지 않는다. build/browser를 반복할 변경은 없다.

원래 #339의 raw high2를 숨기지 않으며 이 분류를 advisory allowlist로 사용하지 않는다.
full 성공·preview/production 배포·#506 실제 종료·전체 #71 인수를 의미하지 않는다.
