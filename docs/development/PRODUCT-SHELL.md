# 제품 shell과 시작 화면 이관

## 기준과 적용 범위

기준은 PR #810의 `1f8c70dd2d6cccd95e067e0a5b0fc770cd7bf283`이다.
기반 PR은 변경하지 않고 별도 `codex/baro-workspace-shell` 브랜치에서 실제 Astro 제품 경로를 연결한다.
API·DB·공유 클라이언트·모바일·랜딩은 이 단계에서 변경하지 않는다. 병합·배포 권한과 구현 준비는 구분한다.

공식 보조 reference는 [OpenAI의 Codex 앱 소개](https://openai.com/ko-KR/index/introducing-the-codex-app/) 영상이다.
2026-11-16 브라우저에서 2026년 2월 공개 영상을 재생해 sidebar·넓은 본문·composer 장면을 확인했다.
이후 같은 날 사용자가 “공식 공개 Codex 화면을 참고해 진행”을 선택해 이 보조 reference 사용을 확인했다.
이전 native 접근 거부를 우회하지 않았으며 최신 설치 앱을 직접 확인했다는 의미가 아니다.
공식 영상의 화면은 제품 asset으로 복제하지 않는다. [관찰 화면](../quality/product-shell/reference-codex-public.jpg)은 출처·구조 검토용 증거다.

| 관찰·사용자 요구 | BARO에 적용할 구성 |
| --- | --- |
| 옅은 sidebar와 단순한 행, 넓은 읽기 영역 | 272px 탐색, 80px 접힌 rail, 기존 사건 목록과 계정 동작 유지 |
| 흰 본문과 하단 composer, 최소한의 테두리 | 새 사건 입력의 중심 본문·명확한 입장 선택·예시·네이티브 textarea와 44px 전송 동작 |
| 사용자 선택: 대화 중심 + 사건별 자료·리포트 | 대화 본문과 기존 자료 참고 패널, 실제 판례/자료/리포트 경로를 보존 |
| 기존 BARO brand | 기존 로고·Pretendard·한국어 안내 유지. 새 chrome은 중립색 중심, 브랜드 파란색은 로고·링크 accent에 유지 |
| 모바일과 키보드 | 1200px 미만에서 56px header와 Headless 탐색 drawer, 44px 조작 영역, 포커스 복귀·긴 제목 줄바꿈 |

## 실제 변경 경계

- `ProductLayout.astro`는 제품 전용 HTML/CSP·Zod jitless·theme bootstrap·focus 설치·기존 Experience를 유지한다.
  기존 `BaseLayout.astro`와 그 랜딩 import는 바꾸지 않는다.
- `CaseWorkbenchLayout`·`AppLayout`은 새로운 제품 레이아웃을 사용한다. `data-product-shell="v2"`로 현재 단계를 식별한다.
  기존 `app-frame`, `baro-workbench`, `app-surface`, `main#main-content`와 업무 content class는 호환 경계로 유지한다.
- 공통 navigation과 새 사건 입력의 시각 tree는 Tailwind·새 primitive로 재구성한다.
  기존 entry의 props/exports를 보존하고 controller로 옮긴 기존 session·owner·작업 잠금·revision·복구 로직을 유지한다.
- `GlobalProductTheme`는 기존 `baro-theme`와 `subscribeTheme`의 resolved palette를 읽어 portal context로 전달한다.
  Astro sibling island끼리 React context를 공유한다고 가정하거나 별도 preference를 덮어쓰지 않는다.
- `product.css`는 제품 경로에서 기존 CSS를 legacy layer로 유지하고 새 utility layer가 새 시각 tree를 제어하도록 한다.
  전역 파일 자체의 디자인은 바꾸지 않는다. 오래된 업무 CSS를 무조건 삭제하거나 모든 클래스에 `!important`를 붙이지 않는다.
- `CaseWorkspaceFrame`의 같은 portal subtree·nested dialog·미저장 편집·visual viewport·외부 reset 처리와 모든 기존 업무 island는 보존한다.
  새 generic Dialog로 참고 패널을 대체하지 않는다.

대화·자료·질문·요약·판례·리포트·후속 해결·설정의 상세 업무 시각 tree는 [전체 기능 보존표](./WEB-UI-REBUILD-PLAN.md)의 후속 이관 범위다.
shell이 연결됐다는 이유로 해당 업무 모듈의 재작성·전체 인수가 끝났다고 표시하지 않는다.

## 검증과 합성 준비 경로

`/__product-shell`은 기존 `BARO_UI_TEST_FIXTURE=true`에서만 주입하는 준비 화면이다.
`PUBLIC_API_MODE=mock`에서 사용자가 누른 버튼으로 로컬 합성 계정·사건을 준비하고 실제 `/new`, `/cases/shell-app-case`, `/settings`로 이동한다.
실제 로그인·동의 제출·AI·원격 DB 성공으로 표현하지 않는다. preview/production은 기존 설정에 따라 synthetic fixture 플래그를 거부한다.

빌드된 Worker의 `/new` 서버 인증 경계는 합성 브라우저 저장소를 인증으로 취급하지 않는다.
따라서 built CSP에서는 테스트 전용 `/__product-shell/input`에 같은 `CaseWorkbenchLayout`·`CaseInput requireSession`을 렌더링해 확인한다.
준비 화면의 “빌드 CSP 입력 확인” 링크로 이동한다. 해당 helper는 mock 외에 404를 반환하며 배포 빌드에는 두 경로 모두 포함되지 않는다.
이 확인을 실제 `/new`의 인증 성공이나 OAuth 인수로 확대하지 않는다.

수정한 기능의 SSR·controller/보존 검사와 기존 필수 `validate:quick`, `validate:build`를 실행한다.
실제 브라우저 확인은 로컬 합성 모드의 Astro 경로에서 수행하며 개발 서버가 실행 중일 때 빌드·의존성 변경을 병행하지 않는다.
새 단계의 `product-ui:check`/`product-shell:check`는 초기 기반 대비 허용된 프론트 변경과 랜딩·backend·모바일 보존을 확인한다.
이 검사 통과는 기능·CSP·포커스·반응형 인수를 대신하지 않는다.

브라우저에서는 다음을 확인한다.

- 320/390/768/1024/1440px, 라이트/다크, 1200px 경계와 접힌 rail.
- 실제 `/new`의 한글·길이·입장 선택·예시·Enter/조합·중복 제출과 생성 후 질문 진입.
- 최근 사건 검색·미완료 목록·제목 변경·취소·충돌·소유자 변경, 삭제 확인과 진행 중 닫기 제한.
- 대화 초안과 자료 편집을 유지한 참고 패널 이동·닫기·viewport 전환, 별도 판례/리포트/설정 URL.
- 기존 랜딩의 같은 장면과 source/asset 보존, built CSP·production 번들의 fixture 제외.

관찰과 남은 한계는 [검토 기록](../quality/product-shell/README.md)에 구분해 남긴다.
