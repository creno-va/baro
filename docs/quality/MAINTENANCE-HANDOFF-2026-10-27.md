# 2026-10-27 정비 종료·보류 조건 인계

## 사용자 결정과 종료 의미

사용자는 검증을 가볍게 하고 남은 이슈를 모두 닫는 것을 요청했다. API/tool calling은
키 준비 전 보류하고 스토어는 현재 진행 불가이므로 작업 범위에서 제외한다.
#334/#346/#354/#361/#369/#379는 이미 사용자 범위 종료(not planned)로 닫았다.
남은 #339/#506/#71도 아래 사실을 보존한 범위 종료(not planned)로 정리한다.
실제 최종 GitHub 상태·문서 PR/merge SHA는 #71의 종료 기록에서 확인한다.

**이슈 종료는 미해결 결함의 수정, 전체 MVP 실제 인수, 보안 승인 또는 배포 승인이 아니다.**
코드·의존성·보안/릴리스 검사·credential·원장·실제 실행 상태는 이번 정리에서 바꾸지 않는다.
아래 조건은 재개 때 확인할 사실이며 자동 작업·재시도·새 공개 출시를 승인하지 않는다.

## 보존하는 미해결 조건

| 범위 | 현재 사실 | 재개 시 필요한 조건 |
| --- | --- | --- |
| 보안 / #339 | node-forge와 Expo CLI Zod3의 원본 audit high2. vendor 보완은 병합됐으나 공식 수정판/전체 보안 통과는 별개다. | 호환되는 공식 수정 또는 별도로 검증한 대응과 실제 raw audit/보안 인수. 버전명 조작·allowlist·검사 생략으로 통과시키지 않는다. |
| 구형 재분석 / #506 | 실제 기존 attempt2/minimize unknown1의 terminal receipt를 확보하지 못했다. 읽기·삭제·read-only 상태 확인과 안전한 재시도 상태 코드는 보존한다. | 원래 실행의 genuine terminal receipt를 확보한 뒤 원래 요청/시도·소유권·revision에 결합된 복구. 제3 호출/reset·새 fixture·원장 삭제로 우회하지 않는다. |
| API·자동 등기조회 | 국세청/더치트/DataHub 미발급. 원래 목적은 전세사기 관련 개별 건물의 등기부 자료 자동 확보다. | 실제 상품 권한/키·필요 계정/선불결제 조건을 준비한 뒤 사용자 지시에 따라 구현·검증을 재개한다. |
| 스토어 | 제출/서명/출시는 현재 사용자 범위에서 제외. 이전 compile/source 증거는 실제 스토어·물리 기기 인수가 아니다. | 사용자가 재개를 요청하고 계정·서명·상품/정책 조건이 준비된 때 별도 검토. |
| 최종 운영 / #71 | 동일 후보의 full 성공·preview 제한 smoke·최종 운영 승인/production 인수 및 미확인 실제 계정/기기·정책 증거는 완료되지 않았다. | 기존 검사와 실제 증거를 충족해야 한다. 이슈 CLOSED나 개발 정비 완료를 이 증거로 사용하지 않는다. |

등기정보광장의 미구현 placeholder/통계 연동은 제외를 유지한다. **자동 등기조회 목적
자체를 불필요하다고 판단했던 설명은 정정한다.** 현재 DataHub 코드는 사전주소 후보와
건축물대장 식별자4개 직접 입력 경로까지만 있다. 공식
[고유번호로 PDF열람(선불결제전용) 명세](https://dataapi.co.kr/upload/dLab/20260831-151849-54674.html)의
RealEstateUniqNumPdfPrepaid는 미구현이다. 이 명세는 Token 외 원천 계정/암호화 비밀번호·
선불결제 카드정보를 요구하므로 키 하나로 운영 완료를 약속하지 않는다. 주소→정확한 대상
선택→등기부 PDF→자료 처리 연결과 건축물 주소 식별자 취득은 재개 후 작업이다.
인증/카드 값이나 실제 등기부 원문은 이슈·로그·공개 artifact에 남기지 않는다.

## 재사용하는 정확한 검증 증거

- 제품/도구 소스 기준: main2001a2d2ed642322cfba80752903cacb796e85cf.
  [main CI40438328439](https://github.com/creno-va/baro/actions/runs/40438328439)는 SUCCESS.
- 같은 SHA의 [full40438383860](https://github.com/creno-va/baro/actions/runs/40438383860)는
  전체Bun4389pass/기존host2skip·DB fresh/upgrade/import·offline eval·build/bundle/dry-run/
  local workerd·전체 browser·CSP7pass/명시fixture1skip·조기 실제Gitleaks 뒤 원본
  bun audit high2에서 FAILURE. 성공 release receipt나 새 preview/production 배포는 없다.
- [native40433501799](https://github.com/creno-va/baro/actions/runs/40433501799)는 선행
  main31fa612f517cd379a71cbbcb0a0acef4e114fe51의 offline 파일 처리 profile SUCCESS.
  receipt의 full/provider/appRuntime/deployed=false를 보존하며 현재 SHA나 기기 성공으로
  확대하지 않는다. PR554/538의 Android·양 iOS compile/core 증거도 각 원래 SHA에 묶인다.
- 가벼운 로컬 확인: 기존5파일111개 중108pass/3timeout. CLI Zod3 전체 tree/consumer5초,
  forge 전체 tree attestation5초, 두 UMD 서명 회귀30초가 시간 초과였다. 구형 분석 합성
  회귀에서 새 기능 실패는 없었으나 실제 unknown 복구 증거는 아니다. 한도/단언 변경이나
  대규모 재검사는 하지 않았으며 이 결과를 전체 성공으로 표시하지 않는다.

이번 인계 문서 변경은 제품/lockfile/환경/DB/릴리스 코드와 별개다. 기존 기능 검증은 위
원래 SHA의 증거로 보존하고 문서 변경에는 링크/작업 그래프·diff와 정확 PR CI만 확인한다.
사용자의 가벼운 검증 지시에 따라 같은 원인의 45분 full/유료 호출은 반복하지 않는다.
실제 릴리스 재개 시에는 ADR-0015의 같은 SHA full·preview·운영자 승인 조건이 계속 적용된다.
