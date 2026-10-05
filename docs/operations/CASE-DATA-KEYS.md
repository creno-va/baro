# 사건 데이터 암호화 키 운영

- 구현: `src/server/crypto/index.ts`
- 적용 명세: [데이터 모델](../architecture/DATA-MODEL.md), [보안·개인정보](../security/SECURITY-PRIVACY.md), [ADR-0003](../adr/0003-identity-data-and-privacy.md)
- 코드·합성 검증: #9. 실제 환경 등록·접근 통제·복구 증거: #27.

## 애플리케이션 계약

`createCaseDataCipher({ CASE_DATA_KEY_V1 })`는 키 ID `1`을 Worker secret
`CASE_DATA_KEY_V1`에 명시적으로 대응한다. secret은 CSPRNG로 생성한 32바이트를
padding 없는 canonical base64url 43자로 인코딩한다. 암호문은
`v1.<key-id>.<base64url-iv>.<base64url-ciphertext-and-tag>`이고 태그는 128bit다.

`encrypt(plaintext, context)`와 `decrypt(envelope, context)`는 문자열을 비동기로 처리한다.
`context`에는 `table`, `rowId`, `column`, `userId`를 넣는다. 허용된 저장 필드는
`cases.encrypted_input`, `analyses.encrypted_context`, `analyses.encrypted_answers`,
`analyses.encrypted_result`다. `rowId`와 `userId`는 1~128자의 ASCII 영숫자·`_`·`-`만
허용한다. 구분자 `:`를 금지하여 AAD `<table>:<row-id>:<column>:<user-id>`가 모호하지
않게 한다. 소유자는 인증 세션과 DB에서 확인하며 클라이언트가 보내는 `userId`를 신뢰하지 않는다.

평문 상한은 UTF-8 256 KiB다. 이는 저장 계층 방어 상한이며 API·제품의 더 작은 입력 제한을
대신하지 않는다. 암호문은 이 상한+16바이트 태그, IV는 12바이트, key ID는 1~32자까지
허용한다. 복호화 전에 envelope 전체 길이와 각 필드의 canonical base64url을 검사한다.
암호문·태그·AAD·키가 잘못되면 모두 `CRYPTO_DECRYPT_FAILED`로 실패한다. 암호화 실패는
`CRYPTO_ENCRYPT_FAILED`, 설정 실패는 `CRYPTO_CONFIGURATION_INVALID`다. 오류에는 원본
cause/암호문/키/사용자 ID를 붙이지 않는다. API는 내부 stack을 응답·로그로 전달하지 않는다.

매 저장마다 Web Crypto가 새 96bit IV를 만든다. 평문을 결정적 값으로 바꾸거나 IV를
외부에서 주입하지 않는다. 가져온 CryptoKey는 export 불가다. 원시 키와 평문 byte buffer는
사용 후 지우지만 JavaScript 문자열·플랫폼 메모리의 완전한 zeroization을 보장하지는 않는다.

## 개발 키 생성

테스트는 실행마다 메모리에서 생성한 합성 키를 쓰므로 `.dev.vars`나 외부 secret이 필요 없다.
로컬 앱 개발용 키는 운영/preview 키와 별도로 생성한다. `.dev.vars`가 Git에서 무시되는지
확인한 뒤, 신뢰할 수 있는 로컬 터미널에서 아래 명령을 실행할 수 있다. 이 명령은 기존의
다른 설정을 보존하고 이미 값이 있는 암호화 키를 덮어쓰지 않으며 키를 화면에 출력하지 않는다.
Bun은 여기서 개발 도구이며 배포 모듈은 Workers Web API만 사용한다.

```bash
bun -e 'const f=Bun.file(".dev.vars");const s=(await f.exists()?await f.text():"").replaceAll("\r\n","\n");if(/^CASE_DATA_KEY_V1=.+$/m.test(s))throw new Error("KEY_ALREADY_CONFIGURED");const k=crypto.getRandomValues(new Uint8Array(32));const v=btoa(String.fromCharCode(...k)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");const line="CASE_DATA_KEY_V1="+v;await Bun.write(".dev.vars",/^CASE_DATA_KEY_V1=/m.test(s)?s.replace(/^CASE_DATA_KEY_V1=.*$/m,line):s+(s.endsWith("\n")||!s?"":"\n")+line+"\n");k.fill(0);'
```

`.dev.vars`를 개인 계정으로만 읽을 수 있게 보호한다. 해당 파일을 cat하거나 debug dump,
스크린샷, artifact, 이슈, PR에 첨부하지 않는다. 키를 바꾸면 기존 local D1 데이터는 예전
키로만 읽을 수 있으므로 필요한 합성 데이터의 처리 여부를 먼저 판단한다.

## preview / production 생성·등록

각 환경의 승인된 운영 담당자가 별도 32바이트 CSPRNG 키를 생성하고 접근 통제된 secret
관리 저장소에 환경·키 ID·생성 시각·담당자를 함께 보관한다. base64url 43자나 길이만
맞추려고 사람이 입력한 문자열, 비밀번호, 다른 환경의 키를 사용하지 않는다. 키 원문은
관리 저장소와 해당 환경의 Worker secret만 통과시킨다.

1. 대상 Cloudflare account, Worker 이름과 환경이 정확한지 확인한다. 생성·등록 경로의
   terminal tracing, invocation payload logging, 화면 녹화와 clipboard history를 사용하지 않는다.
2. 키 복구 사본이 승인된 비밀 관리 저장소에 있고 별도 권한의 복구 담당자가 접근할 수 있는지
   확인한다. D1 backup에는 키가 포함되지 않는다.
3. 환경을 고른 Cloudflare Dashboard의 Worker Settings > Variables and Secrets에서
   `CASE_DATA_KEY_V1`를 **Secret**으로 등록한다. Wrangler를 사용할 때는 신뢰된 로컬 터미널의
   secret 입력으로 `bunx wrangler secret put CASE_DATA_KEY_V1 --env preview`를 사용한다.
   production은 별도 승인된 운영 작업에서 `--env production`을 지정한다. secret을 명령행
   인자·스크립트 소스·CI output에 넣지 않는다. 등록이 deployment를 바꿀 수 있으므로 기존
   배포·production Environment 승인 절차를 유지한다.
4. 해당 환경 전용 합성 레코드의 저장·재열람과 다른 사용자 AAD 거부를 확인한다. smoke는
   원문을 출력하지 않고 성공 여부·키 ID·비민감 실행 ID만 기록한다.
5. #27에는 환경, secret **이름**, 키 ID, 등록 일시, 담당자, 비민감 검증 증거 URL만 남긴다.
   키 원문·암호문 dump·D1 export는 증거에 포함하지 않는다.

#9의 offline 통과는 실제 Worker secret 등록이나 운영 복구 성공을 뜻하지 않는다.
production 공개 전환은 기존 출시 게이트와 승인 이후에만 수행한다.

## 키 회전

최소 연 1회 및 노출 의심 시 회전한다. 새 키 ID는 새 무작위 키를 의미한다. 기존 ID의 키를
덮어쓰거나 두 ID에 같은 키를 할당하지 않는다. 현재 환경 adapter는 ID `1`만 허용한다.
회전 시 `CASE_DATA_KEY_V2`를 추가하고 서버 코드의 명시적 allowlist와 activeKeyId를
검토하는 별도 변경으로 진행한다. envelope에서 환경 변수 이름을 만들어 secret을 찾지 않는다.

1. 해당 환경의 새 키를 생성·보관·등록한다. 서버의 `createEnvelopeCipher`에
   `{ activeKeyId: "1", keys: { "1": oldKey, "2": newKey } }`로 읽기 호환 버전을 먼저 배포한다.
   allowlist는 최대 8개 버전이다. 기존/새 합성 암호문을 모두 읽을 수 있는지 검증한다.
2. 모든 실행 버전이 새 키를 읽을 수 있을 때 `activeKeyId: "2"`로 새 쓰기를 전환한다.
   Workflow의 이전 실행 코드가 쓰는 키도 호환 기간에 포함한다. rollback 버전도 ID `2`를
   읽을 수 있어야 한다.
3. 인증·소유권·삭제 가드가 있는 별도 관리 작업에서 작은 batch로 기존 암호문을 읽어
   같은 AAD로 복호화·재암호화한다. 각 쓰기는 새 IV를 쓴다. 읽은 ciphertext/revision과
   소유 행의 존재를 비교해 조건부 UPDATE하며 변경·삭제된 행을 재생성하지 않는다.
   이 작업의 DB·Workflow 구현은 해당 소유 이슈에서 수행한다.
4. 네 암호화 열과 진행 중 Workflow checkpoint의 키 버전별 건수를 확인하고, 대상 0건 및
   재열람·AAD 거부·삭제 race 검증을 기록한다. 로그에는 내용 없이 건수·버전·실행 ID만 남긴다.
5. backup 보존 창 전체와 오래된 Workflow/rollback 실행의 키 의존성을 확인한다. 현재 행
   이동만으로 이전 키를 삭제하지 않는다. 이전 키가 필요한 backup을 복구할 수 있도록
   접근 통제된 복구 사본을 유지한다.
6. 이전 버전이 필요한 행·실행·복구 대상이 없고 복구 검증까지 끝난 뒤에만 읽기 allowlist,
   Worker secret, 비밀 관리 저장소의 이전 키 제거를 각각 승인·기록한다.

## 분실·노출·복구

키 분실이나 잘못된 secret으로 복호화가 실패하면 쓰기를 중지하고 임의 키 생성, 빈 값 저장,
평문 fallback을 하지 않는다. 키 원문 없이 환경·배포 버전·키 ID·실패 코드로 범위를 확인한다.
동일 ID의 올바른 키를 비밀 관리 저장소에서 복원한 뒤 합성 복호화와 접근 통제를 재검증한다.
모든 복구 사본을 잃으면 암호문은 복구할 수 없으며 재암호화로 해결할 수 없다.

노출 의심은 [사고 대응](../security/SECURITY-PRIVACY.md)의 봉쇄·통지 판단을 따른다. 단순
키 회전은 이미 유출된 plaintext/ciphertext+key의 기밀성을 되돌리지 않는다.

복구 drill은 격리된 접근 통제 환경에서 D1 backup/bookmark와 해당 키 버전을 복원하여
수행한다. production 키를 local/preview에 복사하지 않는다. 복구 담당자는 삭제 journal을
재적용한 후 행/FK 건수, 네 암호화 열의 승인된 표본 복호화, 잘못된 AAD 거부, 접근 거부를
확인한다. 원문을 새 로그에 남기지 않고 각 검증의 pass/fail과 비민감 식별자만 기록한다.
사용된 복구 환경은 승인된 보존 정책에 따라 정리한다. #27 및 복구·삭제 담당 #17/#19에
담당자·환경·backup 식별자·키 ID·실행 일시·증거 URL을 남기며 실제 drill 전에는 미검증으로 표시한다.

## 검증

`bun test src/server/crypto`는 roundtrip, Unicode/BOM, 96bit fresh IV, 외부 Web Crypto와의
AAD/128bit tag 상호 검증, 행·소유자·열 transplant, IV/ciphertext/tag 변조, key allowlist,
회전·이전 키 제거, canonical encoding, malformed/oversize, 잘못된 Unicode, 무로그 실패를
합성 데이터로 확인한다. `bun run check`, `bun run build`, `bun run cf:dry-run`도 수행한다.

- [Cloudflare Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
