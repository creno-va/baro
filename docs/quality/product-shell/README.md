# 제품 shell 검토 기록

이 기록은 `codex/baro-workspace-shell`의 탐색·시작 화면과 기존 업무 연결을 검토한 결과다.
초기 기반은 PR #810의 `1f8c70dd2d6cccd95e067e0a5b0fc770cd7bf283`이다.

## 디자인 출처

2026-11-16 브라우저 Computer Use로 [OpenAI 공식 소개 페이지](https://openai.com/ko-KR/index/introducing-the-codex-app/)의 2026년 2월 영상을 관찰했다.
native 앱 접근은 계속 도구 보안 정책으로 차단된 상태이며 이를 우회하지 않았다.

[reference-codex-public.jpg](./reference-codex-public.jpg)는 공식 영상의 sidebar/본문 구조를 기록한 장면이다.
하단 composer의 얇은 테두리·둥근 입력창·어두운 전송 버튼도 별도 영상 장면에서 관찰했다.
소개 영상의 시점과 최신 설치 앱은 구분한다. 이 자료로 최신 앱의 픽셀 일치를 주장하지 않는다.
공식 화면은 제품 asset으로 사용하지 않는다.

## 제품 검토

개발 검토는 `PUBLIC_API_MODE=mock BARO_UI_TEST_FIXTURE=true`의 localhost 4339에서 수행했다.
준비 화면의 버튼으로 합성 계정·사건을 만든 뒤 실제 Astro 제품 경로를 사용했다.
브라우저 동작은 Computer Use의 in-app browser로 수행했다. 로컬 서버는 검토 뒤 내렸고 viewport를 초기화했다.

| 확인 항목 | 관찰 결과 |
| --- | --- |
| 실제 `/new` | 새 navigation·목적 선택·예시·textarea·전송·오류 UI hydration 확인. 라이트/다크에서 읽을 수 있는 버튼 대비와 heading 36px/500 확인 |
| CSS cascade | 첫 legacy import 안에서 Tailwind utility가 생성돼 기존 heading/link 규칙에 덮이는 문제 발견. 최상위 Tailwind 진입과 명시적 layer 순서로 수정 후 실제 계산 스타일 확인 |
| 길이·포커스 | emoji 9개를 9자로 세어 최소 10자 dialog 표시. Tab 순환·Escape/계속 작성 뒤 `#narrative` 복귀·내용 보존·`aria-invalid=false` 확인 |
| 실제 생성 동선 | 주장 대응 선택, 일반 Enter는 줄바꿈 유지, 전송 뒤 새 사건의 intake 1차 1/3 질문과 주장 대응 표시 확인. 실제 공급자 호출은 없음 |
| 최근 사건 관리 | 제목 검색·필터·Escape 복귀, 제목 저장 뒤 대화 header/목록 동시 갱신, 삭제 dialog의 초기 취소 포커스와 Escape 취소 확인. 삭제 최종 제출은 하지 않음 |
| 초안 유지 | 전송하지 않은 대화 초안이 검색·제목 변경·272→80px rail 접기·390px 전환·자료 sheet 닫기 뒤 유지됨 |
| 중첩 탐색 | 모바일 drawer 안 검색 열기→Escape는 drawer 검색 버튼으로, drawer 닫기는 header 메뉴로 복귀 |
| 실제 업무 진입 | 기존 사건 대화·자료 panel·별도 판례 URL·리포트 준비 상태·설정 사용량 화면 표시 확인. 준비/검색/생성 작업 자체를 자동 실행하지 않음 |
| 작은 입력 화면 | 320px에서 예시 3개가 세로 공간을 차지해 전송이 아래로 밀리는 현상 개선. 가로 스크롤 예시로 정리 후 전송 버튼 bottom 694.5px, viewport height 740px, document width 320px 확인 |
| 반응형 대화 | 기존 52px 계산과 새 56px header 차이, 768~1199px 전체 높이 오류 수정. 390/768/1024/1199/1200/1440px에서 document 폭이 viewport와 같고 main bottom 900px 확인 |
| 기존 랜딩 | 같은 개발 서버의 `/`에서 기존 hero·탐색·브랜드 유지 관찰. 랜딩 파일·에셋·BaseLayout·공유 원본 CSS는 보존 검사로 별도 확인 |

개발 탐색의 `/settings`에서 브라우저 cross-document transition의 `ViewTransition opt-in disabled` 오류 1개가 수집됐다.
설정 화면은 정상 표시됐고 관련 원본 transition CSS는 변경하지 않았다. 아래 별도 built UI 관찰에서는 이 오류를 포함한 새 origin의 console error/warning이 없었다.

## 빌드 CSP 확인

별도의 로컬 합성 빌드와 Workers 런타임 4341을 사용했다. `/new`의 서버 인증 가드는 합성 localStorage를 인증으로 인정하지 않아 `/login`으로 이동했다.
이를 해제하거나 Worker·API를 수정하지 않았다. 명시적 테스트 전용 `/__product-shell/input`에서 **동일한** CaseWorkbenchLayout과 CaseInput requireSession을 확인했다.
helper는 mock 외에는 404를 반환하며 배포 빌드에는 포함되지 않는다.

- [응답 증거](./built-csp-response.json): 200, 해시 CSP, unsafe-inline/unsafe-eval 없음, private/no-store/no-transform.
- [브라우저 증거](./built-csp-browser.json): 실제 textarea hydration·길이 dialog·Tab 순환·Escape 복귀·dark portal·검색 autofocus·모바일 drawer 동작 확인.
- 해당 built origin에서 수집한 console error/warning 0개. 모든 가능한 경로의 CSP 인수를 뜻하지 않는다.
- 실제 OAuth·서버 session·동의·원격 DB·외부 AI/법률 서비스 성공으로 표현하지 않는다.

## 화면 증거

| 파일 | 조건 |
| --- | --- |
| [새 입력 라이트](./new-desktop-light.jpg), [다크](./new-desktop-dark.jpg) | 1440×900, 실제 `/new` |
| [입력 320px](./new-mobile-320.jpg), [390px](./new-mobile-390.jpg) | viewport 320×740/390×844의 full-page 캡처 |
| [대화 연결](./workspace-desktop-light.jpg), [접힌 rail](./workspace-collapsed-desktop.jpg) | 기존 업무 island와 새 탐색, 1440×900 |
| [모바일 대화](./workspace-mobile-light.jpg), [drawer](./drawer-mobile-light.jpg), [검증 dialog](./validation-mobile-dark.jpg) | 390×844 동선 관찰. 대화 캡처는 높이 보정 전이며 최종 높이는 아래 측정 JSON으로 확인 |
| [반응형 측정](./responsive-measurements.json) | 접힌 rail 상태의 390~1440px 경계 측정 |
| [built 검색](./built-csp-search-dark.jpg), [built drawer](./built-csp-drawer-dark.jpg), [built 입력](./built-csp-new-mobile.jpg) | 로컬 합성 built CSP, 실제 제품 컴포넌트 |
| [기존 랜딩](./landing-preserved-desktop.jpg) | 기존 영상 한 프레임. 전체 모션·픽셀 동일성의 증거로 확대하지 않음 |

기능 controller·SSR·초기 기반/현재 shell 보존 테스트 69개·395개 단언을 통과했다.
`bun ci`, `validate:quick`, `validate:build`, 현재 `product-ui:check`와 문서 검사를 통과했다.
production 번들에는 두 shell 합성 경로와 helper가 없으며 Workers dry-run·built-runtime 확인을 통과했다. 원격 배포는 하지 않았다.
기존 dialog-focus 회귀의 늦은 포커스 검증문은 유지하며, 제거한 시각 class 대신 textarea의 native form 관계로 제출 버튼을 찾도록 선택자만 바꿨다.

실제 기기·OS 한글 IME·WebKit 전체 회귀, 상세 업무 화면의 새 시각 tree 이관·외부/운영 인수는 이 검토에 포함되지 않는다.
자료 교정·리포트 편집·PDF·후속 해결 등 기존 업무 모듈은 보존 상태이며 이 단계에서 재작성 완료로 표시하지 않는다.
