# v2 전체 기능 시연·완료 증거 계약

- Status: Required evidence; v2 implementation/demo/live/public approval not yet proven
- Tracking: [#69](https://github.com/creno-va/baro/issues/69), [#71](https://github.com/creno-va/baro/issues/71)
- Product scenarios: [UI demonstration](../product/UI-DEMONSTRATION.md)
- Contracts: [v2 workspace](../architecture/V2-CONTRACTS.md), [v2 API](../architecture/V2-HTTP-API.md)

전체 개발 마일스톤의 완료는 배포된 실제 UI에서 합의한 모든 기능을 끝까지 시연할 수 있는가로
판정한다. 화면 존재·목록 manifest·문서·mocked test·health200·green CI만으로 대체하지 않는다.
현재 표는 요구사항이며 체크된 결과가 아니다. 각 행의 구현과 독립 오류 검증, browser 관찰과
실제 외부 연동 근거가 필요하다. 외부 사람/계정/법률 조건이 남아도 독립 개발을 계속하되 전체
완료로 축소 보고하지 않는다. P0.3 #19/#20/#27과 v2 승인 [#70](https://github.com/creno-va/baro/issues/70)을 보존한다.

## 증거 종류와 정본

| 종류 | 증명하는 것 | 증명하지 못하는 것 |
| --- | --- | --- |
| `offline-contract` | strict schema·SQL·권한·암호화·의존성/fixture 회귀 | 실제 계정/API/모델/플랫폼 성공 |
| `synthetic-browser` | 실제 UI와 local/test adapter 정상·실패·모바일·CSP | live OAuth·Whisper·vision·법률 승인 |
| `preview-live` | 배포된 Worker/Container/R2와 실제 승인 서비스의 합성 사건 흐름 | production 다른 SHA·환경 또는 일반 공개 승인 |
| `production-smoke` | 승인된 동일 candidate 배포와 실제 운영 설정의 비민감 확인 | preview 테스트 역할/합성 데이터가 production에 있어도 된다는 승인 |
| `human-approval` | 서명/버전/시각/대상/게시 근거가 있는 사람의 판단 | 자동 테스트·AI의 법률 검토 결과 |

receipt는 issue/scenario ID, immutable candidate SHA, environment, UI build/Container digest,
contract/model/prompt/policy/corpus versions, observedAt, 실행 명령/브라우저 viewport, 결과와
허용된 failure code, trusted run URL·artifact digest를 포함한다. CI job이 허용된 candidate를
실제로 checkout했는지 확인한다. 보고서 hash와 원본 hash는 합성 corpus에서만 artifact에
남긴다. 실제 사건 내용/credential/로그인 토큰/query/SQL/stack·전체 HTML·trace·개인 profile
정보는 수집하지 않는다. screenshot은 preview 합성 UI로 제한하고 실제 OAuth provider 화면과
실제 개인 계정 정보는 저장하지 않는다. 사용자 브라우저에 남은 session은 artifact가 아니다.

manual browser 검증은 action과 실제 화면 관찰, 재접속 후 상태를 기록한다. 자동 Playwright
assertion만으로 시각적 품질을 완료하지 않고 대표 화면 screenshot을 직접 확인한다. 예쁜
스크린샷만으로 button/route/API 동작을 주장하지 않는다. 같은 SHA라도 환경과 provider 상태가
다르면 증거를 분리한다. 링크가 접근 불가/오래됨/다른 release면 완료 evidence가 아니다.

## 일반 사용자 시연

| ID | 실제 browser 동작·지속 상태 | 실패/보안 경계 | owner |
| --- | --- | --- | --- |
| U01 | Google/Naver/Kakao 실제 성공→필수 동의·14세→dashboard | 취소·state mismatch·만료·정책 변경·cross origin | #27/#68/#69 |
| U02 | 개인/기업 사건 생성→저장 목록→새로고침·재접속 | 기업 단일owner, 중복 클릭·Turnstile·3/4번째 admission | #55/#57/#64/#65 |
| U03 | 큰 틀 질문→답변 기반 새 묶음→unknown/skip→중단/재개 | 최대3묶음×5문항 기본, 질문 중복·invalid choice·오래된 revision | #64/#65 |
| U04 | 요약 수정→상충/불리한 사실 확인→최신 요약 confirm | 늦은 AI summary·확인 전 navigation·허구 사실 차단 | #64/#65 |
| U05 | 친숙한 채팅→재접속 후 history→새 자료/사실의 diff | stale job·중복 send·provider outage·검증 전 token 노출 금지 | #64/#65 |
| U06 | timeline/행동 todo·done·skip 수정→저장 유지 | 법적 결론·승패/협상/소송전략·자동 상대방 연락 없음 | #64/#65 |
| U07 | 문서/이미지/음성/영상 업로드→자동 처리·상태·원본 열람 | 동의·MIME위조·악성/암호/손상·취소·timeout·중복part | #58/#59/#65 |
| U08 | PDF500페이지·100MB 문서, 1GB/60분 media 허용 경계 | 각 상한+1·사건원본100/101files·원본합계5GB·계정전체10GB 동시예약. 파생물/report는 계정에만 저장차감 | #57/#58/#59 |
| U09 | 추출 문단/페이지·ASR timestamp·영상frame 확인/수정/제외 | OCR 오류·silence·speaker 불확실성·누락구간·1초+장면coverage | #59/#65 |
| U10 | 한국법 모든 분야의 합성 사례를 입력·정리 | 지식/근거 부족은 불확실성, 법률군 자동 탈락/허구 법률결론 없음 | #63/#64/#69 |
| U11 | 공식 법령/판례/기관 guide 인용 열기·근거 확인 | wrong ID/date/hash·staleguide·API장애·비공식 source 차단 | #63/#64 |
| U12 | 자료/편집/마스킹/제외 검토→PDF 생성→history | latest snapshot·불리한 사실 포함·lawsource 장애의 factualreport | #66 |
| U13 | PDF/선택 원본 ZIP을 실제 다운로드·열어 확인 | 한글 font·긴표/페이지·원본hash·제외자료/PII선택·다른owner 차단 | #66/#69 |
| U14 | 변호사 목록/지역·분야→프로필→연락/길찾기 | emptyregion·cursor회전·사건fit/유료우선 없음·외부주소와 link검증 | #61 |
| U15 | 연락 경로 선택 후 workspace 사실/자료/report 갱신 | counsel전략 대체·자동전송 없음, 기존 report snapshot 유지 | #64/#65/#66 |
| U16 | quota잔여·대기·KST재개·같은 operation retry | day30/31responses·60minmedia·전역예산·retry중복quota/실제비용 | #57/#59/#64 |
| U17 | archive/재개, 개별자료·사건 삭제→읽기 불가 | upload/model/Container/report가 늦게 끝난 race·R2 orphan | #67 |
| U18 | 최근 OAuth→계정 삭제→로그아웃→자기자료 접근 불가 | sliding는 최근인증 아님·동의변경중삭제·다른owner영향 없음 | #67/#69 |
| U19 | 기존v1 읽기·답변·retry·삭제→명시적v2 전환 | additive migration·legacy snapshot 보존·자동재분석 없음·legacy10+v2 3quota/cost우회없음 | #54/#55/#57/#65/#67 |

U08의 대용량 경계는 서버 fixture만으로 browser의 resumable upload를 증명하지 않는다.
로컬 합성 생성파일/stream으로 byte·page/duration 경계를 만들고 preview 실제 경로에서 재개·
처리·메모리/비용 제한을 확인한다. 영상 표본을 실제 일부만 처리했다면 미완료 coverage를
표시하며 60분 전체 처리 기능의 완료는 별도 끝까지 실행한 증거가 필요하다.

## 변호사·심사자·공개 방문자 시연

| ID | 실제 동작·지속 상태 | 실패/보안 경계 | owner |
| --- | --- | --- | --- |
| L01 | 개인 변호사 신청→인증/사무실 자료 제출→상태 재조회 | 자기 verified 부여·타인 verification 읽기·서류 공개 없음 | #60/#62 |
| L02 | 사진·이름·소개·주소·연락·text/image/PDF portfolio 편집·preview | HTML/SVG/activePDF·unsafe URL·사건식별정보 검토·파일quota | #58/#60/#62 |
| L03 | submit→심사자 확인/반려→수정·재신청→승인 | submitted 불변·동시결정·자기승인·철회 후 늦은승인 | #60/#62 |
| L04 | 승인본 공개→수정본 submit 대기 동안 기존승인본 열람 | pending draft/asset leak·공개pointer 임의변경 차단 | #60/#61/#62 |
| L05 | 공개 철회/계정 삭제→directory/detail/assets 접근 제거 | public R2/CDN purge·복구 후 재등장 차단 | #60/#67 |
| M01 | 심사자 로그인→자격·사무실 확인→approve/reject | 최근OAuth·role위조·권한철회·crossapplicant·감사record | #60/#62 |
| M02 | revision차이/portfolio 안전preview→공개 승인·반려 | 사건plaintext/search/decrypt/download endpoint 없음 | #60/#62/#69 |
| M03 | 신고 목록→허용된 공개대상 확인→처리 | 신고를 이용한 사건원문 수집·관계없는 private자료 열람 없음 | #60/#62 |
| M04 | 비민감 queue/quota/budget 운영 상태 확인 | 원문·파일명·DEK·cookie·provider errorbody 없음 | #57/#62/#69 |
| P01 | 비로그인 directory/profile/승인portfolio·정책·FAQ | 사건·미승인revision·인증서류·심사route 접근 차단 | #56/#61/#68 |
| P02 | 등록0명/지역분야부족 상태·길찾기/연락link | 가짜 변호사·임의모집숫자·법률승인표시 없음 | #61/#68 |

법률가 fixture의 승인 상태는 preview의 합성 data일 뿐 실제 license 검증 완료가 아니다.
production에 가상 변호사/합성 사건/testrole을 게시하지 않는다. 실제 최초 등록/승인 flow는
확인된 자격 자료와 사람의 심사 기록이 필요하다. 연락 테스트는 목적지·외부 navigation/
mailto/tel 연결 확인까지며 실제 제3자에게 상담 메시지를 발송하지 않는다.

## 공통 디자인·복구 시연

| ID | 검증 요구 | authoritative evidence |
| --- | --- | --- |
| Q01 | shadcn 공통DS·파란primary·Lucide·Pretendard·single sharedSVG | 전체대표화면 직접관찰, token/component/asset source, font 실제 network/render |
| Q02 | 320px mobile·desktop·200%·keyboard complete flow | dialog/menu/upload/chat/table 누락/overflow/focus·screenreader 이름·상태 확인 |
| Q03 | loading/empty/error/limit/permission/review 상태 | 기능별 fault 주입+UI복구, deadlink/placeholderbutton 없음 |
| Q04 | built Worker CSP/hydration·OAuth/Turnstile·font·download | 실제배포header·콘솔오류확인·interaction, unsafe-inline/eval 무분별 허용 없음 |
| Q05 | role/IDOR/CSRF/XSS/promptinjection/fileSSRF | route+SQL+blob/job/report crossowner rejection, critical bypass0 |
| Q06 | 삭제·keyrotation·backuprestore·publicpurge·rollback·alert | 실제격리platform drill+trusted receipts, journalfirst/revocation/ack |
| Q07 | monthlybudget·ASR/vision/Container cost·ambiguousretry | reserve/actual/reconcile증거, 구매/자동충전없음, 기술100만원/법률별도 |
| Q08 | optin/nooptin/optout·PII없음·v1/v2 metric분리 | network/storage/schema검사·종료후삭제·syntheticcohort 제외 |
| Q09 | preview/production 같은release·API/server+Container parity | CI/mainimmutableSHA·image digest·health+실제smoke·Environment승인 |
| Q10 | 실제OAuth/model/ASR/vision/lawsource·정책게시/법률근거 | #27/#70/#71 각 live/human evidence; Boolean만존재하는 기록거부 |

자동 axe WCAG A/AA finding0은 수동 keyboard/zoom/assistive 확인을 대체하지 않는다.
파일 다운로드 UI가200이어도 PDF를 실제 render해 한글/레이아웃/내용을 확인하고 ZIP entries와
선택원본 byte를 비교해야 한다. Container local build와 remote processing lifecycle도 구분한다.

## 완료 audit와 남은 조건

각 scenario에 requirements→구현PR→offline test→browser action/screenshot→live receipt→
policy/role 승인 필요여부를 연결한다. 미실행·미지원·간접근거·실패·비용불명확은 미완료다.
50개 v1 eval을 계속 돌리되 v2 법률군·적응형질문·상충/불리사실·media prompt injection·
법률전략·자료진정성·role/출처 위조를 추가한다. 평균점수로 critical finding1건을 상쇄하지 않는다.

기능 이슈는 실제 인수조건/CI가 모두 충족됐을 때만 close한다. 실제 외부 조건이 남으면
Refs와 구체적인 후속 live/승인 이슈를 연결한다. 전체 milestone/Goal은 모든 시연과 실제
외부·정책·공개조건까지 authoritative evidence가 증명해야 완료다. blocker가 남을 때는
필드·계정·승인담당·필요행동·직전실패와 진행가능 작업을 기록하며 완료기준을 줄이지 않는다.
