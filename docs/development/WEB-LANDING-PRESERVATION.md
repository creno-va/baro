# 웹 랜딩 디자인 보존 계약

- 기준일: 2026-11-16 KST
- 기준 소스: `main b54566f32d2d81f9c08ebc26acac0209623d3af1`
- 대상: [랜딩 진입점](../../src/pages/index.astro)의 `/` 화면과 직접 연결된 체험·탐색 동작

첫 기본 UI PR은 기존 랜딩의 디자인과 동작을 그대로 유지한다. 랜딩 마크업·문안·순서·에셋·
모션·반응형 및 여기에 영향을 주는 공통 레이아웃과 CSS는 보존하고, 새 프론트 기반은
별도 진입점에서 검토한다. 이후 이식 PR에서도 기존 디자인을 동일하게 구현하는 것이 기준이다.
이 문서는 소스 조사 결과와 향후 검증 계획이며, 전체 시각 동등성이나 배포 완료 기록이 아니다.
현재 브라우저 확인 범위는 기준 hero 페이지를 연 것까지다.

## 화면 순서와 연결

아래 순서는 [index.astro](../../src/pages/index.astro)의 실제 렌더 순서다. 각 컴포넌트의
문안·줄바꿈·가상 화면·CTA를 함께 보존한다. 상단 메뉴, 왼쪽 구간 탐색과 체험 링크가
참조하는 앵커 ID도 유지한다.

| 순서 | 소스·앵커 | 디자인과 동작 |
| --- | --- | --- |
| 1 | [LandingNavigation](../../src/components/landing/LandingNavigation.astro) | 상단 로고·구간 링크·로그인, 모바일 전체 메뉴, 구간 진행 표시 |
| 2 | [HeroFilm](../../src/components/landing/HeroFilm.astro) | 일상 영상 → 파란 포털 → 휴대전화 대화 예시. 제목은 “막막했던 법률 문제, 이제 정리부터 가볍게.” |
| 3 | `#how-it-works` · index | 세 줄 소개와 이야기·정리·준비 순서 |
| 4 | [OriginExperience](../../src/components/landing/OriginExperience.astro) · `#our-beginning` | 손글씨 메모의 종이색 장면에서 BARO 도착 화면으로 전환 |
| 5 | [BlueAppReveal](../../src/components/landing/BlueAppReveal.astro) · `#blue-app-reveal` | 작은 파란 원이 작업 공간으로 확장. 대화·자료·타임라인·리포트 네 기능 선택 |
| 6 | [LogoExperience](../../src/components/landing/LogoExperience.astro) · `#logo-experience` | 로고와 기능 타일의 회전·분리, 기능별 설명과 체험 연결 |
| 7 | [DemoLab](../../src/components/landing/DemoLab.astro) · `#try-baro` | 대여금·보증금·급여의 로컬 예시. 대화·자료·타임라인·리포트 체험 |
| 8 | [PainToClarity](../../src/components/landing/PainToClarity.astro) · `#clarity` | 어두운 배경의 흩어진 걱정을 사실·자료·질문으로 모으는 장면 |
| 9 | [PhoneStory](../../src/components/landing/PhoneStory.astro) · `#phone-story` | 3D 휴대전화와 이야기·자료·타임라인·상담 준비의 네 장면 |
| 10 | [TimeExperience](../../src/components/landing/TimeExperience.astro) · `#time-experience` | 시계 사진 확대·소멸, 파란 전환과 시간 관련 메시지 |
| 11 | [EverydayStories](../../src/components/landing/EverydayStories.astro) · `#everyday` | 집·일터·카페 사진과 세 가지 일상 이야기 |
| 12 | `.landing-lawyers` · index | 사건 준비 중 리포트 활용 안내와 범주 예시. 현재 변호사 디렉터리 진입 화면이 아님 |
| 13 | `#principles` · index | 사실·추정 구분, 공식 근거, 사용자 판단의 세 원칙 |
| 14 | [CeoGreeting](../../src/components/landing/CeoGreeting.astro) · `#from-our-ceo` | 두 인물 사진과 편지의 회전·읽기 흐름 |
| 15 | [EverydayFuture](../../src/components/landing/EverydayFuture.astro) · `#everyday-future` | 일상 사진·영상과 큰 타이포그래피의 비전 장면 |
| 16 | `#faq` · index | 기존 네 질문의 키보드 조작 가능한 disclosure |
| 17 | [FinalExperience](../../src/components/landing/FinalExperience.astro) · `#start-with-baro` | 네 기능 합류 → 앱 → 마지막 메시지와 시작·다시 보기 |
| 18 | `.landing-footer` · index | BARO, 사건 시작과 정책 링크, 기존 하단 문구 |

실제 서비스 시작은 `/new`, 로그인은 `/login`으로 연결한다. 기능별 체험 링크는
`#try-baro`로 이동하면서 올바른 체험 탭을 선택하고 그 내용으로 포커스를 옮긴다.
`baro:demo-feature` 이벤트와 앵커 연결을 함께 보존한다. DemoLab은 로컬 합성 예시이며
실제 사건·모델 API에 연결하는 것은 별도 변경이다.

## 소스 의존성과 스타일 순서

[BaseLayout](../../src/layouts/BaseLayout.astro)은 현재
[global.css](../../src/styles/global.css), [shell.css](../../src/styles/shell.css),
[app-focus.css](../../src/styles/app-focus.css), [design-system.css](../../src/styles/design-system.css)를
가져온다. index는 [landing.css](../../src/styles/landing.css),
[landing-film.css](../../src/styles/landing-film.css),
[landing-refinement.css](../../src/styles/landing-refinement.css)를 가져오고 각 시각 컴포넌트가
자신의 CSS와 스크립트를 추가한다. reset·기본 글꼴·로고 크기에 공통 CSS가 관여하므로
파일명만 분리한 뒤 이 의존성을 제거하면 동등한 화면이라고 볼 수 없다.

| 장면 | 스타일 | 동작 |
| --- | --- | --- |
| 공통 | 위 공통·페이지 CSS | [landing.ts](../../src/client/landing.ts) |
| 탐색 | [landing-navigation.css](../../src/styles/landing-navigation.css) | [landing-navigation.ts](../../src/client/landing-navigation.ts) |
| 첫 화면 | [landing-journey.css](../../src/styles/landing-journey.css) | [landing-journey.ts](../../src/client/landing-journey.ts) |
| 시작 메모 | [landing-origin.css](../../src/styles/landing-origin.css) | [landing-origin.ts](../../src/client/landing-origin.ts) |
| 파란 앱 | [landing-blue-reveal.css](../../src/styles/landing-blue-reveal.css) | [landing-blue-reveal.ts](../../src/client/landing-blue-reveal.ts) |
| 로고 | [landing-logo.css](../../src/styles/landing-logo.css) | [landing-logo.ts](../../src/client/landing-logo.ts) |
| 체험 | [landing-demo.css](../../src/styles/landing-demo.css) | [landing-demo.ts](../../src/client/landing-demo.ts) |
| 걱정 정리 | [landing-clarity.css](../../src/styles/landing-clarity.css) | [landing-clarity.ts](../../src/client/landing-clarity.ts) |
| 휴대전화 | [landing-phone.css](../../src/styles/landing-phone.css) | [landing-phone.ts](../../src/client/landing-phone.ts) |
| 시간 | [landing-time.css](../../src/styles/landing-time.css) | [landing-time.ts](../../src/client/landing-time.ts) |
| 일상 사례 | [landing-stories.css](../../src/styles/landing-stories.css) | 공통 reveal 동작 |
| CEO | [landing-ceo.css](../../src/styles/landing-ceo.css) | [landing-ceo.ts](../../src/client/landing-ceo.ts) |
| 달라지는 일상 | [landing-future.css](../../src/styles/landing-future.css) | [landing-future.ts](../../src/client/landing-future.ts) |
| 마지막 장면 | [landing-finale.css](../../src/styles/landing-finale.css) | [landing-finale.ts](../../src/client/landing-finale.ts) |

로고는 [ui/brand.tsx](../../src/components/ui/brand.tsx)의 SVG와 대문자 `BARO` 조합이며
아이콘은 `lucide-react`의 서버 렌더 결과를 사용한다. 각 랜딩 스크립트는 DOM·CSS 변수·
requestAnimationFrame으로 동작하며 별도 3D 라이브러리나 조회 라이브러리를 요구하지 않는다.
휴대전화는 폭 280px, 비율 `78:163.4:8.75`, 외벽 52면과 렌즈 벽 24면을 구성하는 DOM/CSS
형상이다. 정지 이미지나 기존 영상 파일로 바꾸면 현재 디자인과 달라진다.

루트 랜딩에는 제품 화면용 `data-baro-ui`와 테마 적용이 없다. `startAtTop`의 새 진입·
새로고침 시 hash/scroll 초기화와 이후 같은 페이지 구간 이동은 함께 보존한다.
Zod `jitless` 초기화와 CSP script hash 등록도 [기존 레이아웃](../../src/layouts/BaseLayout.astro)의
독립 실행 계약으로 유지한다.

## 에셋과 시각 기준

| 용도 | 유지할 로컬 에셋·구성 |
| --- | --- |
| 로고·글꼴 | [logo.svg](../../public/brand/logo.svg), [PretendardVariable.woff2](../../public/fonts/PretendardVariable.woff2), [OFL](../../public/fonts/OFL.txt). 가변 굵기 45–920 |
| 현재 hero | [hero-continuous.mp4](../../public/landing/hero-continuous.mp4), [hero-continuous-poster.webp](../../public/landing/hero-continuous-poster.webp). 포스터 1280×720, 모바일 피사체 위치 59% |
| 손글씨 메모 | [origin-notes-clean.webp](../../public/landing/origin-notes-clean.webp), [origin-notes-original.webp](../../public/landing/origin-notes-original.webp). 원본 손글씨와 겹친 crop 유지 |
| 걱정 정리 | [help-clarity.webp](../../public/landing/help-clarity.webp) |
| 시간 | [time-watch.webp](../../public/landing/time-watch.webp), index가 전달하는 초점 `42, 48`. SVG 시계는 미지정 시의 대체 구성 |
| 일상 사례 | [everyday-home.webp](../../public/landing/everyday-home.webp), [everyday-work.webp](../../public/landing/everyday-work.webp), [everyday-cafe.webp](../../public/landing/everyday-cafe.webp) |
| CEO | [ceo-suit.webp](../../public/landing/ceo-suit.webp), [ceo-crenova.webp](../../public/landing/ceo-crenova.webp)와 기존 두 편지·서명 |
| 달라지는 일상 | [future-home.webp](../../public/landing/future-home.webp), [future-work.webp](../../public/landing/future-work.webp), [future-cafe.webp](../../public/landing/future-cafe.webp) |
| 일상 영상 | [future-everyday.mp4](../../public/landing/future-everyday.mp4)와 [포스터](../../public/landing/future-everyday-poster.webp), [future-conversation.mp4](../../public/landing/future-conversation.mp4)와 [포스터](../../public/landing/future-conversation-poster.webp) |

에셋 출처와 최적화 기록은 [asset-provenance.json](../../public/landing/asset-provenance.json)에
있다. `hero-everyday.mp4`, `phone-journey.mp4`와
[BenefitFilm](../../src/components/landing/BenefitFilm.astro)은 현재 index에 연결된 hero가 아니다.
새 이미지·영상 생성은 이식에 필요하지 않다.

기본 화면은 흰색 `#fff`, 본문 `#191f28`, 파랑 `#2364e8`이며 장면별로 `#2869eb`,
`#2865ce` 등을 사용한다. 메모는 `#f6f4ee`, hero는 `#17212e`, 걱정 정리는 `#0b1527`,
마지막 장면은 `#0c192d` 계열이다. 대표 display 굵기는 720–780, 자간은 약
`-0.045em`–`-0.065em`, 줄 높이는 1.18–1.35다. 본문은 16–20px, 줄 높이 1.8–1.85를
중심으로 장면별 규칙이 있다. Hero 제목은 데스크톱
`clamp(48px, min(6.1vw, 10.8svh), 104px)`, 모바일
`clamp(29px, 8.4vw, 50px)`이다. 정확한 계산값은 각 원본 CSS와 기준 캡처로 대조한다.

## 스크롤·영상·반응형 계약

| 장면 | 기본 스크롤 구간과 주요 전환 |
| --- | --- |
| Hero | 330svh, 모바일 290svh. 영상은 연속 재생하고 스크롤은 framing만 변경. 진행률 0–0.18 제목 소멸, 0.42–0.59 포털, 0.55–0.64 앱 등장 후 여섯 메시지 순차 노출 |
| Origin | 265svh, 모바일 245svh. 메모 최대 1.72배 확대·14px blur, 종이에서 파란 도착 화면으로 전환. 역방향 스크롤과 포커스 복귀 유지 |
| Blue | 400svh, 폭 899px 이하 340svh. 파란 원 확대, 작업 공간 등장, 네 기능의 회전·자동 선택과 직접 선택 |
| Logo | 440svh, 폭 899px 이하 360svh. 로고 회전·분리와 기능 타일 선택 |
| Clarity | 310svh, 모바일 290svh. 흩어진 메모가 모인 뒤 사실·자료·질문 카드 전개 |
| Phone | 380svh, 모바일 340svh. 3D 기기 회전·반사·입체 두께와 네 화면 전환 |
| Time | 265svh, 모바일 245svh. 시계 확대·소멸과 파란 wipe, 메시지·세 가지 이점 등장 |
| CEO | 사진·편지 두 면의 180도 전환과 편지 읽기 이동. 실제 편지 높이·viewport·글꼴 로딩에 따라 스크롤 길이 계산 |
| Future | 사진의 상대 이동·확대, 문장 잉크 표시, 노출 중인 영상 재생 |
| Finale | 350svh, 모바일 290svh. 네 기능 합류, 앱 공개, 최종 메시지·시작·다시 보기 |

상단 header는 데스크톱 76px, 모바일 66px이며 여러 sticky 장면의 기준점이다. 상단 탐색
컨테이너는 최대 1240px와 좌우 40px를 사용한다. 주요 분기와 높이 조건을 함께 유지한다.

- 폭 1200px 미만: 왼쪽 chapter rail 숨김. 1023px 이하: 상단 구간 링크 대신 전체 메뉴.
- 일반 모바일 분기: 767px 이하. Blue/Logo의 별도 구성 분기: 899px 이하.
- Hero/Phone 모션: 데스크톱 높이 600px 이상 또는 폭 320–767px·높이 520px 이상.
- Blue/Logo 모션: 데스크톱 폭 900px·높이 720px 이상 또는 폭 320–899px·높이 520px 이상.
- Clarity/Finale 모션: 데스크톱 높이 640px 이상 또는 폭 320–767px·높이 520px 이상.
- Origin/Time 모션: 높이 560px 이상. CSS의 추가 짧은 화면 분기도 유지한다.

`prefers-reduced-motion`에서는 정지한 읽기 구성을 제공하고, JS가 없어도 사진·문안·링크가
남아야 한다. 영상은 노출·탭 가시성·방문자 일시정지·데이터 절약 설정을 따른다. Hero의
`src`는 필요한 시점에 연결하며, 데이터 절약 상태에서는 방문자의 명시적 재생 전 다운로드를
시작하지 않는다. Pause 상태를 스크롤이나 지연된 play 응답이 덮지 않아야 한다. 키보드 탭·
모바일 메뉴·Escape·포커스 복귀, 화면 크기 변경과 역방향 스크롤도 같은 계약이다.

## 동등한 디자인 이식과 캡처 계획

후속 이식은 기준 소스와 에셋을 먼저 고정하고, 새 구조에서 같은 DOM·스타일·모션을 재현한
뒤 단계별로 비교한다. 공통 reset·브랜드 스타일을 분리할 때는 기존 계산값을 보존한다.
구조 개선과 디자인 변경을 하나의 동등성 검증으로 처리하지 않는다. 이식이 끝날 때까지
현재 `/`를 기준으로 유지하고, 전환 PR에서 동일 디자인과 동작을 확인한다.

[landing.e2e.ts](../../tests/browser/landing.e2e.ts)는 현재 구간·기하·상호작용 검증의 기준이다.
현재 랜딩 전체의 시각 동등성을 증명하는 추적된 전용 이미지 기준은 이번 조사에서 찾지
못했으므로, 아래 캡처는 새로 수행할 계획이다.

| 대상 | 기준 캡처·비교 위치 |
| --- | --- |
| 기본 화면 | 1440×900, 390×844에서 전체 섹션 순서와 첫 화면 |
| Hero | 진행률 0, 0.32, 0.70, 0.96 |
| Blue | 0, 0.40, 0.57와 네 기능 탭·체험 목적지 |
| Origin | 0, 0.43, 0.56과 0으로 되감기 |
| Time | 0, 0.42, 0.56, 0.99 |
| Phone·Clarity | Phone 0.12·0.995, Clarity 0.97 |
| Finale | 0, 0.26, 0.74, 0.99와 다시 보기 |
| 경계 화면 | 폭 320·767·768·899·900, 640×450의 짧은 화면, reduced motion |

진행률은 테스트의 `scrollScene`처럼 실제 장면 높이·pin 높이·sticky top으로 계산한다.
글꼴·이미지 로딩과 레이아웃이 안정된 뒤 캡처하며, 영상 비교는 동일한 포스터 또는 정지
프레임·재생 시각·Pause 상태로 맞춘다. 비교 기록에는 SHA·뷰포트·모션/데이터 절약 설정·
장면 진행률을 남긴다. 시각 비교와 별도로 원본 영상, 모든 사진, 링크·체험·키보드·
역스크롤·가로 넘침을 확인한다. Codex 앱 직접 제어는 도구 정책상 거절되었으므로 그 경로를
우회하지 않고 허용된 브라우저에서 기준 화면을 확인한다.
