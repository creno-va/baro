# 사진 근거·HTML/PDF 구현 검증

- 직접 사용자 요청: #312. 모델 전환 PR309/샤76643b7과 별도 작업이다.
- 범위/제약: [실행 계약](../architecture/REPORT-PHOTOS-PDF.md).
- 로컬 SQL/암호화 사진 검증7건 통과: 관찰 본문, 선택 HTML/PDF 입력, 가림 무IO, 출처·계정 경계, 읽는 중 삭제·다른 사건 내용이 바뀐 저장본 미리보기, 비용 관측 없는 native 실행 admission. 실제 PDF 엔진 대신 명시한 대역이며 실제 Gemini 사진 품질을 의미하지 않는다.
- 기존 모델 SHA의 full39592333256 실패는 파일 probe 확정 거절 test adapter가 일반 ProcessingError를 사용한 계약 불일치로 로컬에서 재현했다. DefinitiveFileRejection 대역으로 정정하며 production 오류 분류를 바꾸지 않는다.
- Windows Docker daemon 서비스 시작 권한이 없어 로컬 native 조판은 미수행이다. Report rendering CI에서 동일 앱 HTML/TTF·합성 사진을 Linux pinned WeasyPrint로 조판하고 모든 페이지를 PNG로 검토한다. head acd4daa의 조판 CI39598029230은 통과했고 PDF5페이지 전체를 시각 확인했다. 긴 문단 경계를 보정하고 TextBox의 페이지 폭 검사도 통과했다. 최종 head의 재검증과 정확한 SHA는 #312 receipt에 기록한다.
- Windows 전체 bun test는 자식 프로세스 timeout·POSIX600 권한 가정 및 workerd GetQueuedCompletionStatusEx 종료로 완주하지 못했다. 이전 조판/삭제 대역의 계약 갱신 뒤 관련 저장·암호화·삭제37건은 통과했다. 실패한 Windows 전체 실행을 성공으로 기록하지 않으며 PR Linux 전체 단위·통합 검증으로 확인한다.
- head8d1216d의 Linux 전체 실행은3209pass/17fail이었다. 17건 모두 git show로 고정 이력의 법률 대역을 읽는 검증에서 shallow checkout 때문에 실패했다. 같은 workflow의 fetch-depth를0으로 바꿔 필요한 이력을 받도록 정정하며 해당 검증을 제외하지 않는다. 최종 재검증은 #312 receipt에 기록한다.
- 최신 법률/판례 main90ba626 통합 head107a2e7에서 실제 private HTTP 조판·cleanup은 통과했고 전체3255pass/1fail이었다. 유일 실패는 PR306이 바꾼 서버 소유 legal_consultation 기대값이 이전734/4로 남은 tests/workspace-source-plan.test.ts이며 담당과 조율 후 현행 endpoint/institution/568/2/2/1 전체 필드로 보정했다. 법률 제품 코드와 registry는 수정하지 않았다. 고객 전체 shell의 구형 ZIP 선택자와 공개 preview 확인 문구도 PDF 저장 계약에 맞춰 갱신했으며 고객 intake→자료→PDF→삭제 시연은 통과했다.
- head46e512c의 Quality gate39603040940·native/전체회귀39603041014는 SUCCESS다. 추가로 실제 제품과 같은 style-src self 제한의 브라우저 harness에서 선택 사진의 실제 디코딩·화면 폭·저장/재로딩·마스킹을 확인했고 응답 inline style 삽입을 제거했다. 사진 규칙은 정적 reports.css에 제공한다. 이 보완을 포함한 최종 SHA 증거는 #312 receipt에 남긴다.
- 실제 Gemini의 상해/진단서 OCR·개인정보 처리·응답 지연, preview/production 배포 인수는 별도로 남긴다. 이 작업은 배포를 실행하거나 #71 전체 인수를 완료하지 않는다.
