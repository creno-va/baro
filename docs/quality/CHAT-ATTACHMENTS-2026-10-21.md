# 채팅 첨부 UX 검증 — 2026-10-21

## 변경과 경계

- #307 / `codex/307-chat-attachments`; 선행 PR303 head854df33 CI 성공과 사용자 직접 병합
  승인을 확인한 main57a91de에서 시작. 다른 세션의 루트 변경을 보존하며 별도 worktree 사용.
- 채팅의 자료 탭 이동 링크를 사진·파일 선택으로 변경. 로컬 미리보기·제거·끌어놓기·붙여넣기,
  자동 처리 동의, 파일만 보내기, 업로드/처리 상태와 전송 대기 취소를 제공한다.
- 기존 업로드의 hash/CAS/멱등 키/ACK 경계와 실제 소유권·동의·기술 한도를 그대로 사용한다.
  처리 실패·자료 삭제 때 자동 전송을 중단하고 입력을 보존한다. 계정 변경 시 초안을 지운다.
- 기존 저장 메시지의 selectedFileIds를 화면에 보존한다. AI 응답/사실에 실제 자료 참조가
  있을 때만 근거로 표시한다. 단순 선택을 근거 활용으로 바꾸지 않는다.
- 전체 첨부 목록의 빠른 metadata 조회를 유지한다. 명시적인 근거 보기만 요약과 최근 최대
  100개 메시지를 병렬 조회하고 최종 workspace revision/권한 경계로 감싼다. 이전 답변의
  참조는 해당 답변에서 계속 열 수 있다. DB migration·새 모델/공급자는 이 PR 범위 밖이다.
- case 화면에서만 로컬 blob 이미지 미리보기 CSP를 허용한다. 이미지 URL은 제거/해제 시 회수한다.

## 검증

Bun1.4.0 `bun ci` 완료. 관련 단위53개 통과: 저장 메시지의 첨부 ID, 실제 DTO,
기본 자료 metadata projection과 명시적 근거 조회, 업로드 ACK/재시도/소유권 경계.

합성 브라우저 새 첨부7개 통과: 320/390/768/1440px, 이미지 로딩/제거와 focus 초안 보존,
파일만 보내기/저장 후 재조회, 업로드 실패와 동일 원본 재시도, 처리 실패와 대기 취소,
계정 변경 삭제, 실제 참조만 근거로 분류, 끌어놓기/붙여넣기. 파일만 보내기의 초기1회는
병렬 빌드 중5초 기대를 넘겨 실패했으며 같은 기대를 변경하지 않고 좁힌3회와 최종 전체
재검증에서 통과했다.

기존 초안/자료 snapshot18개와 명시적 세션 변경5개 통과. PR303이 일반 focus에서 UI를
보존하므로 기존 숨김 검사의 트리거를 명시적인 세션 변경으로 바로잡았다. owner/role/
만료 시 삭제와 동의 만료 시 읽기 전용 검증은 유지한다. 빌드 Worker CSP 브라우저1개 통과.

최신 main76643b7(PR309 CI 성공)을 충돌 없이 통합한 제품 head
`8c7919f17ee5e1b0d76d8e62278ed7e9028b5542`에서 `validate:quick`(19개 quick 계약 검사 포함),
관련 단위53개, `validate:build`(production 빌드, bundle, Worker dry-run)를 순차 실행해 통과했다.
이후 커밋은 이 검증 기록만 갱신한다. [PR310](https://github.com/creno-va/baro/pull/310)의
최종 head/CI는 PR 본문 및 이슈 receipt에 기록한다. 실제 OAuth·모델 호출·배포는
이번 검증에 포함하지 않으며 합성 결과를 #71 전체 실제 인수로 확대하지 않는다.


## 최신 법률·판례·사진/PDF 통합 검증

main `1b10fc6a4021eeb61a8b1ee5b8015df81f60e4ad`(PR306·311·313)을 전용 worktree에
충돌 없이 병합한 제품 head `24c2a47e83d6312dfba004c58137a00c7f04b740`을 검사했다.
Workspace와 workspace client의 blob은 기존 검토 headcdf72a1과 동일하다. upstream의 판례
탭·사진/PDF client 필드·모델별 원장과 PDF만 저장하는 계약을 보존했다.

- Bun1.4.0 `bun ci`, `validate:quick`(quick 계약19개), `validate:build` 통과.
- 기존 workspace53개와 판례 contract/API·사진/HTML25개: 관련 단위78개 통과.
- 합성 브라우저: 첨부7개, 판례4개, 리포트 통합3개(새 사건→자료→PDF→삭제,
  큰 원본 복구, peer revision 재생성) 통과.
- 최종 통합 빌드의 Workers CSP 브라우저1개 통과.

이후 변경은 이 검증 기록 문서뿐이다. 새 PR head의 GitHub CI 및 정상 병합 receipt는
PR310과 #307에 기록한다. 수동 full·provider 호출·preview/production 배포는 중복 실행하지
않으며 #71의 동일 SHA 외부 인수·운영자 승인 경계를 유지한다.
