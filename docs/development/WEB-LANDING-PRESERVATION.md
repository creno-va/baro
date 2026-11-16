# 웹 랜딩 디자인 보존 계약

- 기준일: 2026-11-16 KST
- 기준 소스: `main b54566f32d2d81f9c08ebc26acac0209623d3af1`
- 대상: [랜딩 진입점](../../src/pages/index.astro)의 `/` 화면과 직접 연결된 체험·탐색 동작

첫 기본 UI PR의 원칙은 기존 랜딩 디자인·동작의 보존이었다. 후속 이식도 같은 문안·순서·
에셋·모션·반응형을 재현한다. 현재 진입점은 새 Astro/React/Tailwind 구현을 사용하며,
원본 디자인 계약은 아래 수치와 앵커로 유지한다. 실제 비교 범위와 한계는
[랜딩 이식 검증 기록](../quality/landing-port/README.md)에 구분해 기록한다. 배포 완료 기록은 아니다.
원본 진입점은 [고정 SHA의 index](https://github.com/creno-va/baro/blob/b54566f32d2d81f9c08ebc26acac0209623d3af1/src/pages/index.astro)에서 확인한다.

## 화면 순서와 연결

아래 순서는 [LandingPage](../../src/product-ui/landing/LandingPage.astro)의 실제 렌더 순서다. 각 컴포넌트의
문안·줄바꿈·가상 화면·CTA를 함께 보존한다. 상단 메뉴, 왼쪽 구간 탐색과 체험 링크가
참조하는 앵커 ID도 유지한다.

| 순서 | 소스·앵커 | 디자인과 동작 |
| --- | --- | --- |
| 1 | [LandingNavigation](../../src/product-ui/landing/LandingNavigation.tsx) | 상단 로고·구간 링크·로그인, 모바일 전체 메뉴, 구간 진행 표시 |
| 2 | [HeroScene](../../src/product-ui/landing/scenes/HeroScene.tsx) | 일상 영상 → 파란 포털 → 휴대전화 대화 예시. 제목은 “막막했던 법률 문제, 이제 정리부터 가볍게.” |
| 3 | `#how-it-works` · LandingPage | 세 줄 소개와 이야기·정리·준비 순서 |
| 4 | [OriginScene](../../src/product-ui/landing/scenes/OriginScene.tsx) · `#our-beginning` | 손글씨 메모의 종이색 장면에서 BARO 도착 화면으로 전환 |
| 5 | [BlueScene](../../src/product-ui/landing/scenes/BlueScene.tsx) · `#blue-app-reveal` | 작은 파란 원이 작업 공간으로 확장. 대화·자료·타임라인·리포트 네 기능 선택 |
| 6 | [LogoScene](../../src/product-ui/landing/scenes/LogoScene.tsx) · `#logo-experience` | 로고와 기능 타일의 회전·분리, 기능별 설명과 체험 연결 |
| 7 | [DemoLab](../../src/product-ui/landing/DemoLab.tsx) · `#try-baro` | 대여금·보증금·급여의 로컬 예시. 대화·자료·타임라인·리포트 체험 |
| 8 | [ClarityScene](../../src/product-ui/landing/scenes/ClarityScene.tsx) · `#clarity` | 어두운 배경의 흩어진 걱정을 사실·자료·질문으로 모으는 장면 |
| 9 | [PhoneScene](../../src/product-ui/landing/scenes/PhoneScene.tsx) · `#phone-story` | 3D 휴대전화와 이야기·자료·타임라인·상담 준비의 네 장면 |
| 10 | [TimeScene](../../src/product-ui/landing/scenes/TimeScene.tsx) · `#time-experience` | 시계 사진 확대·소멸, 파란 전환과 시간 관련 메시지 |
| 11 | [EverydayScene](../../src/product-ui/landing/scenes/EverydayScene.tsx) · `#everyday` | 집·일터·카페 사진과 세 가지 일상 이야기 |
| 12 | `.landing-lawyers` · LandingPage | 사건 준비 중 리포트 활용 안내와 범주 예시. 현재 변호사 디렉터리 진입 화면이 아님 |
| 13 | `#principles` · LandingPage | 사실·추정 구분, 공식 근거, 사용자 판단의 세 원칙 |
| 14 | [CeoScene](../../src/product-ui/landing/scenes/CeoScene.tsx) · `#from-our-ceo` | 두 인물 사진과 편지의 회전·읽기 흐름 |
| 15 | [FutureScene](../../src/product-ui/landing/scenes/FutureScene.tsx) · `#everyday-future` | 일상 사진·영상과 큰 타이포그래피의 비전 장면 |
| 16 | `#faq` · LandingPage | 기존 네 질문의 키보드 조작 가능한 disclosure |
| 17 | [FinaleScene](../../src/product-ui/landing/scenes/FinaleScene.tsx) · `#start-with-baro` | 네 기능 합류 → 앱 → 마지막 메시지와 시작·다시 보기 |
| 18 | `.landing-footer` · LandingPage | BARO, 사건 시작과 정책 링크, 기존 하단 문구 |

실제 서비스 시작은 `/new`, 로그인은 `/login`으로 연결한다. 기능별 체험 링크는
`#try-baro`로 이동하면서 올바른 체험 탭을 선택하고 그 내용으로 포커스를 옮긴다.
`baro:demo-feature` 이벤트와 앵커 연결을 함께 보존한다. DemoLab은 로컬 합성 예시이며
실제 사건·모델 API에 연결하는 것은 별도 변경이다.

## 소스 의존성과 스타일 순서

[LandingLayout](../../src/layouts/LandingLayout.astro)은 제품 테마와 독립된
[랜딩 Tailwind 진입점](../../src/product-ui/landing/styles/index.css)만 가져온다.
[base.css](../../src/product-ui/landing/styles/base.css)는 원본 reset·Pretendard·색상·로고 기본값을
유지한다. 정적인 배치·타이포 선언은 [scene-classes](../../src/product-ui/landing/scene-classes.ts)의
명시적 Tailwind 유틸리티로 옮기고, 반응형·입체 형상·스크롤 수치는 장면 CSS에 유지한다.
공통 페이지와 refinement 규칙은 장면 스타일 뒤에서 원본 캐스케이드를 보존한다.

원본 공유 의존성은 [고정 SHA의 BaseLayout](https://github.com/creno-va/baro/blob/b54566f32d2d81f9c08ebc26acac0209623d3af1/src/layouts/BaseLayout.astro)과
[당시 스타일](https://github.com/creno-va/baro/tree/b54566f32d2d81f9c08ebc26acac0209623d3af1/src/styles)에 보존한다.
새 랜딩은 이 구 시각 모듈들을 production import하지 않는다.

| 장면 | 스타일 | 동작 |
| --- | --- | --- |
| 공통 | [base](../../src/product-ui/landing/styles/base.css), [landing](../../src/product-ui/landing/styles/landing.css), [refinement](../../src/product-ui/landing/styles/refinement.css) | [motion/index](../../src/product-ui/landing/motion/index.ts) |
| 탐색 | [navigation](../../src/product-ui/landing/styles/navigation.css) | [LandingNavigation](../../src/product-ui/landing/LandingNavigation.tsx): Headless Dialog, mount 이후 구간 진행 표시 |
| 첫 화면 | [journey](../../src/product-ui/landing/styles/journey.css) | [journey](../../src/product-ui/landing/motion/journey.ts) |
| 시작 메모 | [origin](../../src/product-ui/landing/styles/origin.css) | [origin](../../src/product-ui/landing/motion/origin.ts) |
| 파란 앱 | [blue](../../src/product-ui/landing/styles/blue.css) | [blue](../../src/product-ui/landing/motion/blue.ts) |
| 로고 | [logo](../../src/product-ui/landing/styles/logo.css) | [logo](../../src/product-ui/landing/motion/logo.ts) |
| 체험 | [demo](../../src/product-ui/landing/styles/demo.css) | [DemoLab](../../src/product-ui/landing/DemoLab.tsx), [합성 예시](../../src/product-ui/landing/demo-content.ts) |
| 걱정 정리 | [clarity](../../src/product-ui/landing/styles/clarity.css) | [clarity](../../src/product-ui/landing/motion/clarity.ts) |
| 휴대전화 | [phone](../../src/product-ui/landing/styles/phone.css) | [phone](../../src/product-ui/landing/motion/phone.ts) |
| 시간 | [time](../../src/product-ui/landing/styles/time.css) | [time](../../src/product-ui/landing/motion/time.ts) |
| 일상 사례 | [stories](../../src/product-ui/landing/styles/stories.css) | 공통 reveal 동작 |
| CEO | [ceo](../../src/product-ui/landing/styles/ceo.css) | [ceo](../../src/product-ui/landing/motion/ceo.ts) |
| 달라지는 일상 | [future](../../src/product-ui/landing/styles/future.css) | [future](../../src/product-ui/landing/motion/future.ts) |
| 마지막 장면 | [finale](../../src/product-ui/landing/styles/finale.css) | [finale](../../src/product-ui/landing/motion/finale.ts) |

로고는 [LandingBrand](../../src/product-ui/landing/LandingBrand.tsx)의 SVG와 대문자 `BARO` 조합이며
아이콘은 `lucide-react`의 서버 렌더 결과를 사용한다. 탐색과 로컬 체험은 React/Headless UI가 소유한다. 장면 모션은 DOM·CSS 변수·
requestAnimationFrame으로 동작하며 별도 3D 라이브러리나 조회 라이브러리를 요구하지 않는다.
휴대전화는 폭 280px, 비율 `78:163.4:8.75`, 외벽 52면과 렌즈 벽 24면을 구성하는 DOM/CSS
형상이다. 정지 이미지나 기존 영상 파일로 바꾸면 현재 디자인과 달라진다.

루트 랜딩에는 제품 화면용 `data-baro-ui`와 테마 적용이 없다. `startAtTop`의 새 진입·
새로고침 시 hash/scroll 초기화와 이후 같은 페이지 구간 이동은 함께 보존한다.
Zod `jitless` 초기화와 CSP script hash 등록도 [랜딩 레이아웃](../../src/layouts/LandingLayout.astro)의
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
[BenefitFilm](https://github.com/creno-va/baro/blob/b54566f32d2d81f9c08ebc26acac0209623d3af1/src/components/landing/BenefitFilm.astro)은 현재 index에 연결된 hero가 아니다.
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
초기 조사에서는 전체 랜딩의 전용 이미지 기준을 찾지 못했다. 이후 원본 기준 캡처와 새 구현의
[표본 비교](../quality/landing-port/README.md)를 추가했다. 아래 표는 기존 자동 검증의 진행률·경계 계약이며,
표본 스크린샷을 모든 모션 프레임의 동등성 증거로 확대하지 않는다.

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
