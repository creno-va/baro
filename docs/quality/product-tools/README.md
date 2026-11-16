# 대화 도구·후속 해결·계정 UI 검토

기준은 PR [#816](https://github.com/creno-va/baro/pull/816)의
`44caf3ae302bd2fafd4bb7f661b0b33130a0098c`다. 대화 분석·준비·메시지·작업 패널,
후속 해결/문서 초안과 계정/보존 자산을 새 Tailwind·Headless UI tree로 이관했다.
설계와 남은 기능은 [PRODUCT-TOOLS](../../development/PRODUCT-TOOLS.md)에 구분한다.
이 기록은 전체 프론트·외부 공급자·배포 인수 완료를 뜻하지 않는다.

## 보존과 독립 검토

기존 entry의 props/export는 facade로 유지한다. controller의 owner·epoch·abort·polling·receipt·CAS,
동의/재인증과 삭제·초안·다운로드 경계를 옮기고 원문과 대조했다.
[대화 원문 구간](./conversation-source-proof.json), [대화 AST](./conversation-ast-proof.json),
[계정/후속 해결 AST](./account-resolution-ast-proof.json)에 비교 범위와 결과를 기록한다.
이 증거의 원본 #815와 #816 사이에는 해당 private 컴포넌트 변경이 없다.

| 원문 핵심 구간 | 동일한 UTF-8 바이트 |
| --- | --- |
| ConversationAgent | 19,415 |
| ConversationPanel의 ID/ref·세 effect | 3,136 |
| ProgressiveReply | 2,168 |
| MessageContent parser | 1,679 |
| Resolution | 14,687 |
| AccountSettings | 9,086 |
| LegacyProfileAssets | 6,785 |

표의 마지막 경계 newline 제외 여부는 설계 문서에 명시한다. JS 문자열 문자 수와 UTF-8 byte 수를 구분한다.
원문 구간 동일성과 별도로 API 인자·disabled·checked·native callback·pane/owner·다운로드 조건을
독립 검토했으며 새 상태 변경·저장 성공을 임의로 만들어내지 않았다.
계정 preview의 기존 오류/알림은 modal 안에서도 읽을 수 있게 표시한다.
공통 Disclosure는 기존 optional handle의 close/contains/closest/focusTrigger/open을 Headless 동작으로 지원한다.

## CSS와 격리 fixture

원래 resolution/settings CSS 내용은 바꾸지 않고 제품 legacy layer로 모았다.
settings Astro는 해당 raw import 한 줄만 제거했다.
독립 resolution/report 서버도 실제 product.css를 컴파일한다. API·endpoint·CSP는 그대로다.
대화 전용 Astro fixture는 같은 head·cache·bootstrap/hash·Experience·app-focus를 유지하며 새 CSS와
테스트 전용 legacy layer를 사용한다. [14개 보존 확인](./fixture-csp-proof.json)을 기록한다.

controller 이동 뒤 stub 대상에서 빠진 import는 테스트 전용 config 세 개에서 실제 owning controller 경로만
연결했다. 실제 resolver를 호출한 3 tests/28 assertions로 기존 대상과 인접 view·다른 domain·core·undefined
importer를 구분한다. 생산 Astro config·fixture API·binding·반환 URL은 바꾸지 않는다.
브라우저 consumer 8개는 승인된 selector argument만 AST로 옮기고 geometry/RGB/Axe·권한·호출 수 등 단언은 유지한다.
원문·viewer·별도 fixture·기존 zero 검사에는 새 선택자를 덧씌우지 않는다.

## Computer Use

2026-11-16 KST in-app browser에서 다음 세 로컬 구성을 조작했다.
모두 명시적인 합성 데이터이며 실제 계정·정책 동의·원격 DB·AI/법률 조회·OAuth는 실행한 것으로 표시하지 않는다.

| 구성 | 실제 확인 |
| --- | --- |
| localhost 4376, 기존 component/service harness | 직접 해결 선택, 공식 안내 미확인·선택 범위·허용된 사실 정리 초안 표시, 명시적 확인 뒤 초안 준비 |
| 같은 초안 | 검토 체크 뒤 본문 수정 시 체크 해제와 저장/다운로드 잠금, scope/host 이동 잠금, 재검토·저장, TXT 다운로드 이벤트와 파일 수신 |
| 같은 초안의 재개 | 잠시 중단 → 편집 비활성 → 이어서 진행, 대화/리포트 surface 재mount 후 저장 문구 보존 |
| 지원 안내 | 미지원 변호사 안내 modal, 390px Escape 뒤 원래 경로 버튼 복귀 |
| 초안 Select | 390px dark portal x=36/right=354/bottom=540, 실제 허용 항목 한 개만 표시. Escape 뒤 trigger 복귀 |
| localhost 4365, Astro 격리 Agent | 실제 메뉴 열기·선택 후 닫힘, 분석 unavailable·미확인/한계 표시, panel heading focus, Escape 뒤 다른 작업 trigger 복귀 |
| 같은 패널 | 미저장 합성 입력 → 닫기 확인창, 390px 전환·Escape 뒤 입력 보존, 명시적 변경 버리기 뒤 trigger 복귀, 합성 계정 전환 뒤 이전 Agent 작업 영역 제거 |
| localhost 4366, 실제 `/settings` | 준비 버튼으로 합성 계정 생성, 실제 사용량·한도 안내/정책 링크, dark/light·390px/320px 가로 넘침 없음 |
| 계정 삭제 확인 | 빈 DELETE에서 submit 비활성, 정확한 문자열 입력 시 활성 조건, 320px dialog와 Escape 뒤 삭제 opener 복귀. 최종 삭제·OAuth는 실행하지 않음 |
| 계정 배치 | desktop 오른쪽 action·heading 중심 오차 0px·버튼 44px 확인. 상단 여백은 desktop heading y=40, mobile y=88(56px header+32px) |
| 실제 `/cases/:id` | 새 Preparation의 빈 일정/행동과 실제 갱신 버튼, 요청 중 비활성·합성 사용자/응답 메시지와 첨부 표시, mobile sheet 닫기와 320px 가로 넘침 없음 |

실제 mock 갱신은 한계가 명시된 합성 응답을 반환했으며 구체 행동 수는 0으로 남았다.
이를 실제 행동 생성·AI 분석 성공으로 기록하지 않는다.
기존 자산의 실제 소유자 preview·실제 OAuth·계정 삭제·모든 오류/만료/응답 유실의 브라우저 실행은
이번 CUA 범위에 포함하지 않았으며 controller/SSR·기존 회귀와 구분한다.

검토 중 계정 danger action의 기존 inline/중앙 geometry가 새 header 조립에서 어긋나는 문제를 찾아
단언을 유지한 채 heading hook과 action 배치를 고쳤다. 상단/모바일 좌우 여백도 실제 화면에서 보완했다.
정상 [후속 해결](./resolution-browser-warnings.json), [격리 대화](./conversation-browser-warnings.json),
[실제 제품 경로](./actual-route-browser-warnings.json)의 console warning/error는 모두 빈 배열이다.
임시 탭·viewport·로컬 서버는 검토 뒤 정리했다.

## 화면과 최종 검사

- [분석 dark](./conversation-analysis-dark.png), [패널 초안 mobile dark](./conversation-panel-draft-mobile-dark.png)
- [실제 준비 패널 light](./conversation-preparation-light.png), [실제 메시지 320px](./conversation-messages-320-light.png)
- [검토·저장한 초안 dark](./resolution-reviewed-draft-dark.png), [초안 Select mobile](./resolution-select-mobile-dark.png), [지원 안내](./resolution-unavailable-mobile-dark.png)
- [설정 desktop dark](./account-settings-desktop-dark.png), [설정 mobile light](./account-settings-mobile-light.png), [삭제 확인 320px](./account-confirmation-320-dark.png)

새 UI/fixture resolver/보존 검사를 함께 실행한 61 tests/1,131 assertions가 통과했다.
독립 검토·기존 회귀 묶음은 겹침을 합산하지 않고 설계 문서에 각각 기록한다.
최종 소스에서 `validate:quick`, `validate:build`, 현재 `product-ui:check`와 tools TypeScript를 통과했다.
Astro 검사는 650개 파일에서 error/warning 0개였다. quick의 기존 Docker 의존 검사 4개는 로컬에서 skip됐고,
실제 Linux PDF/원본 인수와 구분한다. production Worker dry-run·built-runtime도 통과했으며 배포하지 않았다.
정확한 commit/PR CI 결과는 해당 PR에 기록한다.
이 CUA를 전체 자동 브라우저 suite·WebKit·실제 OS IME·유료 모델·원격 DB·운영 인수로 확대하지 않는다.
