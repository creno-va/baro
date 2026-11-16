# 대화·자료 패널·질문 UI 검토

기준은 PR #812의 `27a09b10b9d51192bb534fbdcd07ff0214031352`다.
`codex/baro-conversation-ui`에서 기존 업무 controller와 새 Tailwind·Headless 화면을 연결했다.
이 검토는 전체 프론트 이관·외부 연동·배포 완료를 뜻하지 않는다.

## 소스 경계

- 질문 controller의 원래 상태·refs·load/effect/autosave/navigation/advance/save 코어는 recovery JSX를 제외한 23,303바이트가 기준과 동일하다.
  SHA256: `08878c15dd82cd9d072906c95d5ef409a7c9c047a07bd76c6268693a93200090`.
- WorkspaceContent의 주 return 이전 controller 62,484바이트가 기준과 동일하다.
  SHA256: `75519535ca1bfdaac0685e260f7956b9c1a3c243e52e44da3640b86d9b48d096`.
- 기존 프레임의 포커스·viewport effect 3,384바이트와 숨은 파일 chooser를 보존했다.
  이동한 native form/textarea 이벤트·IME·전송 비활성 조건 13개를 AST로 대조했다.
- API·DB·공유 client·모바일·랜딩·원본 CSS는 변경하지 않았다.
  cases/workspace CSS는 제품 진입에서 legacy layer로 가져오며 기존 Astro import만 제거했다.
- 기존 브라우저 과업의 상태·포커스·API 호출 수·geometry 단언은 유지했다.
  오래된 시각 class만 명시적 product hook으로 바꿨고, outline 동작은 명시적 appearance 속성으로 확인한다.
  시작 화면의 44px 검사가 빈 목록에서 통과하지 않도록 검사 대상을 보강했다.

## Computer Use 관찰

2026-11-16 in-app browser에서 localhost 4351의 명시적 mock/fixture 모드를 사용했다.
준비 버튼으로 합성 계정·사건을 만든 뒤 실제 `/new`, `/cases/:id`, `/cases/:id/intake` 경로를 조작했다.
공식 공개 Codex 영상 reference는 앞 단계의 [출처 기록](../product-shell/README.md)에 보존한다.

| 과업 | 관찰 |
| --- | --- |
| 대화 입력 | 네이티브 textarea·44px 전송, 초안 입력과 메뉴 연결 확인 |
| 첨부 메뉴 | Tab으로 첫 항목 진입, Escape 뒤 plus 복귀, 마지막 항목에서 Tab으로 전송 버튼 이동, 바깥 textarea 클릭 뒤 포커스 유지 |
| 외부 조회 | 기존 확인창 진입·Escape 닫기 확인. 합성 연결 상태 오류를 표시했으며 실제 조회 제출은 하지 않음 |
| 자료 패널 | desktop inline → mobile sheet, Escape 닫기와 자료 열기 버튼 복귀, 미전송 초안 보존 |
| 반응형 | 320×568에서 전송 버튼 bottom 515px, 44×44px, document width 320px. 390px 및 768/1024/1199/1200/1440px 경계 확인 |
| 전체 배치 | unlayered workspace CSS로 main 폭 960px·상단 22px·입력 아래 큰 공백 발견. legacy layer로 이동 후 1440px에서 main 폭 1168px, frame top 0·bottom 876px, notice까지 main bottom 900px 확인 |
| 질문 | 새 사건 생성 → 1차 1/3 진입, 답변 입력·3초 autosave 후 새로고침에서 같은 답변 복구, 다음 질문·모름 저장·이전 질문에서 모름 상태 재확인 |
| 작은 질문 화면 | 320px에서 가로 넘침 없음, 이전/다음 최소 44px. 긴 다음 버튼 문구는 두 줄로 표시 |

[반응형 측정](./responsive.json)은 각 크기에서 같은 미전송 초안 보존·main bottom·전송 높이·panel mode를 기록한다.
질문 저장은 로컬 mock 결과이며 실제 DB 쓰기·AI 생성 성공으로 표현하지 않는다.

별도 localhost 4352는 기존 독립 프레임 fixture다. 실제 `product.css`를 공식 Tailwind compiler/scanner 4.3.3으로 컴파일한다.
기존 CSP·API stub은 유지했으며 compiler 두 패키지만 직접 devDependency로 선언했다. 잠금 파일의 기존 패키지 해석은 보존했다.
공통 `tests/helpers/product-styles.ts`를 통해 실제 ReportReview를 사용하는 두 독립 리포트 서버도 같은 제품 CSS를 컴파일한다.
기존 보고서/evidence/resolution/settings CSS와 API resolver·HTTP adapter·CSP는 유지했다. ReportReading만 사용하는 조판/공식 출처 fixture는 변경하지 않았다.
공유 compiler 출력에서 미해결 import/directive가 없고 제품 utility가 포함되는 것을 별도 CLI로 확인했다. 전체 리포트 브라우저 과업을 실행했다는 뜻은 아니다.
자료 교정·대화·안쪽 교정 초안을 입력하고 중첩 확인창을 연 채 1440→390px로 전환했다.
안쪽 modal과 편집 포커스가 유지되고, Escape 뒤 자료 sheet로 전환되며 부모 교정·대화 초안이 보존되는 것을 확인했다.
다시 Escape를 누르면 자료 열기 버튼으로 복귀했다. 이는 실제 자료 교정 API 저장의 증거가 아니다.

[브라우저 오류 기록](./browser-errors.json)은 두 검토 origin에서 수집한 console error/warning 0개다.
이전 작업 origin의 로그는 제외했다. 임시 viewport와 두 로컬 서버는 검토 뒤 해제했다.

## 화면

- [대화 라이트 1440px](./conversation-desktop-light.png), [대화 다크 390px](./conversation-mobile-dark.png).
- [자료 sheet 다크](./materials-sheet-dark.png), [독립 자료 편집 fixture](./fixture-materials-mobile.png).
- [질문 라이트 1440px](./questions-desktop-light.png), [질문 320px](./questions-mobile-light.png).

## 검증 범위와 남은 작업

Controller/SSR·보존 테스트 111개·609개 단언과 기존 질문 회귀, app/tools 타입 검사를 통과했다.
`bun ci`, `validate:quick`, `validate:build`, 현재 `product-ui:check`를 통과했다.
production 번들에 shell 합성 경로/helper가 없으며 Workers dry-run·built-runtime 검사를 통과했다. 배포하지 않았다.
최종 검사 SHA와 PR CI 결과는 PR에 기록한다.
이 브라우저 검토는 전체 자동 브라우저 suite·WebKit·실제 OS IME·OAuth·외부 공급자·원격 DB·운영 인수를 대신하지 않는다.
상세 자료·요약 재확인·리포트·후속 해결·계정 화면의 새 시각 tree와 같은 디자인의 랜딩 재구현은 남아 있다.
