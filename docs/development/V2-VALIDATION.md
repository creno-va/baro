# BARO v2 검증 증거 기록

- 기준일: 2026-10-06
- 상태: 명세 작업 #53 진행 중. v2 제품·실제 UI·외부 연동·공개 완료 증거 없음.
- 마일스톤: [전체 서비스 개발](https://github.com/creno-va/baro/milestone/5)
- 실행 정본: [V2 실행 계획](./V2-EXECUTION.md), 개정 PRD/UX와 실제 GitHub 이슈

## 증거 작성 계약

각 성공은 requirement/scenario ID, full candidate SHA, 환경, 실행 시각, 역할, 실제/대역 구분,
결과, run/receipt/안전한 화면 artifact를 연결한다. 실제 사용자의 사건·사진·변호사 자격 서류,
cookie·token·secret·인증 URL·stack/SQL은 증거에 포함하지 않는다.
릴리스별 증거를 새로 기록하고 과거 SHA의 녹색 CI나 health를 현재 기능 승인으로 쓰지 않는다.
관측 실패·missing·pending·mock-only는 통과가 아니다.

## 전체 요구사항과 증거 소유자

| 요구사항 | 코드/계약 이슈 | 실제 검증 | 현재 판정 |
| --- | --- | --- | --- |
| 로그인·동의·계정·만14세·역할 | #60/#68, 기존 #10 | #27/#69/#71 실제 OAuth 성공/취소/만료/권한 | 미검증 |
| 개인/사업자 단일 소유자·전체 사건군 | #54/#55/#63/#64/#65 | #69/#71 사건군별 UI·평가·공식 source | 미구현 |
| 적응형 질문·모름/skip·중단/재개 | #54/#64/#65 | #69/#71 답변별 생성·저장·중복·재접속 | 미구현 |
| 사용자 요약 확인·수정 | #55/#64/#65 | #69 revision 충돌·확인 전 행동 가드 | 미구현 |
| 지속 chat·사실/인물/timeline/actions | #55/#64/#65 | #69/#71 실제 대화·완료·저장·재로그인 | 미구현 |
| AI 사실 경계·불리한 사실·모순·근거 | #63/#64 | #69/#71 실제 모델·전체 사건군·critical zero | 미검증 |
| 자료 업로드·동의·원본 접근 | #57/#58/#65 | #69/#71 actual R2·권한/크기/중단/실패 | 미구현 |
| 문서/이미지/음성/영상 처리 | #59/#64/#65 | #69/#71 actual processor/Whisper/model·coverage/timestamps/gaps | 미검증 |
| quota·월100만원·실제 비용·retry | #57/#58/#59/#64 | #69/#71 동시성·KST·usage/cost reconciliation | 미구현 |
| 한글 PDF·검토/수정/마스킹/제외 | #66 | #69/#71 실제 다운로드·렌더·내용·revision | 미구현 |
| 선택 원본 ZIP | #66 | #69/#71 다운로드 실제 원본·권한·제외 파일 | 미구현 |
| 변호사 등록·자격/소속 수동 확인 | #60/#62 | #69/#71 신청·반려·재신청·승인·역할 | 미구현 |
| 사진/소개/주소/contact/portfolio | #58/#59/#60/#62 | #69/#71 텍스트/image/PDF·미리보기·저장 | 미구현 |
| 모든 공개 편집 승인·승인 revision | #60/#61/#62 | #69 pending 비공개·stale revision·철회/공개 | 미구현 |
| 디렉터리·필터·회전·공급 부족 | #61 | #69/#71 실제 UI·객관적 정렬·가상 프로필 분리 | 미구현 |
| 전화/email/외부 link·3종 길찾기 | #61 | #69/#71 정상 링크 연결, 실제 상담 메시지 발송 없음 | 미구현 |
| moderator 심사·신고·비민감 상태 | #60/#62 | #69/#71 case plaintext 접근 금지·IDOR/CSRF | 미구현 |
| 사건/자료/계정 삭제·부활 방지 | #67 | #69/#71 원본/파생/대화/작업/report/public asset·late processing | 미구현 |
| restore/delete replay·rollback·alert | #19/#67/#71 | #71 실제 격리 drill·latest journal·수신 ack | 미검증 |
| shadcn/blue/Lucide/Pretendard/SVG | #56/#61/#62/#65/#66 | #69 브라우저 visual/mobile/keyboard/focus/modal/200%/built CSP | 미구현 |
| 법률/정책·사업자·처리 계약 | #20/#68/#70 | 책임자 사실/승인·게시/동의 버전·provider 증거 | 근거 없음 |
| preview/production·최초 공개 | #71 | exact SHA CI→preview→live→Environment→production→승인 public flag | 미완료 |

## 기존 증거와 재사용 한계

[P0.3 검증](./P0.3-VALIDATION.md)과 [readiness](../operations/ENVIRONMENT-READINESS.md)는
현재 v1 외부 실패/미검증과 foundation 배포를 기록한다. #52 PR CI 성공은 기존 v1 회귀와
독립 진단/계약 검증이며 v2 화면·모델·미디어·변호사·공개 정책을 증명하지 않는다.

현재 법령 adapter는 승인 정보 credential로 HTTP 200 upstream-error를 반환했다.
격리 AI는 durable 예약 1회 뒤 report가 없어 결과/비용이 미확인이다. OAuth의 preview 전용 여부와
실제 callback, Turnstile token/action, 복구 관리자와 live drill, 사업자/법률 승인도 남아 있다.
예산과 production 코드 배포 허용은 실제 성공/승인 증거를 대체하지 않는다.

## 최종 감사

각 원래 Goal 항목과 PRD 요구사항을 위 ledger 및 UX 시연에 대응시킨다. 누락된 기능이나
승인·명령·artifact·실패 조건이 있으면 완료하지 않는다. 모든 역할의 실제 동작, 다운로드 내용,
저장/삭제/복구, 외부 제공자, 같은 릴리스 배포, 공개 승인 근거까지 강한 증거로 확인한 뒤에만
milestone 5와 Goal을 완료한다. 이번 명세 PR은 이후 실제 성공을 미리 기록하지 않는다.
