# 공통 앱 shell 검증 · BARO-UI-01 / #752

2026-11-08 KST. 실제 UI baseline은 `b643069bf9e923e50441c06c22930e9cd646e123`이다.
변경된 shell은 AppLayout에서만 적용한다. 랜딩·로그인·BaseLayout/global.css/shell.css와
웹/API/native 계약·자료·리포트 업무 로직은 변경하지 않는다.

## 화면

| 화면 | 이전 | 이후 |
| --- | --- | --- |
| 데스크톱 대화 | [기준](chat-before-desktop.png) | [작은 사건 헤더·도구 메뉴](chat-after-desktop.png) |
| 모바일 대화 | [기준](chat-before-mobile.png) | [작은 헤더·메뉴](chat-after-mobile.png) |
| 새 사건 | [기준](new-before-desktop.png) | [공통 앱 표면](new-after-desktop.png) |
| 공통 frame | 해당 없음 | [데스크톱](frame-panel-desktop.png), [모바일 overlay](frame-panel-mobile.png) |

대화/새 사건은 실제 Astro 제품 client+합성 API다. 공통 frame 캡처는 **독립 합성 shell fixture**이며
자료 기능 완료 화면이 아니다. 실제 자료의 교정·업로드·리포트 상태 연결은02가 이 선행 PR을
CI 성공·main 병합 뒤 소비하여 검증한다. 리포트 document/목차·본문·저장은03이 소비한다.

## 실행 결과

- 고정 Bun1.4.0 `bun ci`: PASS, 의존성/lock 변경0.
- `bun run validate:quick`: PASS. 문서·경계·공급망 attestation·lint·웹/도구/native 타입 및 기존 선택 회귀.
- `bun run validate:build`: PASS. production build·bundle·Worker dry-run·실제 local workerd login HTML.
- 독립 shell16/16:320/390/768/1024/1440px, 긴 제목·한글·panel 초안/선택 유지, resize·포커스 복귀,
  nested dialog Escape/Tab trap, 역할·설정·rename/CAS 충돌·삭제 취소·owner 변경,
  로딩/실패/빈 목록/재시도,200% zoom·axe·문서 스크롤·visualViewport 축소.
  00 리뷰의 초기 열린 desktop 패널이 일시 modal로 열리는 회귀를 RED로 재현한 뒤, 첫 동기화부터
  실제 matchMedia mode를 사용하도록 수정했다. desktop showModal0회/중앙 초기초점 유지와 mobile
  showModal1회/정상 패널 초점의2개 초기 열림 회귀도 통과했다.
- 실제 Astro5/5:5폭×새 사건/대화/설정/변호사 찾기 캡처, legacy files/timeline/actions/precedents/reports
  직접 URL,6개 가로 탭 없음, 사건 도구 링크의 hit test와 실제 이동/대화 복귀.
- 기존 shell-integration 세션 회귀6/6:로그인·동의·로그아웃, 다른 탭 logout, 만료·늦은 응답,
  logout 실패·알림 storage 실패. 기존 assertion 변경0.
- 공개 시각4/4:390/1440px 랜딩/로그인을 기준 SHA의 별도4313 서버와 대조. PNG를 raw pixel로
  디코딩한 결과 동일(차이0). 공개 소스·스타일 파일도 변경0.
- 실제 CUA:합성 로그인·동의→새 사건, sidebar 접기/펼치기·최근 사건 drawer·닫기/포커스 복귀 확인.
  00은 실제 합성 intake→요약→대화→도구→타임라인 추가/저장을 확인했고, 메뉴 stacking finding의
  수정 뒤 suggestion chip 위 메뉴 표시와 링크 선택 성공을 재확인했다.

## 재현

컴포넌트 계약과 실행 명령은 [workspace-frame.md](../../../src/components/ui/workspace-frame.md).
기본 full-browser는 같은 basename config를 자동 수집한다. 정확 baseline 공개 픽셀 비교는
`app-workspace-public.evidence.ts`의 opt-in 로컬 증거이며 baseline URL 미지정 시 명시적으로
skip한다. `app-workspace-app.config.ts`만 이 파일을 선택하므로 기본 서버로 잘못 실행하지 않는다.

로컬 환경은 /private/tmp의 공식 Bun1.4.0·Node24.11.0을 사용했다. 시스템 Bun1.3.14는 lock v3를
읽지 못했고, Bun 직접 Astro 실행은 miniflare/fsevents 오류가 있어 지원 Node로 실행했다.
Mac realpath 차이 회귀는 `TMPDIR=/private/tmp`로 재현 환경을 맞췄다. 제품/lock/assertion 우회는 없다.
서버4311/독립 fixture4312/정확 baseline4313은 각각 로컬 상태를 격리했다.

실제 iOS/Android 가상 키보드, OAuth·AI·법률 API·운영 storage·배포와 전체 기능 인수는 이 합성
검증에 포함하지 않는다. 기존 자료/리포트 소비자 이전과 main 최종 full 인수는00/02/03이 이어간다.
