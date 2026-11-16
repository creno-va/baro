# 요약·자료·리포트 UI 검토

기준 커밋은 PR [#813](https://github.com/creno-va/baro/pull/813)의
`8c642ea1dd157e83456314095251a8d58f9d4c38`이다. 이 단계는 사건 요약 재확인,
맥락 변경, 자료 목록·내용 교정, 리포트 읽기·편집 화면을 새 Tailwind·Headless UI tree로 옮긴다.
전체 프론트 이관·외부 공급자 인수·배포 완료를 뜻하지 않는다.

## 보존 범위

- 기존 public props와 export를 facade로 유지한다. 소유권 검사, revision/CAS,
  응답 유실·partial-save 복구, native form/textarea 이벤트, 저장·다운로드는 기존 controller가 소유한다.
- ReportReview의 상태·refs·effects·read/write core 25,813바이트는 trailing whitespace를
  제외하고 기준과 동일하다. SHA256은
  `5540bef78ef09dfb8bba6cd5f632fcbda93480d1b96f5136ed2dc27ec680866e`다.
  이동한 콜백 24개와 disabled 식 22개, aria-expanded/aria-controls 식을 AST로 대조했다.
  report가 있어야 노출되던 콜백 3개에만 동일한 실행 경계를 명시하는 null guard가 있다.
- SummaryReconfirmation core 17,987바이트, ContextReview core, FileReview와
  CaseContext의 기존 상태·effect 구간을 별도로 대조했다. 자료 API·확인 호출 6개의 순서와 인자는 같다.
  원문·출처 연결, 5,000자 교정 제한, 30,000 UTF-16 리포트 제한, 사진 삽입·마스킹 계약을 유지한다.
- `report-document`, `report-reading`, `report-reading-section`, `report-markdown`,
  `report-outline-toggle`과 사진·공식 출처의 문서 class는 유지한다.
  HTML/PDF renderer·download·sanitizer·공유 client·API·DB·모바일·랜딩은 변경하지 않는다.
- 기존 intake/evidence/reports CSS를 제품 legacy layer로 모았다. 원래 CSS 내용은 그대로다.
  11개 기존 경로는 해당 CSS import 한 줄만 제거했다.
- 27개 브라우저/helper 파일은 실제 이관된 시각 선택자만 바꾼다. 기능·권한·포커스·RGB·PDF geometry·
  API 호출 수·Axe 단언은 그대로다. ReportReading만 쓰는 별도 fixture와 설정의 기존 `.report-modal`은 보존했다.
  독립 서버 5개는 실제 제품 stylesheet를 컴파일하며 API resolver·endpoint·CSP는 같다.

현재 `product-ui:check`/`product-details:check`는 기준 SHA부터 HEAD/index/worktree,
추적되지 않은 파일·rename·symlink·정확한 package/선택자/import 변경을 검사한다.
이 검사는 업무 동작 검증을 대신하지 않는다.

## Computer Use

2026-11-16 in-app browser에서 localhost 4362의 실제 Astro 경로를 조작했다.
`PUBLIC_API_MODE=mock`, 개발 전용 fixture의 **자료가 있는 합성 계정 준비** 버튼을 사용했다.
실제 로그인·정책 동의·원격 DB 쓰기·AI/공식 법률 조회는 하지 않았다.
부분 분석인 텍스트 자료만 명시적으로 준비했으며 원본 binary를 만들었다고 표시하지 않는다.

| 과업 | 관찰 |
| --- | --- |
| 요약 재확인 | 설명 입력·취소·재열기, 변경 요청 → 변경 전후 제안 → 명시적 확정 → 실제 대화 경로 복귀 확인 |
| 요약 출처 | 새 Disclosure의 원문·확인 상태 펼침, 합성 진술과 미확인 날짜 보존 확인 |
| 맥락 변경 | 사건 분야 목록을 ArrowDown/Enter로 민사 선택, 설명 저장, 재열기에서 같은 값 확인 |
| 선택 목록 | desktop dark portal 색상·뷰포트 경계 확인. mobile light 목록 x=41/right=349/bottom=817, 390×844 안에 배치 |
| 모달 | 목록 Escape는 목록만 닫고 trigger로 복귀, 다음 Escape는 맥락 모달을 닫고 입장·절차 확인으로 복귀 |
| 자료 | 처리한 1쪽·품질 저하 2쪽, partial 안내와 원본 추출 구분, 교정 초안 중 반영 비활성 확인 |
| 교정 저장 | 저장 후 파일 v2와 사용자 교정 표시, 새 경로/모바일에서 같은 내용 확인 |
| 리포트 준비 | 실제 mock action으로 준비. 공식 자료 unavailable와 합성 한계를 그대로 표시하고 생성 |
| 편집·저장 | 섹션 편집, dirty 상태, 취소 확인창 Escape 후 편집 유지, 저장된 v2 읽기 확인 |
| 범위 | 식별정보 가림 체크·선택 범위 저장 후 v3 확인. native checked=true와 appearance=auto 확인 |
| PDF | 실제 UI 버튼에서 로컬 mock PDF 다운로드 이벤트·파일 수신 확인. 실제 D1/운영 PDF 제작 증거가 아님 |
| 반응형 | 1440×900 dark, 390×844 light, 320×568 확인. 관찰한 390/320 문서 폭은 각각 정확히 390/320이며 가로 넘침 없음 |
| 좁은 확인창 | 320px에서 새 버전 확인창과 두 버튼이 보이고, 취소 후 새 버전 만들기로 포커스 복귀 |

검토 중 SummaryDisclosure가 Fragment에 data 속성을 전달해 화면을 중단하는 문제를 발견하여
실제 div를 렌더하도록 수정했다. 기존 전역 appearance reset이 새 native checkbox/radio를 숨기는
문제도 발견하여 이 단계의 새 입력에 `appearance-auto`를 적용했다. 수정 뒤 새 탭에서 요약 출처를
펼치고 수집한 [최종 경고 기록](./final-summary-browser-warnings.json)은 빈 배열이다.
초기 실패가 없었다고 주장하지 않으며, 이 기록을 전체 브라우저 suite 실행으로 해석하지 않는다.
임시 viewport·검증 탭을 해제하고 localhost 개발 서버를 종료했다.

## 화면

- [요약 desktop light](./summary-desktop-light.png), [요약 mobile light](./summary-mobile-light.png)
- [변경 전후 제안 dark](./summary-proposal-dark.png)
- [맥락 목록 dark](./context-select-dark.png), [맥락 목록 mobile light](./context-mobile-select-light.png)
- [자료 검토 mobile light](./material-mobile-light.png)
- [리포트 desktop dark](./report-reading-dark.png), [리포트 mobile light](./report-mobile-light.png)
- [리포트 확인창 320px light](./report-confirm-320-light.png)

## 검증과 한계

새 primitive/summary/materials/report/보존 테스트 57개, 387개 단언을 통과했다.
기존 요약·자료·리포트 복구 테스트 48개, 435개 단언도 통과했다.
최종 소스에서 `validate:quick`, `validate:build`, strict TSX·tools 타입과 현재 `product-ui:check`를 통과했다.
Astro 검사는 627개 파일에서 error/warning 0개였다. quick의 기존 Docker 의존 검사 4개는 로컬에서 skip됐으며,
실제 Linux PDF/원본 검증은 독립 CI 결과와 구분한다. production Worker dry-run·built-runtime도 통과했고 배포하지 않았다.
커밋 SHA와 최종 PR CI 결과는 해당 PR의 검증 탭에 기록한다.
이 단계의 CUA는 전체 자동 브라우저 suite·WebKit·실제 OS IME·OAuth·원격 D1·운영 인수를 대신하지 않는다.
사진 선택·배치와 partial-save/owner/revision 경계는 기존 회귀 및 새 단위 테스트를 보존했으며,
이번 CUA에서 실제 사진 업로드·배치를 수행했다고 주장하지 않는다.

대화의 분석·경위·행동/메시지·업로드 진행, 원본 미디어 viewer, 판례·외부 조회,
후속 해결·문서 초안, 계정·로그인·동의·도움말·정책 등 실제 남은 UI는
[상세 화면 계획](../../development/PRODUCT-DETAILS.md)과 후속 범위에 별도로 관리한다.
Zustand/TanStack factory가 마련된 것과 업무 query 전환·중복 호출 제거 완료를 구분한다.
