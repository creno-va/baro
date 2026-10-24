# 2026-10-24 공유 의존성 보안 수정 (#339)

상태: `codex/339-oct24-advisory-updates`의 로컬 후보. native 입력 draft PR453의
producer이며 exact PR/main CI·정상 통합 전 실제 배포/보안 전체 인수로 표시하지 않는다.

## 관측과 변경

native 후보에서 Expo build-properties를 추가한 뒤 실시한 [원본 audit](./dependency-security-2026-10-24/before.json)는
fast-uri·undici·zod와 이전 node-forge를 보고했다. 이 before는 main 자체의 audit가 아니라
native 후보의 graph다. main ddd7fe5의 lock에도 같은 취약 버전이 있었음을 별도로 확인했다.
신규 의존성이 기존 취약점들을 만들었다고 표현하지 않는다.

- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)에 따라 root·공통 contracts·
  API client의 직접4.6.5를4.6.6으로 맞춘다. 세 consumer는 같은 실제 Zod4 설치본을
  resolve한다. schema/wire·요청 크기·권한/동의·revision·AI quota/기술 상한은 변경하지 않는다.
- [fast-uri advisory](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)에 따라 ajv의
  실제3.1.8을3.1.9로 고정한다. 같은 패키지의 추가 세 advisory도 이 fixed release 범위다.
- [undici advisory](https://github.com/advisories/GHSA-xjj6-f33q-929c)에 따라 miniflare의
  실제7.29.1을7.30.1, unifont의 실제8.11.2를8.12.2로 맞춘다. 같은 패키지의 추가 두
  advisory도 이 fixed release 범위다. 서로 다른 major를 하나로 강제하지 않는다.

root version-scoped overrides `undici@7`/`undici@8`을 사용한다. [Bun 공식 동작](https://bun.sh/docs/pm/overrides#version-scoped-overrides)을
확인했고 프로젝트의 실제 고정 Bun1.4.0으로 독립 fixture의 exact7 consumer와 range8
consumer를 설치·resolve해 각각7.30.1/8.12.2임을 확인했다. 이 형식 때문에 Bun이
lockfileVersion3을 생성한다. 실제 같은1.4.0 frozen install과 CI로 재검증하며 Bun 버전은
바꾸지 않는다. 패키지 SRI는 새 공식 registry 배포본의 실제 값이다.

## 남은 audit와 경계

[수정 후 원본 audit](./dependency-security-2026-10-24/after.json)는 exit1이며 node-forge high와
zod high를 계속 보고한다. 직접 Zod4는4.6.6으로 고쳤으나 Expo CLI의 별도 Zod3.25.76이
넓은 `<4.6.6` advisory 범위에 남는다. CLI는3.x를 요구하므로4.x로 강제하지 않았다.
이 잔여를 false positive/수정 완료로 분류하지 않으며 호환 가능한 upstream/보완·도달성
검증을 #339에 남긴다. 기존 node-forge1.4.0 CJS backport/원본 version/SRI/LICENSE·
browser dist/map 잔여와 raw audit 실패도 보존한다.

이 producer는 새 advisory의 공식 fixed 버전을 적용할 수 있는 범위를 처리한다.
raw audit·전체 보안/#339/#71 또는 모바일 #334 완료 주장이 아니다. native 입력 후보는 이
공유 producer 통합 뒤 rebase·검증하고 기존 앱 원본/실패를 새 후보의 성공으로 재명명하지
않는다. 웹 UI 소유 파일·DB/schema·공급자·비용 관측 전용 정책과 production 배포는 바꾸지 않는다.

## 로컬 검증

고정 Bun1.4.0의 `bun ci`와 quick115개/22파일·모바일/공통419개·RN88개, actual consumer/
공통 계약·CJS 보완 회귀53개가 통과했다. production build/Worker dry-run·실제 local
workerd 익명 login HTML과 두 OS Metro export도 통과했다. 전체 unit은 진행 중이며 해당
결과를 확인한 후 정상 병합한다. 이 검증에 실제 OAuth/유료 공급자·production 배포는 없다.
