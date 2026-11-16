# 제품 UI 공통 기반

기존 업무 화면과 분리한 새 React island 기반이다. 현재 production 진입점은 이 모듈을 import하지 않는다.
최종 화면 배치는 [화면 이관 계획](./WEB-UI-REBUILD-PLAN.md)의 레퍼런스 확인 뒤 진행한다.

## 구성

| 파일 | 책임 |
| --- | --- |
| [utils](../../src/product-ui/utils.ts) | `clsx` + `tailwind-merge`를 조합한 `cn` |
| [Button](../../src/product-ui/Button.tsx) | CVA variant/size, Headless Button, 네이티브 링크를 유지하는 ButtonLink |
| [Field](../../src/product-ui/Field.tsx) | Headless Field·Label·Description·Input·Textarea, 네이티브 폼 속성/이벤트, 오류·설명 연결 |
| [Dialog](../../src/product-ui/Dialog.tsx) | Headless Dialog·Backdrop·Panel·Title, controlled 열림/닫힘과 포털 테마 |
| [tokens](../../src/product-ui/tokens.css) | `[data-product-ui]`에 한정한 라이트/다크 CSS 변수 |
| [Provider](../../src/product-ui/Provider.tsx) | island별 Zustand store와 QueryClient 생성·공급 |
| [Theme](../../src/product-ui/Theme.tsx) | UI 상태의 테마 선택, hydration 뒤 시스템 테마 구독, 포털 context |
| [state](../../src/product-ui/state.ts) | Zod로 제한한 표시 상태와 동작. 사건·계정·토큰·본문 저장 금지 |
| [queries](../../src/product-ui/queries.ts) | 격리된 QueryClient factory와 owner/generation/case/resource 키 |

현재 primitive 색상은 기존 BARO 브랜드의 공통 기반이다. Codex 앱을 직접 확인한 최종 시각 명세가 아니다.
상태를 공유해야 하는 화면은 하나의 `ProductUIProvider` 안에서 구성한다. 별도 island에는 별도 인스턴스가 생긴다.
이 provider는 기존 인증/session lifecycle이나 업무 API를 대신하지 않는다.

## 사용 규칙

- 컴포넌트 스타일은 Tailwind utility, variant는 CVA, 조건부 class는 `cn`으로 구성한다.
- 일반 버튼의 기본 `type`은 `button`이다. 제출 동작은 `type="submit"`을 명시하고 네이티브 form handler를 사용한다.
- 이동은 `ButtonLink`의 실제 `href`로 표현한다. disabled 링크와 실행 가능한 URL scheme에는 목적지를 부여하지 않는다.
- 입력은 `InputField`/`TextareaField`에 label을 제공한다. 추가 설명과 오류는 실제 control의 `aria-describedby`에 연결된다.
- `onChange`에는 네이티브 React 이벤트가 그대로 전달된다. 가짜 이벤트 객체나 DOM query로 값을 대체하지 않는다.
- `Dialog`는 `open`/`onClose`를 소유한 부모와 함께 사용한다. 확인/저장/삭제 의미는 업무 모듈이 결정한다.
- 상태 초기값과 선택적 preference는 Zod를 통과한다. 브라우저 저장소를 읽거나 쓰지 않는다.
- 새 query key는 캐시 분리용이다. 권한 검사는 기존 session·expectedOwner·서버 경계에서 별도로 유지한다.

## SSR과 CSP

서버와 첫 client render는 동일한 라이트/system snapshot을 사용한다. 시스템 다크 테마는 hydration 뒤 반영된다.
`ProductTheme`는 document나 body의 전역 테마를 바꾸지 않으며 dialog 포털에는 같은 resolved theme를 전달한다.

설치된 Headless UI의 Field/portal은 mount 전 숨김 sentinel에 inline style을 생성한다.
기존 style-attribute CSP를 유지하기 위해 Field는 SSR에서 native label/control/description frame을 제공하고 mount 뒤 Headless frame을 사용한다.
Input/Textarea adapter는 Headless UI가 병합하는 ARIA에서 호출자의 이름·설명·invalid 상태를 명시적으로 보존한다.
Dialog는 mount 뒤 렌더링하므로 JS가 없는 초기 응답에는 열린 dialog 내용을 제공하지 않는다.
필수 초기 안내를 dialog 하나에만 넣는 화면은 별도의 SSR 본문을 마련해야 한다.

## 독립 검토

`PUBLIC_API_MODE=mock BARO_UI_TEST_FIXTURE=true bun run dev --host 127.0.0.1 --port 4337`로 실행한 뒤
`/__product-ui`를 연다. 이 경로는 기존 synthetic fixture 플래그에서만 주입하며 preview/production 플래그 사용은 기존 설정이 거부한다.
예시 폼 확인은 메모리 안의 표시 동작이다. 실제 사건 API·동의·생성·저장에는 연결하지 않는다.

| 명령 | 확인 범위 |
| --- | --- |
| `bun test tests/product-ui-` | SSR·상태/캐시 분리·초기 단계 경계의 회귀 |
| `bun run product-ui:check` | origin/main 대비 초기 격리 기반의 변경 경계·import·표시 상태·token CSS |
| `bun run product-ui:measure` | 합성 HTTP와 로컬 D1 adapter의 재현 가능한 호출 수. 실제 서비스 지연 제외 |
| `bun run validate:quick` | 기존 필수 검사와 새 product-ui 테스트 |
| `bun run validate:build` | production 번들·fixture 제외·Workers dry-run |

`product-ui:check`는 이 초기 격리 PR의 인수 명령이다. 이후 승인된 실제 화면 이관을 막는 영구 범위 정책으로 사용하지 않는다.
호출 수의 기준과 후속 최적화 인수는 [조회 성능 계획](./WEB-QUERY-PERFORMANCE-PLAN.md)을 따른다.
