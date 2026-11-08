# 세션 통합 인계

총괄의 세션 도구 응답이 지연될 때도 이 문서와 명시된 커밋을 기준으로 진행한다.
새 API·DB 계약이나 다른 소유자의 제품 변경을 승인하는 문서는 아니다.

## 04 기존 자료 권리

공유 mock 정합성 커밋 **`3d3085d`**를 04 branch에 cherry-pick해 사용할 수 있다.
`src/client/api/mock/lawyers.ts`, `runtime.ts`, `tests/lawyer-archive-mock.test.ts`만 변경했다.
목록 조회의 프로필 생성0, privateRead의 실제 owner 경계와 빈 profileId 의미,
삭제의 owner/revision CAS·재동의 시 기존 삭제권을 실제 기존 endpoint와 맞췄다.
실제 API/DB는 변경하지 않았다. 기존 self-profile14와 새 mock archive4 합계18 PASS/160 assertions.
새 등록·편집의 동의 gate는 그대로 유지한다.

04는 settings에서 기존 자료를 명시적으로 조회·열람·다운로드·삭제하는 최소 UI를 완성한다.
getMine은 누락 프로필을 생성할 수 있으므로 호출하지 않는다. privateRead endpoint를 쓴다.
새 일반 계정에 자동 조회를 하지 않으며 계정 전환·늦은 결과·권한 상실에 전달을 차단한다.

## 01·02 시작 화면과 목록

02 실제 markup은 `4560f1aed38ac6c228b19aba6ad36c258710e24a`다.
01 대응 CSS는 `05f0392fc856961f7775fd19a558b97285330507`이다.
root는 두 변경과 cleanup `43d814a4457389b63d0d9547cf810cb9c237d9e0`를 모두 소비했다.
`/cases`가 실제 목록이므로 공통 사이드바의 `내 사건` 진입도 01이 제공해야 한다.

## 03 직접 리포트 진입

root는 route `486cd16c6c7dce310419aaf0914f43b7140f92d4`와 fixture `5111da7`를 순차 소비했다.
독립 리포트 URL도 Workspace initialTask를 사용한다. 기존 계정 회귀 대역도 새 passive workspace
조회 composition을 제공해야 하며 NOT_FOUND를 무시하는 제품 fallback은 추가하지 않는다.

## 최신 main

첫 기준7236c14 이후 main b02357f/PR772를 각 owner가 보존해 통합했다.
후속 main `5f108c859ee27fdd6c32908cb9ed3fafc096f894` 알림도 받았으며 실제 fetch/최종 인수가 남았다.
변경은 workflow·실행 문서·file-processor Docker 다운로드 복구라는 보고이고 실제 확인 후 보존한다.
과거 SHA의 성공을 최종 통합 SHA 검사로 확대하지 않는다.
