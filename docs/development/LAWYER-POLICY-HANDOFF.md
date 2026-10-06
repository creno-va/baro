# 변호사·공개 정책 인계 — #62/#68/#20/#70

- Candidate base: `ca6e15b` (PR125 main)
- Branch: `codex/62-lawyer-public-polish`
- Reviewed: 2026-10-07 KST
- Status: 구현·로컬 검증 완료 / 공유 역할 가드 통합·외부 검증·법률·사업자·게시 승인 대기
- 변경 소유: lawyer/profile/directory 전용 UI/API/module/CSS/test, 도움말/정책/콘텐츠
- 공유 인증·role/session/contracts/schema/router/CI·동의 버전은 4번, 저장/처리/계정 삭제는 2번.

## 구현·증거의 경계

기존 self-profile의 encrypted D1 snapshot persistence와 SQL owner/revision/role/consent/삭제 가드를
재사용한다. 기존 작은 JPEG 사진·HTTPS 포트폴리오 링크도 보존한다. 새 사진은 240px JPEG로
재인코딩·metadata 제거 후 기존 #58 자산 예약→R2 upload와 #59 정제 API를 소비한다.
포트폴리오 이미지/PDF도 같은 API를 소비한다. 새 업로드 backend·schema·migration은 만들지 않는다.

정제 ready 자료만 자기 프로필에 연결한다. 현재 self-service 공개 자산은 private R2의 정제
자료를 공개 상태/owner/profile/purpose/current consent/role/삭제를 검사한 API로 stream한다.
과거 승인 public R2 copy와 심사 기록은 유지한다. 역할 선택을 자격 확인으로 표시하지 않는다.
다른 owner/신분 증빙/사건 원본/pending 자료/비공개 pointer는 공개 경로에서 열지 않는다.
저장·비공개·삭제·권한 변경 중 stream은 재검사하며 이전 revision 응답은 차단한다.
자기 ready 업로드는 저장 전에도 owner 전용 경로에서 미리볼 수 있으며 공개 경로에는 저장된
reference가 필요하다. stream 중 auth 재검사는 응답 header를 다시 쓰지 않는다.

프로필 편집은 focus/visibility/pageshow/peer-tab storage와 저장/공개 전후에 session을 확인한다.
계정/role/동의 변경 시 draft·preview·공개 확인·사진 변환·오류와 이전 응답을 폐기한다.
공개 요청은 profileId/revision을 명시해 이전 계정 요청이 다른 자기 프로필에 적용되지 않게 한다.
디렉터리는 URL 복원 전 입력을 잠시 비활성화하고 복원 후 빠른 입력·새 검색을 보존한다.
뒤로/앞으로는 popstate로 복원하고 오래된 검색 응답은 새 조건을 덮어쓰지 않는다.

아래 검증은 합성 OAuth 세션/SQLite/AES/R2·processor 대역과 제품 UI에서 구분한다. 실제 OAuth
provider callback·Cloudflare R2/Containers 청구/지역/보존·production 공개 성공으로 대체하지 않는다.

## 실제 정책·동의 버전

| 대상 | 현재 값 | 의미·다음 행동 |
| --- | --- | --- |
| 약관/개인정보/AI 문서·화면 | `2026-10-06-v2-draft` | 미승인 초안, 시행일 없음 |
| CURRENT_POLICY_VERSIONS | 각 `2026-10-04` | 기존 개발용 필수 동의; 승인된 v2 동의 아님 |
| profile publication/private record | `mvp-self-profile-public-v1` / `mvp-self-profile-private-v1` | 공개 항목/시각/revision 기술 기록; 정책·국외 동의 승인 대체 아님 |
| file autoProcessConsentVersion | 현재 AI 동의 버전 | 파일 예약에서 서버가 현재 동의와 대조; 법률상 동의 충분성은 미확인 |
| release evidence | reviewedAt null, publishedPolicies false | 승인/게시 evidence URL 없음; 공개 gate 실패가 정상 |

4번은 승인 전 버전을 임의로 맞추지 않는다. 승인 후에는 게시 문서·실제 policy 화면·동의
contracts/ConsentForm·자료 자동 처리/공개 동의 범위·publishedPolicies URL을 같은 candidate로
확정하고 기존 동의 기록/재동의 영향을 확인한다. release:check의 승인 상태·blocker·정확한
버전·human receipt 검사를 유지한다. 테스트 성공은 사람 승인으로 바꾸지 않는다.

## #20/#70: 사람이 확인할 필드·담당·증거

| 문서/필드 | 현재 상태 | 담당의 실제 행동 | 필요한 증거 |
| --- | --- | --- | --- |
| 약관 1조·개인정보 1절: 상호/법인/대표/주소/등록번호 | 기존 이름/연락처 후보만 있음; 실체 미확인 | 사업자 책임자가 등록정보·주소·대표 권한 확인 | 검토자·확인일·원문 문서 reference; 비민감 공개 값 |
| 개인정보 책임자·문의처·권리 행사 절차 | 역할·연락 가능성 미확인 | 사업자/개인정보 담당자가 책임·수신·본인 확인 절차 확정 | 실제 연락 확인과 담당 지정 기록 |
| self-service 프로필·외부 연락·무료/비알선 문구 | 법률 승인 미확인 | 자격 있는 법률 검토자가 두 역할, 등록 자체의 무검증 고지, 허위 자격 대응·철회, 광고/연락/비용·AI 준비 행동 검토 | 문서 버전/commit, 검토자 자격·권한, 검토일, 범위/수정/서명된 결정 reference |
| OAuth Google/Naver/Kakao | 처리 법인·국가·실제 항목/보존 미확인 | 운영 담당자가 각각 앱/계약/국가/항목/거부 영향 확인 | 실제 계약/콘솔 evidence, secret 제외 |
| Cloudflare Workers/D1/Workflows/KV/R2 | region·로그/backup·삭제·접근 조건 미확인 | 2번/운영 담당자가 실제 account plan/region/로그·복구·public/private 경계 확인 | 설정 시각·비민감 receipt, 실제 삭제/복구 drill |
| Containers/DO | 실행·egress 국가, tmp disk/log 종료/삭제 조건 미확인 | 2번이 실제 Container 처리·재시작/실패/취소/임시자료 삭제를 확인 | image/runtime 버전, 합성 job receipt와 운영 조건 |
| Whisper/Workers AI·AI Gateway/model provider | 계약 법인·국가·전달 범위·보존/학습/ZDR 미확인 | 운영 담당자가 실제 모델·계정 계약과 예외 로그/보존을 확인 | 실제 contract/settings receipt; logging/cache/store 옵션으로 대체 금지 |
| 보존: 원본·파생·PDF/ZIP·프로필·동의·로그·journal·backup | 목표와 구현 있음, 확정 기간/법적 근거 없음 | 개인정보/법률/운영 담당자가 항목별 기간·근거·파기/실패·backup 재삭제 책임 결정 | 항목별 확정 표·계약·실제 drill; 35일 목표를 실제 backup으로 쓰지 않음 |
| 민감/제3자 정보·국외 처리/위탁·제공·철회 | 근거/동의 구분 미확인 | 법률 검토자가 목적·항목·시점/방법·수탁/제공 구분·근거·거부 영향·추가 동의 구조 확정 | 승인된 각 필드/동의 문안·화면·거부/철회 동작 evidence |
| 게시/동의 version·시행일 | 미승인·미확인 | 사업자/법률 책임자가 승인 문서 범위/버전/시행일 지정 후 4번이 통합 | Approved for publication 문서, blocker 해소 근거, 동일 release URL/version, publishedPolicies review receipt |

#20/#70은 위 사실·법률·게시 승인 증거 없이는 종료하지 않는다. 정책 초안의 후보 연락처를
검증된 사실로 게시하거나, CI 통과/모형의 서술을 사람의 승인으로 기록하지 않는다.

## 소유자별 남은 통합 행동

- 4번: 고객 사건/채팅/private API에 server accountType=customer guard를 적용하고, 변호사로
  바꾼 동일 owner의 과거 고객 자료도 접근 금지인지 검증한다. 공유 `ROLE_REQUIRED` 오류 매핑을
  포함한다. 이 PR은 공유 role/session/router/계정 삭제 UI를 편집하지 않는다.
- 2번: 실제 자산 reservation/upload/정제 admission·처리 재시도/대기·사용량/삭제·restore 재삭제와
  실제 R2/Containers byte/보존 근거를 확인한다. 정제 대기 자료는 업로드 성공과 공개 완료를 구분한다.
- 4번: 기능 PR의 검증·관련 CI를 확인하고 병합한다. #70/#71과 production Environment/최초 공개
  gate를 별도로 유지한다. mock/로컬 DB 성공을 실제 외부 성공으로 표시하지 않는다.
- 사업자/법률/운영 담당: 위 필드별 증거를 준비해 #20/#70에 비민감 reference를 남긴다.

## 공개 콘텐츠 감사

2026-10-07 KST 외부 랜딩을 다시 읽었다. HTTP 200, HTML SHA256
`693bbfdd6c5b445ca8efb721087650de20e9ac27edad512b4f7dfa340392341a`로 과거 배포본과 같았다.
[랜딩](https://creno-va.github.io/baro-landing/)은 개인 간 금전 대여 v1 준비 상태를 안내하며
첫 CTA 전 AI·법률 자문 아님 고지를 유지한다. 승인 정책 링크는 없고 가입/사건 입력을 받지 않는다.
v2 두 역할/전 사건 준비 범위와 milestone 링크·새 브랜드는 아직 반영되지 않았다.

제품의 `/lawyer`, `/lawyers`, 공개 상세, `/help`, `/policies/terms`, `/policies/privacy`, `/policies/ai`
및 기존 `/policies/ai-notice` alias를 감사했다. 미확인 자격 badge와 심사 완료 문구를 노출하지 않으며
무료 BARO와 별도 변호사 상담/위임 비용, 자동 자료 전달 없음, AI 경계, 미승인 초안을 구분한다.
외부 랜딩 수정·게시 승인은 이번 코드 검증에 포함하지 않는다. 공개 전 랜딩 소유자가 실제 v2
시연/승인 범위·정책 URL/버전과 동일 release를 대조해 교체한다.

## 로컬 검증 결과 — 2026-10-07 KST

- `bun ci`: 380 installs/528 packages, lock 변경 없음.
- `bun run check`: lint/typecheck 성공, 1205 tests/132591 assertions 성공. schema drift 없음,
  fresh/upgrade migration 추가 6 tests/29 assertions 성공. schema/migration 변경 없음.
- `bun run build`, `bun run cf:dry-run`: 성공. dry-run은 배포·원격 Container 시작 증거가 아니다.
- `bunx playwright test --config tests/browser/lawyer-public.config.ts`: 9 성공. URL 초기 복원/빠른 입력,
  back/forward·키보드·실패 재시도·320px·200%·axe, 저장/재접속/충돌/peer-tab 계정 변경/대기 자료 연결.
- `PUBLIC_API_MODE=mock bunx playwright test --config tests/browser/integration.config.ts tests/browser/lawyer-api-mock.e2e.ts`:
  1 성공. 통합 로그인→동의→사진/PDF→저장·재접속→공개/디렉터리/다운로드→비공개/자료 삭제,
  실제 `/api/` network 0. 실제 OAuth 성공과 구분한다.
- `tests/lawyer-self-assets.test.ts`: 실제 SQLite/AES와 기존 upload/sanitizer 서비스에 합성 R2/native
  포트를 연결한 4 tests/40 assertions 성공. 재생성한 service persistence, 정제 사진/PDF byte,
  public reference/owner/purpose/role/현재 동의/삭제·stream 차단, 저장 전 자기 자료 읽기 검증.
- `bun run release:check`: 의도된 실패. 미승인 정책/게시·동의 버전 불일치와 미검토 release evidence를
  그대로 보고한다. 이번 검증 결과를 human receipt/공개 승인으로 입력하지 않는다.

4번 공유 PR 통합 후 고객→변호사로 바꾼 동일 owner의 사건/chat/private 자료 403, usage/delete 접근 유지,
기능 PR의 관련 CI와 새 full runner를 최신 main에서 재검증한다. 최종 병합은 4번이 맡는다.
