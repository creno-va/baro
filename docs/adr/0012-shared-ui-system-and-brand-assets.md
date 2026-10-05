# ADR-0012: 공통 UI 시스템·한글 폰트·브랜드 자산

- Status: Accepted
- Date: 2026-10-06
- Owners: Product, Engineering
- Decision scope: User-approved v2 target; implementation, live capability and public approval remain unverified
- Partial supersession: ADR-0002의 Astro·React islands·Tailwind 선택을 유지하고 사용자 지시의 shadcn·blue·Lucide·Pretendard·sharedSVG를 구체화한다.

## 맥락

기존 적은 화면과 직접 지정한 스타일은 새 공개탐색·사건 workspace·변호사 portal·운영심사에 일관된 기능/접근성을 제공하기 어렵다. logo를 곳곳에 복제하면 교체가 누락된다.

## 결정

1. shadcn 기반 React 컴포넌트와 semantic CSS tokens로 공통 버튼/입력/dialog/tabs/navigation/상태 UI를 구성하고 Astro 콘텐츠 화면과 결합한다.
2. primary는 blue, 초기후보 #2563EB 이며 neutral 표면·semanticstatus·typography·spacing·focus를 중앙관리한다. 실제 대비 검사 후 token을 조정할 수 있다.
3. Lucide 아이콘을 공통 size/stroke/aria 규칙으로 사용한다. Pretendard를 한글 기본으로 self-host 하고 배포 font 파일·라이선스를 함께 관리한다.
4. public/brand/logo.svg 하나를 공통 Brand가 참조하며 inline 복제하지 않는다. SVG 교체와 cache 갱신이 모든사용처에 반영되어야 한다.
5. 페이지 추가/삭제/재구성은 자유롭고 사건 workspace는 context를 유지한다. 구현정보가 아니라 사용자 작업으로 navigation을 이름붙인다.
6. 320px·desktop·200%·keyboard·screenreader 명·touch44px·reduced motion·contrast를 검증한다. loading/empty/error/quota/role/pending 상태도 실제 컴포넌트로 구현한다.
7. 실제 browser의 시각확인과 built Worker hash CSP 에서 hydration/dialog/upload/chat/font/Turnstile을 검증한다. dev screenshot 이나 axe 만으로 완료하지 않는다.

## 고려한 대안

새 framework로 이전하면 기존 인증/Worker/배포를 재구축해야 한다. ad-hoc 스타일·logo 복제·placeholder 페이지는 전체기능시연 기준에 맞지 않는다.

## 결과

공통 component ownership·asset/font 크기·CSP·RTL이 아닌 한국어 가독성·responsive test가 필요하다. 자동생성 컴포넌트도 내부 계약과 실제 시각 QA를 거친다.

## 후속 결정 또는 미결 사항

각 라이브러리의 정확한 버전은 Bun lock 과 현재 Astro/React/Tailwind 호환 검증에서 고정한다. 디자인토큰/대표화면은 실제구현 후 UI 증거로 확인한다.

## 참고

- [UX](../product/UX-SPEC.md)
- [shadcn Astro 공식 설치](https://ui.shadcn.com/docs/installation/astro)
- [Lucide React](https://lucide.dev/guide/react)
- [Pretendard 공식 저장소](https://github.com/orioncactus/pretendard)
