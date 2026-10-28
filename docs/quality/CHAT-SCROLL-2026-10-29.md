# 사건 채팅 내부 스크롤 — #581

> #584 사용자 정정이 아래 초기 구현보다 우선한다. 화면 전체를 잠그지 않고
> 대화·입력창 패널까지만 남은 viewport 높이를 사용한다. 사건 준비 현황·저장 상태·
> 대화 안내·이용 설정은 패널 아래에서 문서 스크롤로 확인한다. 중복 소제목 공간을
> 줄이고 제목 줄바꿈/화면 크기 변경 후 패널 높이를 다시 계산한다. 최신 지시대로
> 관련 브라우저2개와 필수 CI만 검증하고 전체 테스트는 반복하지 않는다.

사용자 피드백에 따라 사건 디테일의 대화 내역만 내부에서 스크롤한다.
기준 main은 `b7e460f150789009b296ab9cfbe12900146545b7`이다.
탭·메시지 입력창·사건 요약/준비 현황과 이용 설정은 viewport 안에 유지하며,
자료·타임라인 등 다른 탭과 legacy 화면에는 문서 스크롤을 유지한다.

## 구현

- 채팅 경로에만 viewport 높이의 flex 레이아웃과 `min-height: 0`을 적용한다.
  메시지 log에 `overflow-y: auto`와 scroll chaining 방지를 적용한다.
  긴 입력·첨부·열린 준비 현황 및 이용 설정도 각 영역 안에서 스크롤할 수 있다.
- 추천 질문은 메시지 영역 아래에 두어 입력창 공간을 차지하지 않게 한다.
  log는 이름·실시간 대화 알림을 유지하고 키보드로 진입해 스크롤할 수 있다.
- 자동 이동은 `scrollIntoView` 대신 메시지 컨테이너의 `scrollTo`만 호출한다.
  사용자가 위쪽을 읽으면 새 답변의 점진적 공개가 스크롤을 끌고 가지 않는다.
  하단으로 돌아오거나 직접 메시지를 보내면 이어서 따라간다.
- 모바일 viewport resize에는 `visualViewport.height`를 반영한다. 로컬 검증은
  화면 크기 변경이며 실제 기기의 가상 키보드 인수로 표현하지 않는다.

## 검증과 협업

실제 Chromium에서 기존 첨부·전송/실패·계정 전환·답변 공개와 위치 유지 검증 및
새 내부 스크롤 검증12개가 통과했다. 긴 합성24개 메시지에서 1440×900,
1024×768, 390×844, 320×650, 844×390을 확인했다. 실제 wheel로 내역만 이동하고
탭과 composer 좌표·문서 scrollY가 유지되며 하단에서도 페이지로 전파하지 않는다.
일반 높이에서는 입력칸과 보내기 버튼의 노출도 확인했다. desktop/mobile 합성
스크린샷을 시각 검토했으며 실제 사건·계정 데이터는 사용하지 않았다.

다른 탭 이동 시 문서 overflow 제한이 해제되고, 대화로 돌아와 사건 삭제 dialog의
비활성 확인·취소까지 가능한 추가 Chromium 검증1개도 통과했다.
frozen `bun ci`, `validate:quick`(마지막625 pass/2 skip/0 fail), `validate:build`
(production bundle·Worker dry-run·local workerd), `validate:db`(fresh/upgrade/import
재실행)를 통과했다. 최초 quick은 키보드 스크롤 영역의 lint 주석 위치 오류로 실패했고,
속성에 설명을 붙인 뒤 정정했다.

다른 세션에 변경 범위를 알렸고 PR580의 판례·리포트·프로필 파일을 수정하지 않는다.
최종 PR/main CI·full-validation·preview의 정확한 SHA/상태는 #581에 기록한다.
production은 이 작업에서 배포하지 않는다.

## 이전 파일 receipt 읽기 정정

#577 최종 main의 full40740044593은 자료 교정/처리 회귀에서 실패했다.
`v2-file-edits.ts`가 별도 strict receipt schema를 유지해 새 optional wrappedKey를
거절한 누락이었다. 이 reader도 `originalPartReceiptSchema`를 사용하도록 통일했다.
receipt 내용을 검사하는 owner/revision/blob/hash·publication guard는 유지하며,
schema/migration이나 HTTP 계약을 바꾸지 않는다. 기존 전체 검증 실패는 성공으로
덮어쓰지 않고 수정 후 unit 및 정확한 최종 main full 결과를 구분해 기록한다.

로컬 전체 unit은4462 pass/3 skip/17 fail이었다. 그중 처리기 SQL 기대값2개는
중복 조회가 조각마다1회 줄어든 측정값으로 정정했다. 1쪽654 calls/838 statements,
2쪽1159/1464이며 권한 경계312/561은 그대로다. 자료 교정·10,000관찰/20,000파생물·
대형 UTF-8 교정·복구 및 실제 처리 경로 집중107개가 수정 후 모두 통과했다.
나머지15건은 변경하지 않은 Windows의 signal/mode600/복구·프로세스 하네스에서
실패했으며 같은15개가 기존 main의 Linux full40740044593에서는 통과한 것을
실제 로그로 대조했다. 로컬 전체 unit 성공으로 표현하지 않는다.
