# 공통 UI 기반 브라우저 검토

2026-11-16, `codex/baro-ui-foundation`의 격리된 `__product-ui` fixture를 Computer Use의 in-app browser로 확인했다.
비교 기준은 `origin/main`의 `b54566f32d2d81f9c08ebc26acac0209623d3af1`이다.
파일은 현재 BARO와 공통 컴포넌트의 합성 예시 화면이며 Codex 앱 캡처나 최종 제품 디자인이 아니다.
Codex 앱 직접 접근은 도구 보안 정책으로 차단된 상태다.

실행은 `PUBLIC_API_MODE=mock BARO_UI_TEST_FIXTURE=true bun run dev --host 127.0.0.1 --port 4337`을 사용했다.
검토 뒤 해당 서버를 중지하고 임시 viewport를 해제했다. 실제 사건·계정·OAuth·공급자·원격 DB는 사용하지 않았다.

## 확인 결과

| 상황 | 관찰한 결과 |
| --- | --- |
| 공통 스타일 | 기존 BaseLayout의 unlayered 전역 규칙이 Tailwind를 덮어쓰는 현상을 발견. 검토 페이지를 별도 HTML/Tailwind entry로 분리한 뒤 버튼 높이 44px·radius 12px 확인 |
| 입력 오류 | 빈 제목 제출 시 오류와 `aria-invalid`, control의 description/error ID 연결 확인 |
| 네이티브 폼 | 제목에서 Enter로 제출해 모달 진입. 실제 input/textarea 이벤트로 입력값 유지 |
| 포커스 | 마지막 확인 버튼에서 Tab으로 닫기 버튼에 순환. Escape 뒤 제출 버튼으로 복귀 |
| 확인 | 확인 버튼 뒤 모달 닫힘과 로컬 status 표시. 서버 저장은 실행하지 않음 |
| 테마 | 라이트/다크 선택 표시와 모달 portal의 `data-theme=dark` 확인 |
| 탐색 | 모바일 탐색 접기/펼치기, 대화→자료 선택에 따른 표시 상태 변경 확인 |
| 390×844 | document scrollWidth 390. 표시된 링크·버튼·input 높이 44px, textarea 112px |
| 320×740 긴 입력 | 공백 없는 제목 40자·설명 500자에서 모달 내부 가로 넘침 발견. `min-w-0`와 `overflow-wrap:anywhere` 적용 뒤 panel 폭 288px·scrollWidth 286px, document 폭 320px 확인 |
| 콘솔 | 최종 검토 페이지에서 수집한 error 로그 없음. development 관찰이며 production CSP 브라우저 인수와 구분 |
| 기존 랜딩 | 검토 페이지의 실제 링크로 이동해 기존 hero·브랜드·탐색이 유지됨을 확인. 해당 경로·에셋·공유 runtime source diff는 별도 경계 검사로 확인 |

## 증거 파일

- [desktop-light.jpg](./desktop-light.jpg): 1440×900, 초기 입력 상태의 라이트 기반.
- [desktop-dark.jpg](./desktop-dark.jpg): 1440×900, 합성 입력이 있는 다크 기반.
- [dialog-dark.jpg](./dialog-dark.jpg): 1440×900, 입력 확인과 포털의 다크 테마.
- [mobile-light-390.jpg](./mobile-light-390.jpg): viewport 390×844의 full-page 캡처. 실제 이미지 높이는 1133px.
- [dialog-long-320.jpg](./dialog-long-320.jpg), [측정 JSON](./dialog-long-320.json): 긴 공백 없는 입력의 수정 후 줄바꿈과 치수.
- [landing-preserved-desktop.jpg](./landing-preserved-desktop.jpg): 기존 랜딩 hero의 추가 관찰. 연속 영상의 한 프레임이므로 픽셀 동일성·전체 모션 인수를 뜻하지 않음.

기존 랜딩 전체 구조의 기준은 [이전 원본 조사](../ui-foundation-baseline/README.md)와 [랜딩 보존 계약](../../development/WEB-LANDING-PRESERVATION.md)을 따른다.
이 검토는 새 업무 UI의 기능 이관·실제 API 속도 개선·최종 Codex 시각 일치를 완료했다는 증거가 아니다.
