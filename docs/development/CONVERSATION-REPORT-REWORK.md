# 대화·법률 분석·리포트 개편 통합 기록

## 현재 통합 상태와 검증 기록

2026-11-02 KST 기준의 최종 통합 상태는 이 절과 [#621의 실제 실행 기록](https://github.com/creno-va/baro/issues/621)을 따른다. 아래 연혁의 “현재/남은” 표현은 각 기록 당시의 상태이며 실패 증거도 보존한다.

- 2026-11-02T07:20Z 재검증 기준 PR628~713와715 총87개가 병합됐고 main은 `3f83809289393f3bda47b4e3cfe991b043b8a742`(PR713)다.713 exact095c07cd의 Quality41399772310·Legal41399772356·native41399772289 SUCCESS와 최신 main ancestry를 확인해 정상 squash했다. main CI41400416558·native41400416516도 성공했다. 같은SHA 수동 full41400468393은 core/native/browser=실패/성공/실패이며 최종 완료가 아니다.00은 재개한#714의 만료 처리 계약을 수리하고03·04·05는 명시 배정한 독립 browser 실패를 수리한다. 마지막 exact head·새 최종 main SHA full/같은SHA preview 결과는[#621 실행 기록](https://github.com/creno-va/baro/issues/621)을 정본으로 남긴다.
- c9 수동 full41376225616은 종료/실패다. core5209 PASS/8 SKIP/0 FAIL·183276 assertions, DB/eval/build/local workerd는 통과한 뒤 raw audit16건(7 high/5 moderate/4 low)에서 실패했다. native는 실제 Docker PDF/ZIP2 PASS/174 assertions와 전체 native 검사를 통과했다. browser는727 PASS/2 FAIL이며 두 실패 모두 Chromium/WebKit의 방어→리포트만 저장 사진 첨부 link 확인이다. CSP 미도달·최종 join SKIP·성공 영수증0을 보존한다. ACA의722 PASS/3 WebKit FAIL 및 첫1fb의60분 취소와 구분한다.
- 00은 `codex/714-metadata-failure-boundary`에서 이 문서를 단독 소유한다. 공통 source GET 현재성707·초기 metadata/정상 basisnull 구분708·별도 진행 계약709·실제 facade 오류 진단710은 통합됐다.04의 새 진행 계약·유한 대기·명시 재확인 소비711도 통합됐고 담당은 동결한다.00은 후속 요청 내부 검증 원본 유지713을 검증한다.706의 로컬 actual28/shared4 PASS는 c9 full의 사진2 FAIL을 대체하지 않는다.05 공식 원문 링크704와 SHA별 PDF QA를 보존하며 다른 담당은 동결한다.
- c9 preview41376461804는 schema0022·9개 route smoke와 비공개 배포7482690686/status21137146315에 성공했다. recovery artifact13110939344의 정확한5개 필드·238B 원본·SHA와 시각을 검증했으며 복원 훈련 성공으로 표현하지 않는다. production 배포는 없다.
- 사용자 직접 로그인 뒤 합성 청구·방어의 실제 intake/요약과 청구 재조율·원격 TXT 처리를 확인했다. 실제 분석 POLICY_REJECTED·queued send409를 보존하고 새 모델 재시도로 숨기지 않았다. c9에서 읽기 상태와 inline 리포트를 확인했고 실제 청구/방어 PDF 각각3쪽을 내려받아 Poppler 전페이지 시각 검토했다. 양쪽 입장 각각 웹/HTML의13개 본문과 PDF의 정규화된13개 본문이 일치했다. PDF 전후 기존 policy model receipt3건과 chat job 집합이 바뀌지 않았다. 실제 법률 분석 성공·전체 OAuth/철회·기기·법률 승인을 주장하지 않는다. 방어 후속 선택은710 preview에서 client timeout을 확인했다. 쓰기 없는 재조회에서는 세 선택이 미선택 상태였으며 어느 façade 단계인지는 아직 미확정이다.712의 유한 단계와713의 요청 원본 유지를 새 최종 preview에서 구분해 검증한다.
- 비용 관측 전용, 실제 AI200/일·초기2×3·기술/시간/시도·owner/동의/암호화/삭제/revision/lease/독립 audit·ledger/hold를 유지한다. main 직접 push·새 채팅/하위 에이전트/자동화 생성·production 배포는 하지 않았다.

| 소유 담당 | 구현·선행 검증 PR 목록 |
| --- | --- |
| 00 통합 | [#628](https://github.com/creno-va/baro/pull/628), [#630](https://github.com/creno-va/baro/pull/630), [#634](https://github.com/creno-va/baro/pull/634), [#637](https://github.com/creno-va/baro/pull/637), [#640](https://github.com/creno-va/baro/pull/640), [#647](https://github.com/creno-va/baro/pull/647), [#650](https://github.com/creno-va/baro/pull/650), [#656](https://github.com/creno-va/baro/pull/656), [#661](https://github.com/creno-va/baro/pull/661), [#665](https://github.com/creno-va/baro/pull/665), [#669](https://github.com/creno-va/baro/pull/669), [#675](https://github.com/creno-va/baro/pull/675), [#676](https://github.com/creno-va/baro/pull/676), [#677](https://github.com/creno-va/baro/pull/677), [#678](https://github.com/creno-va/baro/pull/678), [#679](https://github.com/creno-va/baro/pull/679), [#682](https://github.com/creno-va/baro/pull/682), [#684](https://github.com/creno-va/baro/pull/684), [#685](https://github.com/creno-va/baro/pull/685), [#686](https://github.com/creno-va/baro/pull/686), [#687](https://github.com/creno-va/baro/pull/687), [#688](https://github.com/creno-va/baro/pull/688), [#689](https://github.com/creno-va/baro/pull/689), [#691](https://github.com/creno-va/baro/pull/691), [#692](https://github.com/creno-va/baro/pull/692), [#695](https://github.com/creno-va/baro/pull/695), [#696](https://github.com/creno-va/baro/pull/696), [#700](https://github.com/creno-va/baro/pull/700), [#702](https://github.com/creno-va/baro/pull/702), [#705](https://github.com/creno-va/baro/pull/705), [#707](https://github.com/creno-va/baro/pull/707), [#709](https://github.com/creno-va/baro/pull/709), [#713](https://github.com/creno-va/baro/pull/713), [#715](https://github.com/creno-va/baro/pull/715), [#716](https://github.com/creno-va/baro/pull/716) (이 기록 PR) |
| 01 사건정리 | [#636](https://github.com/creno-va/baro/pull/636), [#646](https://github.com/creno-va/baro/pull/646), [#649](https://github.com/creno-va/baro/pull/649), [#654](https://github.com/creno-va/baro/pull/654), [#655](https://github.com/creno-va/baro/pull/655), [#662](https://github.com/creno-va/baro/pull/662), [#666](https://github.com/creno-va/baro/pull/666), [#670](https://github.com/creno-va/baro/pull/670), [#674](https://github.com/creno-va/baro/pull/674), [#683](https://github.com/creno-va/baro/pull/683), [#690](https://github.com/creno-va/baro/pull/690), [#703](https://github.com/creno-va/baro/pull/703) |
| 02 법률근거 | [#631](https://github.com/creno-va/baro/pull/631), [#638](https://github.com/creno-va/baro/pull/638), [#644](https://github.com/creno-va/baro/pull/644), [#652](https://github.com/creno-va/baro/pull/652), [#658](https://github.com/creno-va/baro/pull/658) |
| 03 자료분석 | [#629](https://github.com/creno-va/baro/pull/629), [#635](https://github.com/creno-va/baro/pull/635), [#664](https://github.com/creno-va/baro/pull/664), [#671](https://github.com/creno-va/baro/pull/671), [#698](https://github.com/creno-va/baro/pull/698) |
| 04 대화에이전트 | [#633](https://github.com/creno-va/baro/pull/633), [#642](https://github.com/creno-va/baro/pull/642), [#660](https://github.com/creno-va/baro/pull/660), [#672](https://github.com/creno-va/baro/pull/672), [#701](https://github.com/creno-va/baro/pull/701), [#706](https://github.com/creno-va/baro/pull/706), [#711](https://github.com/creno-va/baro/pull/711) |
| 05 리포트 | [#641](https://github.com/creno-va/baro/pull/641), [#657](https://github.com/creno-va/baro/pull/657), [#659](https://github.com/creno-va/baro/pull/659), [#663](https://github.com/creno-va/baro/pull/663), [#668](https://github.com/creno-va/baro/pull/668), [#673](https://github.com/creno-va/baro/pull/673), [#680](https://github.com/creno-va/baro/pull/680), [#694](https://github.com/creno-va/baro/pull/694), [#699](https://github.com/creno-va/baro/pull/699), [#704](https://github.com/creno-va/baro/pull/704) |
| 06 후속해결 | [#632](https://github.com/creno-va/baro/pull/632), [#639](https://github.com/creno-va/baro/pull/639), [#643](https://github.com/creno-va/baro/pull/643), [#645](https://github.com/creno-va/baro/pull/645), [#648](https://github.com/creno-va/baro/pull/648), [#651](https://github.com/creno-va/baro/pull/651), [#653](https://github.com/creno-va/baro/pull/653), [#667](https://github.com/creno-va/baro/pull/667), [#681](https://github.com/creno-va/baro/pull/681), [#693](https://github.com/creno-va/baro/pull/693), [#697](https://github.com/creno-va/baro/pull/697), [#708](https://github.com/creno-va/baro/pull/708), [#710](https://github.com/creno-va/baro/pull/710), [#712](https://github.com/creno-va/baro/pull/712) |

| 검증 범위 | 실제 결과와 경계 |
| --- | --- |
| 전체 unit 사전 검증 | PR688 exact7a391954:5067 pass/4 opt-in skip/0 fail·181914 assertions,221.55s |
| PDF 저장 CAS 기준 유지 | PR691 exact90a42c57:5101 pass/4 opt-in skip/0 fail·182224 assertions,207.23s.별도 native PDF5/293·DB/neutral47/1108·작업량12/538 PASS |
| source 변경 summary HTTP/client | PR686:62 tests343 assertions,first/midfragment 복구·일반409/503·동일W손상·owner/abort·최대3 GET |
| 구형·설치 client/조회량 | PR686 이후47/362 및86/2204 PASS,기존 bounded 조회·삭제 기대 유지 |
| actual 요약 확인·재조율 | exactc23ee86a Chromium6/WebKit6 PASS,summary transport/browser각42 완전JSON·불완전0.원래WK1원인미확정 보존 |
| 업로드 원본 hash projection | PR687:수정 전3실패→공유/native upload·ACK복구·Workspace77/396 PASS,optional absence 허용·malformed 거절 |
| 변경별 기본 검사 | 각 PR bun ci·validate:quick와필요 DB drift/fresh/upgrade·build/workerd를 아래 연혁에 기록 |
| 전체 대화14·최종 화면/PDF | PR642 exact7282d155의3CI SUCCESS→main0290957c. actual C14/3.5m·W14/3.8m, 격리각17·공통mock각2=각33 PASS. 양 입장×후속3·자료/사진·재확인·자동 분석·PDF·초안 검토 저장/다운로드·실패/ACK/권한 경계. 최종 main 수동 full은 별도 실행 |
| 양 입장 native PDF→원본 ZIP | PR694 exact019fddbf:2 PASS150 assertions. plan415 유지·full stream414/HTTP 포함417. PDF52083/52498bytes 각4쪽·HTML83/85개본문 누락0·해시/CRC/원본 바이트 PASS.00이 CI artifact의 전체8쪽 렌더 확인 |
| 최종 exact main 수동 full | 1fb41357435897:60분 제한 취소. 전체Bun5192/182906·native2/163·DB/eval/build PASS, 브라우저 회귀 발견. raw audit/CSP/전체native 미도달·성공receipt0. 수리 후 최종SHA를#621에기록 |
| raw audit 사전 관측 | exit1·16건(7 high/5 moderate/4 low). 기존 #339의 사용자 범위 종료/보완·원본 실패를 보존하며 allowlist·버전 조작·audit 생략 없음. 최종 full의 실제 결과와 구분 |
| 같은 SHA preview | 1fb41357811030 SUCCESS: migration0022·release/schema·9route smoke와 실제 복구 bookmark artifact. full 성공/비공개 OAuth·공급자·법률 인수와 구분. 최종 수정SHA 재실행 필요, production0 |

실제 모델 의미 품질·공식 법률 API의 새 맥락 결과·기기 카메라/OAuth·원격 R2/Container와 독립 법률/공개 승인은 합성 포트 성공으로 승격하지 않는다.06이 실제로 관찰한 공식 안내11건은 update_pending/image_omitted 제한을 보존하며 조건 변경 전 반복하지 않고 정식 소장/답변/항소 서식 검증 성공으로 기록하지 않는다. 기존 정책의 service-content 수용·운영자/사업자 사실과 독립 법률 승인을 구분하며, 이번 개편의 분석/초안 고지는 사용자별 검토 범위·공식 근거/미확인 상태를 표시한다.

- 사용자 지시: 2026-11-01. 상위 [#620](https://github.com/creno-va/baro/issues/620).
- 단독 변경 소유자: **BARO-REWORK-00 통합**. 각 담당은 이 문서를 직접 수정하지 않고 변경 명세·검증 결과를00에 전달한다.
- 기준 main: `4a5bfe85d2f53d15812f592f9261a5b84767695c` / PR619 / main CI41289887458 SUCCESS. 실행 시 재확인한다.
- 통합 전용 checkout: `/Users/hwang-eunchan/.codex/worktrees/9cd5/baro`, 깨끗한 최신 main에서 `codex/621-rework-state` 생성.
- 기존 #600은 CLOSED, 열린 PR0개 확인. PR618/619까지의 UI·동의·DB 전환 변경을 보존한다. 다른 worktree·secret·이전 리포트·원장을 초기화하지 않는다.
- `bun run work:next`: 56 tasks, no cycles. pinned Bun1.4.0 설치 후 `bun ci` 통과.
- 계약 PR628: exact head `faa7bbd96256ee5e2439ad2e7ff28ee5aec23657`, CI41297706438·Legal41297706429 SUCCESS → main `b5b7de06554fa939bf4b61448240227c4008d311` 정상 병합.01~06에 전달하고 각 의존 구현을 시작했다.00 후속 브랜치는 `codex/621-rework-runtime`.
- 공통 client/intent·Worker 부팅 수정 PR630: head `3d517033fe596556d814335e27006eacab03a3a9`, CI41298727259 SUCCESS → main `3df82be88250aba72b9b8018c668e4e7a46f1d55`, main CI41299045604 SUCCESS. 자료 PR629: head `dec7cc2f1e66ab087fe22535ef205d73be07e470`, CI41299129134 SUCCESS → main `b56c000b55c65e42aef23038e162fdaa2cc1c677` 정상 병합.04/05에 실제 재사용 컴포넌트 import 선행 충족을 전달했다.
-00의 저장 후속 브랜치: `codex/621-rework-storage`, 원격 main의 위 두 PR을 통합했다.0022는00만 배정한다. 기존 목적 enum을 무관한 report/summary snapshot으로 위장하지 않기 위해 필요한 암호화 메타데이터 기록/조각 두 테이블만 추가한다. 기존 사실·자료·리포트 DB를 복제하지 않는다.
- 새 채팅·하위 에이전트·자동화 생성 없음. 사용자가 만든 아래 여섯 채팅과 이번 개편 메시지 교환만 허용된다. 메모리 자동 공유를 가정하지 않는다.
- GitHub 커넥터 이슈 생성은403, 인증된 GitHub CLI로 이슈를 생성했다. 채팅 도구가 불가하면 각 하위 이슈 댓글로 조율하고 개인정보는 쓰지 않는다.

- 저장 PR634: head `03eff2aa696335c5f28faad38b4a0b5f50f6a571`, Quality41299707708 SUCCESS → main `bffb5887a64b472e5fb8a39e03a29c10a2ab4761`.0022 적용은 로컬 fresh/upgrade 검증만 수행했고 원격 DB/배포는 하지 않았다.
- 대화 코어 PR633: 최신 main 통합 head `6ea899cea93acdbf5d01222731ced5750365ea55`, Quality41300231923·Legal41300231955 SUCCESS → main `4fc4db00` 정상 병합. 법률 분석 PR631: head `57ad8db31b20442f60451d054b4784647e692e14`, Quality41300646086·Legal41300646132 SUCCESS → main `7a97be35` 정상 병합.
-00 후속 `codex/621-rework-api`: opt-in 사건 생성/context 변경을 같은 암호화 DB admission/CAS에 연결한다. 기존 사건의 목적/절차는 미확정이며 기존 strict workspace 응답은 확장하지 않는다. context 변경·멱등 영수증·revision bump가 원자적으로 저장되고 동의 철회 후 mutation은 차단된다. 기존 raw payload를 덮어 목적을 추정하지 않는다.
- 중앙 gateway는 02의 `workspace_legal_plan / workspace_legal_analysis / workspace_legal_audit` 세 단계를 등록한다. 동일 모델·기존 attempt ledger를 유지하며 generation LOW / 독립 audit MEDIUM이다. 04의 trusted conversation prompt는 중앙 registry에서만 선택한다. 신규 strict provider wire는 `conversationIntent: null` 또는 허용 intent를 필수로 보내되 구형 저장 parser는 누락을 계속 읽는다.
-02 후속 `analysis/runtime-adapter.ts`는 실제 gateway/retrieval adapter(게시/DB 저장/dispatch 없음),06 후속 `resolution/runtime-adapter.ts`는 주입된 trusted source/authority와 실제 암호화 record adapter만 소유한다. DB/Hono/runtime 조립과 최종 source/basis CAS는00 소유를 유지한다. 각 후속은 선행 CI/main 뒤 별도 PR이다.

- 후속 해결 PR632: 최신 head `295c3f5edc882aad9a9f0c40e36049b470bbb52e`, Quality41300962279 SUCCESS → main `bcd37aea`. 자료 연결 PR635: 최신 head `a358ab1b2dd0c4b510607be1b26970e001a02948`, Quality41301290682 SUCCESS → main `11f398fba847f55634634babf339e5b4bf0bf8db`. 공통 API PR637: 최신 head `477ea968f352af964f2fa7b17e59e773faf96875`, Quality41301615008·Legal41301614807 SUCCESS → main `c629d6cc`.
-00 `codex/621-rework-orchestration`의 공통 저장 포트: `prepareReworkJobAdmission`이 기존 chat_response DTO를 유지하며 domain record/job/quota/paid hold/outbox를 같은 최종 claim에 게시한다. 분석은 active/confirmed, 재조율은 최초 reviewing_summary와 active/confirmed 양쪽을 허용한다. `prepareReconciledSummary`는 큰 요약을 봉인한 뒤 canonical 요약과 확인 영수증을 같은 claim에 게시한다. 취소·실패한 이전 미게시 staging은 정본·이전 리포트와 구분하며 폐기된 staging이 다음 확인을 막지 않는다. 구형 정본과 immutable 제안 이력은 보존한다.
- 분석 task는 서버가 암호화한 job/operation/target/before/summary identity가 일치할 때만 technical revision을 연구 기준에서 제외한다. 다른 mutation·요약/자료 변경·구형 일반 chat은 제외하지 않는다. queued/running 작업 중 UI receipt/continuation은 제한된 metadata capability만 쓰며 analysis/정본 게시, revision bump, SQL hook에는 사용할 수 없다. 재조율 취소의 job/hold/receipt 원자 처리는00 runtime 포트가 전담한다.

## 요구사항과 유지 경계

1. `/app` 주 선택은 고소·청구 준비 / 상대방 주장 대응이다. `subjectContext` 개인/기업, 사건 분야·형민사, 절차 단계와 별개다. 옛 사건의 목적·단계를 추정해 확정하지 않는다.
2. canonical 요약 raw text 편집 대신 정확한지 확인하고, 수정/추가 설명을 받으면 AI 변경 제안을 만들고 사용자가 재확인한다. 제안 자체는 정본을 바꾸지 않는다.
3. 대화 종료 시 현재 사건과 증거에 기반한 검토 가능한 리포트를 준비한다. 법 조항·요건별 사실/자료·미확인 사항, 유사 판례의 구체적 공통점/차이점, 우리 측 약점과 보완 자료를 포함한다.
4. 법령/판례는 사건 맥락으로 자동 조사한다. 일반 판례 탐색 결과·readToken은 검증된 리포트 citation이 아니다. 공식 원문 검증·이용 권한·주장 binding·원문 hash·독립 감사·snapshot 저장 경계를02와 해결한다.
5. 자료 탭·대화·리포트가 같은 업로드·검토·사진 촬영 경로를 사용한다. 업로드 완료·분석 완료·사건에 반영은 각각 표시한다. 진단·인과관계·사진 시각·증거 진정성을 만들어내지 않는다.
6. 대화에서 조회·검토·확인·실행을 이어가고 리포트 후 직접 해결 / 변호사와 해결 / 리포트만 저장으로 분기한다. 직접 해결은 실제 절차·제출처·담당기관·검토용 문서 초안이며 사용자 대신 제출·연락하지 않는다.
7. 추가 증거·요약/목적 변경은 분석 기준 revision을 갱신하고 이전 리포트를 보존한다. 자료 부족·검색 실패·관련 판례 없음·공급자 오류를 빈 성공이나 근거 조작으로 숨기지 않는다.
8. 웹 우선, 설치된 네이티브/strict DTO·구형 사건/리포트 읽기·계정 전환·동의 철회·삭제·업로드 복구·실제 오류를 보존한다.

비용 관측 전용·AI200/일·초기 질문2×3·실제 물량/메모리/시간/시도 제한·owner/동의/암호화/삭제/revision/lease/독립 audit를 유지한다. 모델은 llm-gateway, 법률 조회는 legal-retrieval만 경유한다. 기존 공급자·모델·결제 경로만 사용한다. 실제 외부 키 없이 offline 구현/PR을 완료하되 실제 인수를 구분한다. main 직접 push·이번 production 배포는 없다.

## 채팅과 이슈·소유권

실제 thread 도구로 제목과 ID/host를 확인했다. 표의 브랜치는 담당의 최종 보고로 갱신한다.

| 세션 제목 | thread ID / host | 이슈·브랜치 | 소유 범위 | PR/상태 |
| --- | --- | --- | --- | --- |
| BARO-REWORK-00 통합 | `01a1969a-2358-7bc3-be20-f37be534c897` / local | #621 / `codex/621-rework-continuation-progress` | 공통 계약/DB/중앙 client·gateway·router·전역 shell/token·실행문서/PRD/ADR | PR628~708 merged; common707 source fence integrated; exact-SHA evidence in #621 |
| BARO-REWORK-01 사건정리 | `01a1969a-845b-7381-9353-35f61e9a740e` / local | #622 / `codex/622-final-intake-regressions` | CaseInput, IntakeQuestions, SummaryReview, 독립 재조율 UI/service/client/mock, 해당 CSS/tests | PR636-690 and703 merged; intake28/customer9 per engine, focus/320px PASS; frozen |
| BARO-REWORK-02 법률근거 | `01a1969a-e609-7b53-b4fd-c005a5823052` / local | #623 / `codex/623-hono-legal-fixtures` | legal-retrieval/analysis/*, 전용 analysis prompt/helper·tests/fixture | PR631/638/644/652/658 merged; legal binding/rights/TTL/audit preserved; PR702 independent review complete; frozen |
| BARO-REWORK-03 자료분석 | `01a1969b-76c9-7223-94c1-619b8d81cef9` / local | #624 / `codex/624-full-browser-recovery` | FileReview, CaseMaterials, ChatAttachments, EvidencePicker/EvidenceUpload/useEvidenceUpload/evidence-state, evidence.css·tests | PR629/635/664/671/698 merged; attachments17/correction7 per engine PASS; device/provider acceptance separate; frozen |
| BARO-REWORK-04 대화에이전트 | `01a1969c-6a7f-71c2-9c1a-0f8e2743d9bd` / local | #625 / `codex/625-photo-send-revision` | Workspace.tsx·대화 components/workspace service/context/pipeline/execution/stored-message·일반 prompts·영역 CSS/tests | PR633/642/660/672/701/706 merged; PR711 merged: actual32/Agent42/shared4 PASS; exact CI/main verified; frozen; final main full separate |
| BARO-REWORK-05 리포트 | `01a1969c-c6f0-7122-8f39-c6ac535fa494` / local | #626 / `codex/626-report-official-source-links` | ReportReview/ReportReading·reports 독립 본문/HTML/PDF/service/helpers·CSS/tests | PR641-694/699/704 merged; ACA10PDF40p read-only QA complete; product frozen |
| BARO-REWORK-06 후속해결 | `01a1969e-174c-7280-81ac-eb9813ebffb2` / local | #627 / `codex/627-resolution-failure-step` | resolution 독립 서비스/재사용 UI·초안 prompt/helper·영역 CSS/tests | PR632-693/697/708/710/712 merged; C46/W46=92 PASS, finite facade failure step; frozen |

한 파일 한 소유자다.03/06은 Workspace.tsx·ReportReview.tsx를 수정하지 않는다. 공통 src/contracts/, src/server/db/, drizzle/, 공통 API/client·facade·export, gateway service/중앙 schemas/등록, router/runtime 조립은00만 변경한다. 기존 `src/server/api/v2/workspaces.ts`는00 소유이며01은 독립 재조율 서비스를 제공한다. handler 신설/위임은 정확 경로를 먼저 기록한다.

전용 `llm-gateway/intake-prompts.ts`는01, `conversation-prompts.ts`는04, `analysis-prompts.ts`/analysis-schema.ts는02, resolution-prompts.ts는06이다. Phase/중앙 registry가 섞인 기존 `prompts.ts`는00 소유로 정리하고04가 작성한 일반 prompt 변경은 독립 helper와 패치 명세로 전달받는다.05는 `scripts/report-regressions.ts`·합성 리포트 QA script/Python을 소유한다. `.github/workflows/report-rendering.yml`은 PDF 선행 검증 당시05에 배정했으며715부터 공통 DB/모듈 실행 경계의00 단독 소유로 회수했다.05는 해당 파일과 제품을 동결하고 원래 고정 Linux/PDF 보안 검사는 유지한다.

## 계약과 의존성

계약 버전: `conversation-report-v1`.01~06이 실제 파일을 읽고 필수 blocker 없음/수용을 회신했다. 기존 v1/v2 wire 객체에 새 필드를 무조건 추가하지 않는다. 명시적 새 경로/opt-in DTO에서만 새 기능을 노출하며 설치 클라이언트의 이전 응답을 보존한다. 첫 계약 PR은 DB migration/제품 실행 경로 변경을 포함하지 않는다. `src/contracts/v2/rework.ts`, `legal-analysis.ts`, `resolution.ts`, `conversation-state.ts`가 정본이며 기존 sourceClaim shape는 그대로 추출해 서버가 재사용한다.

HTTP 계획: 새 사건 `POST /api/v2/cases/rework`에서 목적과 사건을 같은 admission에 저장한다. 사건별 경로는 `/api/v2/cases/:id/rework` 아래 context, reconciliation, conversation/actions, resolution/draft로 분리한다. 기존 `api.cases.create`·reports.get 동작은 보존하며 `api.rework`에 새 client를 조립한다. 리포트 상태 조회는 `peek`으로 읽기만 하고 준비/생성은 명시적 액션이다.01 재조율(read/admit/claim/generate/audit/publish/fail/confirm/cancel),02 분석(plan/analyze/audit),04 오케스트레이터,05 readPreparedAnalysis/peek,06 load/authorize/saveCAS는 DI로 제공하고00이 DB/gateway/runtime/router를 연결한다.

| 계약 | 합의 방향 | 상태 |
| --- | --- | --- |
| 사건 맥락 | `casePurpose: prepare_claim / respond_to_claim / unconfirmed`; subjectContext와 별개, 구형 unconfirmed. 절차 단계는 사용자 확인 전 미확정 | 01~06 수용·계약 병합 완료 |
| 재조율 | 요청·이유·exact before/after 제안·base workspace/intake/summary revisions·재접속·멱등성·취소·명시 confirm CAS. 확정 전 canonical summary 불변 | 01 인터페이스 수용,00 저장/중앙gateway 조립 |
| 법률 분석 | 기존 공식 citation/sourceClaim shape 재사용. 요건별 fact/evidence refs·공백/모순, 판례 commonalities/differences·exact sourceClaim IDs, 약점/대응점·추가자료 | 02/05/06 소비 검증 완료·실제 원문 권한/binding/TTL 유지 |
| 분석 기준 | summaryRevision·관련 사건 revision·증거 fileRevision/hash digest·casePurpose·asOfDate. 비교 표시용 revision을 사실 변경과 구분 | 암호화 source-neutral proof/최종 CAS·재조율·증거/입장 변경 경계 구현·검증 |
| 증거 | 기존 files strict DTO 유지. 명시적 requirement.fileIds와 현재 파일/관찰로 대기/처리/검토/반영 계산, 파일명 유형 추측 금지 | 03 인터페이스 수용 |
| 준비 상태 | pending/running/partial/ready/empty/unavailable/stale·실제 실패 구분. 완결성·부족 항목과 snapshot 기준 표시 | 04/05 수용·중앙 실행/저장 snapshot·export 조립 병합 |
| 대화/후속 | 서버 action allowlist·입력과 확인·3개 분기·실제 절차/검토용 초안·citation/analysis 기준, 제3자 자동 실행 없음 | 04/06 수용·후속 API/저장/명시 확인·draft 조립 병합 |

선행 계약의 CI 성공/main 병합→01/02/03/06 병렬 구현→필요한 공유 저장/gateway 조립→04/05 최종 통합 순서다.04/05는 명시적 독립 fixture/UI를 먼저 진행할 수 있다.02→06(근거 기반 안내/초안),01/02/03/06→04,02/03→05,04→05의 실제 의존성은 작은 인터페이스로 나누고 순환 구현 복제를 만들지 않는다. 기능 담당은 PR까지만 제출하고00이 CI·main/의존 PR 상태를 재확인한 뒤 순차 병합한다.

## 제품·정책·디자인

ADR-0006의 사실 준비 전용/완성 문서 일괄 거절, PRD/MVP·AI prompt의 blanket strategy refusal가 이번 요청과 충돌한다. 새 ADR과 PRD/MVP에 이번 범위의 근거 기반 분석·취약점/대응점·검토용 문서 초안을 명시한다. 확정 법률 판단·결과/승소 보장·근거 조작·불리한 자료 은폐·사용자 대신 제출/연락은 허용하지 않는다. 초안 인수·사용자 제품 방향 승인을 독립 법률 승인으로 바꾸지 않고 기존 공개 gate를 우회하지 않는다.

디자인 기준은 docs/design/PRODUCT-UI.md, CONVERSATION-UI.md와 현재 /app·Workspace·ReportReview다. #2364e8/#191f28/#f6f8fb, Pretendard, Lucide, 공통 버튼/Dialog/상태 UI, 주요44px 이상 터치 영역·읽기 열을 유지한다. 개인/기업 맥락과 목적을 혼동하지 않고 별도 브랜드나 디자인 체계를 만들지 않는다. 랜딩은 범위 밖, 담당별 영역 CSS를 사용한다. 코드·실제 기준 화면 비교는 담당 브라우저 검증과 최종 통합에서 기록한다.

## 선행 검증과 미해결 연혁

이 표는 계약·저장 선행 작업 당시의 기록이다. 최신 완료 여부와 남은 외부 조건은 문서 맨 위 표와#621을 따른다.

| 범위 | 실행/결과 | 남은 일 |
| --- | --- | --- |
| 시작 상태 | main SHA/CI·열린 PR0·#600 CLOSED·work:next·clean branch·bun ci 확인 | 계약 구현/담당 확인 |
| 계약 PR | bun ci·validate:quick exit0. 계약/기존 v2 44개422assertions, 관련 retrieval/설치 cases/reports client135개729assertions 통과. 계약 타입·lint·diff 통과 | CI/main 병합 뒤 제품 구현 시작; build/DB 변경 없음 |
| 클라이언트/실행 연결 선행 | bun ci·validate:quick·validate:build 및 실제 local workerd 익명 로그인 부팅 통과. scope/owner/동의/취소/요청 복구·challenge 회전 검증 | PR CI/main 후 담당 UI가 새 namespace를 사용한다. 실제 서버 조립은 다음 PR |
| 암호화 상태 저장 선행 | bun ci·validate:quick·validate:build·validate:db 통과. drift/fresh/upgrade·실제 local D1 import/재적용 확인. multi-part/CAS/소유/철회/삭제/변조/lease 만료/원자 receipt·0021→0022 보존9개34 assertions, 관련 저장/fixture72개436 assertions 통과 | PR CI/main 뒤 도메인 adapter 연결. 실제 원격 DB 변경/배포 없음 |
| 최종 통합 | 미실행 | 양쪽 목적·후속3경로·자료/재조율/revision·실패/계정 전환·삭제를 브라우저 확인 |
| 실제 PDF | 미실행 | 웹/HTML/PDF 근거 일치·전체 페이지 렌더/시각 검토 |
| 최종 main | 미정 | 정확 SHA의 수동 validate:full, 기존 운영 증거·필요 제한 preview smoke. production 배포 없음 |
| 실제 외부 | 이번 작업에서는 미검증 | OAuth·공급자/공식 법률 API·실기기·정책/독립 법률 승인/공개 gate를 합성 결과와 구분 |

첫 계약 PR이나 fixture 성공을 전체 완료로 표시하지 않는다. 이 문서의 PR/CI/main SHA·검증·미해결을 최종까지 계속 갱신한다.

PR628 이후 실제 build 검사에서 export 문자열 상수가 Worker entry로 hoist되어 부팅이 실패했다. primitive export를 제거하고 `v2ReworkVersionSchema.value`를 사용한다. 그 뒤 별도 SSR 청크의 workspace schema 초기화 전 `.extend` 접근 실패를 확인해 새 create 요청은 공유 primitive로 독립 정의하고 응답의 workspace는 lazy로 읽도록 고쳤다. 두 초기 실패는 실제 Worker 부팅 검사로 발견했으며 bundling/dry-run만의 성공과 구분한다. 수정 뒤 같은 local workerd 검사는 성공했다. 이미지 blob 미리보기를 위해 CSP img-src에 blob:만 허용하고 외부 host는 추가하지 않았다.


### 통합 경과 (2026-11-01)

00이 exact head CI 성공을 확인해 squash 병합한 PR: #628 계약/ADR, #630 공유 client와 Worker 부팅, #629 자료 UI, #634 암호화 불변 상태, #633 대화 core, #631 법률 분석, #632 후속 해결, #635 자료 callback, #637 사건 목적 API/gateway, #636 사건 정리/재확인, #638 법률 runtime adapter, #639 후속 저장 adapter, #640 원자 작업/요약 저장, #641 웹·HTML·PDF 리포트, #644 관찰 확실성, #643 공식 절차 근거. 현재 기준 main은 #643 병합 결과이며 최종 SHA가 아니다. #646 저장 adapter와 #645 후속 UI는 순차 최신 main CI 후 병합한다. #642는 통합 중 draft다.

00 공통 상태 PR은 소유자에 한정된 passive conversation/report peek, 전체 확정 요약·증거 hash와 관찰 qualifier를 보존하는 분석 입력, 정확 scope·공식 citation binding/TTL의 로컬 currentness 검사, 입장별 모델 맥락과 재조율 phase 등록을 제공한다. 동의 철회는 새 처리/수정을 막으며 기존 저장본의 currentness 읽기를 새 동의 gate로 막지 않는다. explicit mock은 실제 domain service를 재사용하지만 법률 결과를 unavailable로 명시하며 실제 provider/공식 검증 성공으로 표현하지 않는다. 초기/실행 JSON 입력 순서 차이로 저장된 wire 증명이 맞지 않던 회귀를 수정했다.

현재 검증: 공통 focused51 tests367 assertions, 네이티브 workerd의 기존 원장/업그레이드 보존4 tests1480 assertions, Chromium/WebKit 요청 Blob 원본 바이트·reload·owner별 삭제2 tests 통과. 네이티브 fixture는 과거 consent column/디렉터리 epoch를 해당 migration 이전 형태로 복원하고 실제 업그레이드 뒤 현재 원본과 일치함을 확인했다. 실제 consent 관측 시각이나 원장은 수정하지 않았다. 이 검증은 실제 외부 호출과 무관하다.

남은 구현은 중앙 분석/재조율 job 실행·자동 리포트 continuation, 원자 취소/receipt·동의/lease fencing, 대화 actions·후속 API의 실제 Hono 조립이다. 최종 6여정 브라우저와 exact main 수동 full 검증은 아직 미실행이다. 06이 확인한 실제 EasyLaw 원문들은 update_pending/image_omitted 제한을 유지하므로 현재 실제 formal complaint/answer/appeal 작성 가능 근거로 승격하지 않는다. 합성 fixture에서 검증된 작성 지원과 실제 원문 조건을 구분한다. production 배포는 하지 않는다.

후속 소유권: 06에 `src/server/modules/resolution/source-loader.ts`와 `tests/resolution-source-loader.test.ts`만 명시 위임했다. 네트워크/DB/Hono 조립 없이 authoritative analysis input·현재 snapshot·readonly report·재검증된 procedure 결과로 ResolutionSource를 만드는 pure helper이며 PR648로 제출됐다. fileNames/maskingTokens는00의 현재 owner 읽기에서 주입한다. 공통 기록/취소/receipt/실행·router는00 소유를 유지한다.

PR645의 정확 업데이트 head09cd9790 CI41306228656 성공 뒤 병합했다. PR647 첫 통합 CI에서 HTML/PDF native rendering41306517710이 구형 report-download-work 2개 호환 회귀로 실패했다. 모든 사건에 prepared analysis DI를 연결한 root 분기 누락이었다. 기존 fixture 기대값과 저장된 본문은 보존하고, 실제 암호화 case context의 명시 purpose가 있는 사건에만 per-case factory가 새 DI를 선택하도록 수정했다. 구형 기본 factory는 기존 source format을 유지한다. native D1 billing metadata 누락은 STORAGE_UNAVAILABLE로 실패하며 계정/소유/CAS/처리 동의 gate를 완화하지 않는다. 실패 2개 포함21검사597 assertions 및 factory/동의철회/native meter8검사75 assertions 재통과했고 전체 report285 회귀·quick/build를 재검증한다. 최종 CI 성공 전 이 PR은 병합하지 않는다.


### 중앙 실행 계층과 재개 검증

PR647은 최종 head8302c034의 Quality41307390432/Legal41307390403/native PDF41307390421 성공 후 main43d21cff에 병합했다. 이어 PR648/650/649/651/652/654/653을 각각 exact head의 CI 성공 후 순차 병합했다. 현재 통합 기준 main은13f2d51276070549831d9dd251a9147d5e9ccf37이며 최종 main SHA는 아니다. 개별 담당의 메모리 공유를 가정하지 않고 확인한 인터페이스·검증·의존 main을 해당 채팅으로 전달했다.

00의 codex/621-rework-execution은 실제 native gateway/원장에 분석 3단계와 재조율 생성·독립 감사를 연결한다. 예약과 실행이 같은 투영 입력·달력·고정 invocation을 사용하며, 원래 admission의 시간/금액을 새로 꾸미지 않는다. 재조율의 실제 발급 메시지 암호문·소유자·operation을 확인하고, 별도 isolate의 취소도 현재 job/lease/fencing과 정본 불변을 같은 claim에서 처리한다. summary 전체와 자료 coverage를 읽으며 일반 대화의 8개 fact window로 정본을 잘라내지 않는다.

분석 완료 후 report continuation은 원래 report revision CAS를 암호화한 등록 영수증으로 보존한 뒤 기존 reports.generate를 호출한다. 모델/법률 API를 export에 넣지 않는다. ACK 유실 재요청은 원래 report를 반환하며 이후 사용자가 수정한 리포트는 덮어쓰지 않는다. unavailable/empty와 실제 provider failure를 분리하고, 법률 근거가 준비되지 않은 리포트에는 그 한계를 표시한다. 사용자 편집 보고서는 검증된 새 analysis report로 재승격하지 않는다.

현재 focused 실행20 tests194 assertions, 기존 실제 workerd/D1/원장/업그레이드4 tests1480 assertions 통과. DB drift/fresh/upgrade 및 production build/local workerd 부팅 통과. quick 첫 검사에서 새 테스트의 nullable 타입 오류를 발견해 검사를 유지하며 명시적인 존재 확인으로 수정했고 quick 최종673 tests6286 assertions를 포함한 전체 profile이 성공했다. 이 계층의 callback/port 검증과 최종 중앙 Hono/브라우저 6여정 완료는 구분한다. 아직 중앙 action/후속 handler 조립·서버 자동 준비/재개·최종 browser/PDF/manual full은 남아 있다.


### 실제 중앙 API·자동 준비 조립

PR656 head6c148074f31ca801b6545a168c2cef4ba971b6cc의 Quality41313917239/Legal41313917258/nativePDF41313917231이 모두 성공해 mainb4c51583468c160d9b5b6277bed759decabea13a에 병합했다. PR657은85357f281b03b9c5bd2a0a40f6c9cb6f5ab7ee57의 Quality41314569832/nativePDF41314569810 성공 뒤 mainae054f493f1eb0ce64d739e15c7c874e8645fcdc, PR658은8299c97c8c91dcd475f3ee3a647d92eabd3878fd의 Quality41315267820/Legal41315267814 성공 뒤 main5a1e00748bddc2fcd1a285e2bb2375fc4d63c207, PR655는 최신 base 갱신 후 e40900d8e827286a8e8cb62a0741a0edc8546ecd의 Quality 성공 뒤 main708dbff143b8c42169a490f2e2a72435a3694083에 병합했다. PR659의374b05981846519cf8aec35783a73c02609b426b Quality41316730651/nativePDF41316730663 성공 뒤 main36211308eecc901a9ef5681d415c47cd1e9232ab에 병합했다. 모두00이 exact head로 순차 병합했으며 관리자 우회·main 직접 push·배포는 없다.

00 단독 소유 중앙 파일은 modules/rework/runtime.ts·resolution-runtime.ts와 기존 rework API/workspace API/runtime/dispatch 조립이다. 실제 Workflow는 기존 chat_response DTO와 outbox를 유지하면서 private analysis/reconciliation record에 따라 실행을 분기한다. 목적 opt-in이 없는 옛 사건은 자동 분석 대상으로 추정하지 않는다. 최초 요약·재조율 확인, 목적/절차 변경과 자료 처리 완료 뒤 준비를 재개하고, 브라우저가 닫혀도 기존 제품 dispatch scheduler의 bounded4/rotating scan으로 미완료 의도를 복구한다. GET/poll은 새 작업을 접수하지 않는다.

자동 의도는 사건 basis와 기술 설정만 구분한다. 가격/FX/funding/allocation 관측은 fingerprint나 실행 gate가 아니다. 같은 조건의 provider 실패는 자동 반복하지 않고 실제 AI 일일 한도 초기화만 새 일자의 별도 요청/CAS로 재개한다. 공급자 실패·필수 기술 설정 누락은 실패로 남기고, 준비 가능한 사실 리포트에는 법률 분석 미완료를 표시한다. 사용자 편집·추가 증거·절차/목적 변경은 원래 요청의 report CAS로 구분한다. 새 근거의 새 리포트와 이전 immutable 보고서를 보존한다.

대화 actions는 owner/case/request 전체 hash와 HTTP key 바인딩을 유지하고 durable paid receipt를 expectedRevision보다 먼저 재확인한다. 후속 handler는 실제 resolution 저장 adapter, 현재 report/analysis/source/input/scope와 최종 시각의 binding·TTL·권한·session/CAS를 사용한다. 저장 citation·원문·리포트 snapshot identity를 그대로 동결하고 새 시각을 만들어 승격하지 않는다. 재조율의 늦은 사용자 확정도 공식 출처를 재검증하며, 감사 뒤 TTL이 만료되면 같은 live request/job/lease에서 실패 metadata만 기록한다. 삭제된 correction source의 취소와 terminal Workflow 실패 후 retire는 정본을 바꾸지 않는다. 해당 private job은 구형 chat retry로 다시 실행하지 않는다.

현재 actual signed Hono/DB/AES의 두 입장×후속3선택, 실제 초안/저장 handler·멱등 replay·동의철회 저장본 읽기/새 쓰기 차단·계정 전환, 자동 준비/실패/AI 일자 복구·증거 변경·이전 report 보존·실제 native plan/analyze/independent audit/공식 파서·binding→report/HTML 일치15 tests162 assertions를 통과했다. 재조율 actual native·독립 audit·other-isolate cancel·issued source 삭제·actual terminal recovery·사용자 지연 확정 TTL·감사 뒤 자연 만료9 tests86 assertions를 통과했다. native workerd/기존 복구51 tests1896 assertions, quick 전체 profile(마지막673 tests6286 assertions 묶음 포함), DB drift/fresh/upgrade를 통과했다. 초기 중앙 분기 반환 type이 기존 내부 stageTimings 추론을 좁히는 typecheck 실패를 보존하고, 실제 metadata 타입을 유지하는 반환 선언으로 수정했다. 현재 tree production build/local workerd 재확인 중이다.

최종 검증용 test-only 파일 소유권을 명시 배정했다.04는 tests/helpers/rework-native-model.ts(외부 모델 출력만)·rework-runtime-fixture.ts(같은 중앙 제품 factory에 서명 session/Hono/DB/AES/원장을 그대로 조립)·기존 loopback/browser harness를 소유한다.03은 tests/helpers/rework-native-processor.ts의 외부 native probe/process transport만 소유하고 DB/job/admission/cost를 대체하지 않는다.05는 tests/helpers/rework-pdf-processor.ts의 격리 Docker에서 제품 report.py를 실제 실행하는 PDF transport만 소유한다.04가03/05 helper를 재사용하며 도메인 로직·DTO 응답을 복제하지 않는다. 실제 PDF 파싱/카메라/provider 인수와 정확 bytes의 합성 upstream 처리를 구분한다. 중앙 제품 파일은 계속00 소유다.

전체 intake2×3→재조율/확인→자료/사진→공식 근거 분석→report→후속6여정 browser와 실제 최종PDF 생성·렌더·검토, exact 최종 main manual validate:full은 아직 남아 있다. 합성 native/공식 source·model 검증은 실제 계정 provider/OAuth/법률 승인·공개 gate 성공이 아니다.

중앙 Workflow dispatcher에 HTTP에서 선택할 수 없는 5번째 constructor options를 연결해 offline source transport와 같은 report factory를 실제 production dispatcher가 소비한다. 기본4인자 운영 동작은 같다. 최종 fixture가 private job 선택 분기를 복제하거나 실제 외부 법률 API로 유출되지 않도록 하는 포트이며, signed Hono 검사의 모든 job drain도 이 dispatcher로 바꿨다. 기존 runtime9+새중앙15 =24 tests240 assertions 재통과. PR661은 이 작은 포트까지 포함한 새 head로 CI를 다시 확인한다.

자동 준비도 기존 ANALYSIS_ACCOUNT_LIMIT를 paid admission 전에 검사한다. 실제 rate 제한 중에는 미접수 의도를 보존해 다음 허용 시 재개하며 provider 호출/작업을 만들지 않는다. 이 검사 추가 뒤 중앙 actual dispatcher16 tests168 assertions 통과(기존 두 목적의 법령·판례/요건·비교/HTML 일치 포함). 가격·재원 관측을 이 경계에 섞지 않는다.

### 전체 검증 준비와 실제 네이티브 포트 (2026-11-02)

PR661 최종 head83d56e2f134e0e8038e892602a42b6b007e4f26d의 Quality41318509274/Legal41318509293/nativePDF41318509282 성공 후 main8f72e392f1996cba4ed963de8e84d0b6af4976f0에 병합했다. production build/local workerd 부팅도 성공했다. PR660 최종8174be4e859fc56f6c883bfbcc1a8ca20ea8bb57의 3개 CI 성공 후 maindcae393fc0bbb6f070e99a359cfeb9b0294d12a0, PR662 최종db225c75dfcf04410b22269eb602ceed881b8ccf의 Quality 성공 후 main8ff896a43f9786944a71dea3d69005df4f9c99ae에 병합했다. PR663 최종ee2a66b97601d9a54566ecee617b18f135af5d33의 Quality41320026615/Legal41320026562/nativePDF41320026548 성공 후 main04754d64c8f5fc38f65e05e65046b48c9fbe8ebe에 병합했다. PR664는 최신 main base로 갱신해 CI 재검증 중이다. 최종 main SHA는 아직 아니다.

660은 외부 모델 출력 포트만 제공하며 실제 initial 2×3/요약/native wire/audit를 소비하는 5 tests40 assertions를 통과했다. 663은 격리 Docker의 실제 제품 report.py를 실행하는 PDF transport이며 실제 native 4 tests17 assertions를 통과했다. 664의 byte/hash 기반 사진·텍스트 처리 포트는 8 tests115 assertions를 통과했으며 등록된 PDF bytes의 합성 페이지 처리를 실제 PDF parser 인수로 표현하지 않는다. 이 포트들은 DB/원장/admission/lease를 대체하지 않는다.

00의 `codex/621-rework-validation`은 전체 검사에서 발견한 기존 fixture drift를 test-only로 수정한다. 최초 unit 실행은 4,931 pass/29 fail이었다. 과거 consent 컬럼, SQL wall clock과 선언된 합성 fixture 월의 불일치, 삭제 journal 스케줄, 현재 한 개 선택 계약과 구형 30개 자산 보존 검사의 혼동이 원인이었다. native D1 복사는 source fixture의 선언 월로 초기화하고 파생 mirror는 실제 trigger로 재구성한다. retired consent 컬럼은 과거 migration target에서만 복원한다. 합성 cleanup schedule만 fixture 시간으로 맞추며 provider/funding/billing 관측 시각·금액·원장은 수정하지 않는다. 구형 30개 자산 보존과 D1 100 parameters 경계 검사를 유지하고 새 30개 선택 거절도 확인한다.

수정 후 전체 unit 4,965 tests180,888 assertions/0 fail, bun ci 및 validate:quick 전체 profile(마지막673 tests6,286 assertions 포함)이 성공했다. 관련 실제 native D1/삭제/자산 focused38 tests978 assertions도 성공했다. 이 변경은 제품 코드·schema·migration·비용 정책을 변경하지 않는다. 최종 main의 수동 full과 별개인 사전 검증이다.

04는 실제 서명 session/Hono/DB/AES→초기2×3→요약 확인→native plan/generation/independent audit·공식 citation binding→report ready의 첫 단일 경로를 확인했다. 6개 unknowns를 보존했으며 아직 전체 여섯 브라우저 경로나 최종 PDF 인수로 표시하지 않는다. 최종 전체 여정·실패 경계·모든 PDF 페이지 검토와 exact main 수동 full은 계속 진행한다.

PR664 최종c594432ab511f3b091ee7a07242501ff6bfd03b0의 Quality41320545184/Legal41320545090/nativePDF41320545311 성공 뒤 mainb8687a7ff9a0ccade0395d743482df0830629195에 병합했다. 04에 두 실제 native transport의 main 소비 가능 상태를 전달했다.

사전 broad browser 검사에서 #619의 단일 동의 체크/공통 app 진입/변호사 사건 접근을 구형 기대값이 반영하지 못한 것을 확인했다.00은 tests/browser/auth.e2e.ts·session.e2e.ts·design-system.e2e.ts와 tests/security-browser/csp.e2e.ts를 단독 정비한다.01에는 tests/browser/cases.e2e.ts·public-preview.e2e.ts,05에는 tests/browser/report-draft-revision.e2e.ts·report-retained-pdf.e2e.ts를 단독 위임했다. 키보드·서명 SQL session·로그아웃·owner·CSP·PDF draft/시간/소스 fence 검사를 보존한다. 현재 built CSP는 수정 뒤8 pass/정상 bundle에서 explicit fixture1 skip이며, 나머지 browser는 실패 원인 확인/수정 중이다. 이 사전 검사를 최종 성공으로 표시하지 않는다.

00 소유 인증/공통 shell 검사는 수정 뒤 Chromium27 tests 모두 통과했다. 실제 서명 SQL session의 동의 저장·로그아웃·쿠키 재사용 거절, 계정 역할 변경의 peer navigation, 단일 동의 체크의 on/off·실패 복구·keyboard, 허용된 복귀 경로와 부적절한 URL 거절을 유지한다.01에는 raw canonical 편집을 가정하던 tests/browser/customer-real.e2e.ts도 추가 단독 위임했다. 새 재조율 actual native/ACK 검증은04의 전체 fixture에서 수행하며 테스트를 위해 제품 원장을 대체하지 않는다.

### 통합 회귀의 공통 경계 보강

PR665 exacte517d146d82773b45bddba90ecd90460d95b8498의 Quality41321332843 성공 후 mainf2d2af8d31d7c64ab8a2d8414a9bbab87c09737a에 병합했다. PR666 exactfe7ec12d01b2fab497aa064fa118cb2339ef4ba3의 Quality41321903044 성공 후 main03cdd9dd36177ace7066fe3dc6e16b355c7654d3에 병합했다.666은 cases/public-preview 두 browser 파일만 변경하며 Chromium/WebKit 각7 검사를 통과했다.

00은 별도 clean main worktree의 `codex/621-rework-response-errors`에서 실제 통합이 드러낸 공통 응답 경계를 수정한다. shared JSON requester가 EXPORT_LIMIT_EXCEEDED/EXPORT_RETRY_EXHAUSTED를 일반 입력 오류로 바꾸지 않게 하고, 서버도 크기413/저장503을 보존한다. 사용자 action이 필요한 이 오류를 자동 재요청하지 않는다. 동기 POST /reports 생성만 기존 binary transfer와 같은 최대300초 기술 deadline을 사용하며 passive metadata·job admission은30초, 취소 signal과 export 시도 제한은 유지한다.

자동 게시 중 conversation GET의 source snapshot이 바뀌면 STALE_REVISION만 최대3회 fresh 읽기한다. 매회 signed session/owner와 실제 상태·출처 fence를 다시 확인하고 GET에서 admission/모델/법률 API를 실행하지 않는다. 새 암호화 assistant intent가 첫 workspace revision보다 앞서 게시될 때 기존 코드가 최종 revision fence 전에 wire schema를 검증해400을 반환하는 것을 deterministic actual Hono/DB/AES 회귀로 재현했다. fence를 schema parse 앞으로 옮겨 경합을409로 분류한 뒤 제한적으로 재조회한다. 영구 경합은409, 실제 저장/권한/입력 오류는 그대로 실패한다.

공통 경계 focused29 tests249 assertions 통과: 두 번의 실제 revision 변경 뒤 fresh snapshot, 계속 바뀌는 상태의 최대3회 실패, 재조회 전 logout의401, actual encrypted intent publication의400→fresh200, 실제 저장503/크기413와 provider/job0을 확인했다.48초 리포트 생성·metadata/admission 만료·사용자 취소·300초 binary 한계를 controlled transport로 검증했다. production build/dry-run/actual local workerd 부팅도 통과했다. 초기 테스트 fixture의 잘못된 DB 컬럼/저장 메시지 필드와 타입/포맷 오류는 제품 보호 조건을 변경하지 않고 수정했다.

05의 shared mock 통합에서 ReportMockError가 generic WorkspaceMockError 경계에서 UNAVAILABLE로 바뀌는 추가 문제를 확인했다. 정식 typed export 두 code만413/409로 보존하며 arbitrary 오류를 공식 성공/실패 코드로 승격하지 않는다. 실제 explicit mock의 초과 자료→명시 report 준비에서 크기 오류 전달·빈 report 저장 없음·원본 내용 보존을 포함해 공통 focused38 tests333 assertions를 통과했다. mock에서도 분석 unavailable 고지는 유지한다.

추가 단독 test 소유권:01은 customer-real/recovery-real/human-review와 test-only customer-browser-server의 실제 createReworkApi mount 조립,03은 workspace-shared/customer-completion,05는 report-draft-revision/retained-PDF/real-download/account-session-recovery/reports-integrated다.04의 Workspace 및 workspace.e2e.ts는 계속04 소유다.00은 app-experience/product-ui/shell-integration 등 공통 browser corpus를 정비한다. broad 사전 검사 중 같은 구형 UI 전제로 반복 대기하는 customer-recovery-real/product-ui batch는 실패를 보존하고 중단했으며, 미실행·중단을 성공으로 기록하지 않는다. 최종 manual full은 모든 수정 병합 후 별도 실행한다.

### 실제 스트림 경합과 최종 소비 준비

PR667 exact9661c52adb44542a9074efa63983324eb2eff94c의 Quality41322634194 성공 후 main1bfc35f479196bec34028a5ae0bec641bf4b706e, PR669 exactb844120ad7d1f11156f37e5f4fe16db96bdce77e의 Quality41323091671/Legal41323091688/nativePDF41323091692 성공 후 main929297bbaa440bae5a4cb78bcb901863f0b4630a에 병합했다. PR668 exactd11c33ae5d9dbdd5f0549f4045b3580b2cb4702f의 Quality41323480193/nativePDF41323480138 성공 후 main864f7994db7538898ae1cff6f8dcafe7e6339555, PR670 exact17f25796da42c4ea78c910a2f2d6291409607921의 Quality41324004833 성공 후 maind534c04ad1669fcac2fcbea91720ab66e48b279a에 병합했다.668의 공통 수정 의존 actual Astro22개가 모두 통과했다.670은 명시 peer 무효화 중 재조율 private Dialog를 숨기면서 동일 owner의 임시 장애 초안을 보존한다.

04의 실제 runtime fixture PR672는 아직 draft다. 실제 TXT 처리/원본과 Docker의52,064 bytes PDF 렌더는 실행됐지만 PDF 저장은 계획320 queries/실제321번째 조회에서413으로 실패한다. 실제900 hard bound·물리 용량·lease·원장을 바꾸지 않고,05의 optional scoped authoritative read 포트 PR673과00 공통 binding으로 반복 full 조회를 줄이는 검증을 진행한다. 이 실패를 빈 PDF 성공이나 실제 공급자 인수로 표시하지 않는다.

672의 Quality/Legal CI는 추가 source 조회 경합의400으로 실패했고 native PDF CI만 성공했다.04와 finite category 진단으로 summaryFragments가 revision 변경 시 stream을 중단하고 소비자가 빈/중간 JSON을 파싱하는 원인을 좁혔다. 진단은 원복했으며 원문·stack·SQL·민감 입력을 이슈에 게시하지 않는다.00의 `codex/621-rework-summary-read-fences`는 분석/재조율 소비자가 파싱 전에 실제 current owner/revision/summary source를 확인하게 한다. 재조율 passive GET도 STALE_REVISION만 최대3회 fresh session으로 재조회하고 다른 실패는 그대로 반환한다. 제품 stream·설치 client DTO·유료 admission을 변경하지 않는다.

새 deterministic 회귀4개는 실제 암호화 요약 stream의 첫 fragment 전/중간에 SQLite revision을 변경한다. 수정 전 SyntaxError를 재현했고 수정 뒤 STALE_REVISION과 최신 상태 재읽기를 확인했다. 관련 source/state/actual Hono/runtime44 tests363 assertions, bun ci/validate:quick과 production build/dry-run/local workerd 부팅이 통과했다. 테스트 binding proxy의 타입 오류는 수정했고 검사 기대나 제품 보호를 완화하지 않았다.672의 실제 정상/검색실패 반복 안정성 검사는 이 변경의 CI/main 뒤 다시 수행한다.

01의 key-order 동등 DTO와 실제 값/출처/revision 차이 거절 PR674,03의 shared originals/customer-completion corpus PR671,05의 scoped read PR673은 각각 최신 main CI 뒤 순차 통합한다. 최종 전체14 실제 브라우저 경로·actual PDF 전 페이지·exact main manual full은 계속 미완료로 보존한다.

PR675 exact85093766b851e40b35d40b7e2e4d08fbe902fb39의 Quality41324914769/Legal41324914750/native41324914761 성공 후 main26427659ac8a386334a545e0bf32b4cd3ba1073c, PR673 exact887187a9b22c58e4b589d3dec7dd5dde01cf3949의 Quality41325273600/native41325273571 성공 후 main32abc5f79bf04fede1dfdce19c13f967e90c92a3, PR674 exactcb97649d5472ac6a86188a548e755ab14f507d0d의 Quality41325723886 성공 후 main38dd0f086a6f6e3935dbaeb70806215d3c4896e2에 병합했다. PR676 exact93f28fc0cf4439da5846d21b0dfc7ae91d13a5e6의 Quality41326268025/Legal41326267945/native41326267903 성공 후 maina86862e037aa39caccec26b947f64438126e8666에 병합했다.676은 사용자가 편집한 mock 리포트의 기존 source identity와 checkedAt을 보존하되 검토 필요 상태를 유지한다. 편집 사실을 새 검증 분석으로 승격하지 않고 자료/요약/입장/마스킹/제외 범위 변경은 계속 stale이다.

00의 `codex/621-rework-scoped-current-read`는673의 private scoped read를 실제 opt-in report runtime에 연결한다. 요청 범위와 실제 현재 범위를 먼저 비교하고, owner/audit/원문/binding/TTL을 검증하는 full authoritative read를 한 번 실행한 뒤 현재 범위를 다시 확인한다. export 전후 검증, 최종 source SQL fence, 구형 fallback과900 hard limit는 유지한다. 범위 변경 중 검증 거절과 mismatch 시 full read 미실행을 실제 SQLite 저장/조회로 검증했다. 실제 PDF 저장 성공 여부는04/05의 같은 runtime 재실행 뒤 기록한다.

재조율 source의 독립 context 읽기에서도 summary의 최종 revision fence가 바뀌면 null로 끝나는 경합을 확인했다. 캡처한 owner/revision/암호문/summary ID/snapshot ID가 실제 바뀐 경우에만 STALE_REVISION으로 분류하고 unchanged-source DB 오류는 그대로 실패한다. 기존 DB adapter·stream 계약·범용503 재시도는 변경하지 않는다. 수정 전 deterministic source-change 회귀 실패와 unchanged DB-error 보존을 확인했고, 수정 후 관련37 tests321 assertions·bun ci·validate:quick(673/6286)·production build/local workerd를 통과했다.

04는 실제 일반 대화1회에서 workspace chat/audit 이후 법률 plan/analysis/audit가 추가 실행되는 문제도 재현했다. 의미 변경 없는 turn의 서버 인증과 research revision 계약을00/04가 함께 정리 중이며 현재 미해결이다. 이 회귀와 전체14여정·최종PDF·최종main manual full을 완료로 표시하지 않는다.

PR677 exactcc87f0337204d7745678945fd6d18582f71a934b의 Quality41326734507/Legal41326734552/native41326734560 성공 후 mainec292cbbe7c2486480cba67850bf879ef2795f14에 병합했다.04가 이 main으로 actual signed Hono/native TXT→R2 원본→Docker PDF 저장/다운로드를3회 반복했고 양 입장/재조율/검색 실패/AI200·권한을 포함한15 tests864 assertions를 통과했다. 이전400/503/413은 재현되지 않았다.00은 `/tmp/baro-625-runtime-report.pdf` 실제4페이지를 Poppler로 렌더해 전부 확인했다. 법조항/요건-사실·증거, 판례 공통점/차이점, 약점/보완 자료, 공식 링크와 검증 시각·범위, 합성 출처/모델 고지가 읽히며 잘림·겹침은 없었다. 아직 최종 Workspace14 브라우저 여정의 PDF는 아니다.

00의 `codex/621-rework-neutral-basis`는 DB atomic response publication에서 검증된 사실·당사자·unknowns·행동·완료·타임라인·tool·공식 인용 변경이 전혀 없을 때만 private encrypted unchanged-research-v1 증명을 직접 만든다. 모델이나 요청이 증명을 전달할 수 없다. 실제 completed job/operation과 사용자·assistant revision, 현재 confirmed summary, 선택자료·lookup 부재가 일치한 경우에만 research basis가 대화 admission/publication 두 revision을 건너뛴다. 제안 전용 conversationIntent는 실제 후속 action의 CAS와 분리하며 자체로 사건 변경으로 취급하지 않는다. 구형 unmarked 응답·실패/미완료 job·identity 불일치와 unknowns 빈 배열 clear 등 실제 변경은 경계를 유지한다. public projection이 증명을 제거하므로 설치 client strict DTO는 그대로다. schema/migration·공급자·모델·가격 관측·실제 AI 한도를 변경하지 않는다.

DB 실제 publication/반복 대화/strict public DTO/unknowns clear·action 변경/구형·summary·revision·operation·failed·foreign-owner의 proof 거절과 기존 원문/audit publication39 tests281 assertions를 통과했다.04의 추가 실제 neutral/intent-only4종 회귀는 이 변경 CI/main 뒤 소비한다. DB drift/fresh/upgrade와 quick/build 검증을 별도 수행하고 최종 결과를 기록한다.

이 tree의 bun ci·validate:quick 전체 profile·validate:db drift/fresh/upgrade·validate:build 및 built local workerd 부팅이 모두 성공했다. 최초 quick은 pinned Node PATH가 빠져 보안 baseline probe가 실패했으며, 지정된 Node24.19.0 경로를 사용한 재실행에서 보안 원본 실패/패치 후 거절 검사를 그대로 통과했다. 이를 제품 보호 완화로 해결하지 않았다.

PR671은 변경된 base의 required Quality gate expected로 첫 병합이 거절되어 base를 갱신했다. exact4420b9dd070565a3287ec92fa45ba22a42bee7ea의 Quality41327186274 성공 뒤 main14727d98a108dcf8a8390ec04356a6350a9fc3c6에 병합했으며 보호 규칙을 우회하지 않았다. PR678 exact4bc3a8d15a07c98d8d65026f639760bb467f55bb의 Quality41327474613/Legal41327474628/native41327474743 성공 뒤 main5d3bda3c168551ac42dc468abc8077b2d70fb5da에 병합했다.04의 actual API neutral/intent-only4종138 assertions가 이 main에서 통과했다. 마지막 모델 실행은 chat/audit2개뿐이고 공식 조회·report 생성 증가0, 기존 snapshot/report ID·ready 상태를 유지했다.

PR672 exact5d37bbce2e543174d16cf823ed84560e73c9a82b의 Quality41328012807/Legal41328012753/native41328012730 성공 뒤 mainef58bcc880cbf5b1e6911ab107c382b1f641bb59에 병합했다. fixture foundation만 통합하며 최종 Workspace CLI/14브라우저와 neutral4종 회귀는642에서 소비한다. 실제 마지막 receipt-run은 PDF52,068bytes, blob cipher52,713bytes·stored1, reservation stored1/52,068bytes, PDF binding held/stopped1/52,713bytes, capacity held59,739=totals59,739=held bindings8개 합계이고 writer8개 stopped였다.05가 동일 PDF hash와 JSON 쌍을 독립 확인했고 이전52,070bytes 관측 run과 분리 보존했다. 비용 금액/시각·hold·원장을 조작하지 않았다.

00은 scripts/development-checks.ts와 해당 test를 단독 정비한다. 새 conversation-agent11개, shared-mock2개, actual rework14개를 default server에서 제외하고 담당의 전용 config로 순차 실행한다. shared/integrated의 명시 opt-in을 설정해 skip guard 때문에 실제 검사가 빠지지 않게 하며, 실제14 선택 시 기존 office-runtime Docker image를 먼저 빌드한다. 현재 full의 native build는 browser 뒤이므로 실제 기술 선행 조건을 명시한 것이다. build/브라우저 실패는 기존대로 모아 전체 실패로 남기고 다른 group 검사를 숨기지 않는다. 선택·routing·guard·Docker 순서와 실패 보존25 tests565 assertions가 통과했고, 최종 main manual full의 실제27개 실행은 별도로 확인한다.

### 실제 웹·설치 클라이언트 연결의 최종 경계

PR681 exact7087a0fb2ca056deeb863b1663f183b187f3338a의 Quality41328391182 성공 후 maineee8691631aff1e5bf13a73bb35a58a9c4190642에 병합했다. 동일 원문의 실제 재검증 시 원래 citation 시각을 보존하는 가용성 수정이며119 tests1201 assertions의 실제 source repository/binding/publication authority/암호화 resolution CAS를 검증했다. 원문·권한·TTL·다른 owner/scope·늦은 변경의 거절은 유지한다.

PR679 exactf825bc894a748ea9d9a5ca30fb6c521d74935cec의 Quality41328824041 성공 후 main0d9eac02baa2b58f8891c24b628d4e2eeb93c93c, PR680 exact21c0893ad7b0e7b42ac8e7cd15246725eae68550의 Quality41329254521 성공 후 main92d6fe1ab29604ec4cc4ebb465be0f0adb847e8a, PR682 exact39e9a8b6db179781c4aaac5e6664d44c84c05200의 Quality41330558747 성공 후 main40503502ebea21e850039b1001915d732305ccf0에 순차 병합했다.679의 기존 config를 사용한 공통 Chromium57개와 shared lawyer client14/97,680의 공유3여정 Chromium/WebKit 각3개 및 실제 원본 bytearray/선택 ZIP CRC·UTF8명·전체 내용 검증이 통과했다. PDF/ZIP이 합성인지 실제 native 경로인지 품질 기록에서 구분한다. architecture의 ADR0018 cross-reference도 기존 unavailable 법률 설명 금지를 보존하며 명확히 했다.

04의 actual14 연결은 두 추가 실제 경계에서 멈춰 동일 원인 반복을 중단했다.01은 확정 뒤 자동 technical revision을 UI가 peer 변경으로 오인하는 오류를683에서 수정한다. 초기 확인은 원래 사용자가 읽은 canonical 전체/summary revision·동일 owner/case·성공 POST와 현재 동일 fresh pair의 summaryConfirmed를 묶어 navigation만 허용한다. 자료/맥락의 후속 변경에 따른 분석·리포트 stale 판단을 이 이동 허용으로 덮어쓰지 않는다. 다른 canonical이나 미확정·다른 owner·다른 receipt는 계속 거절한다.

00의 `codex/621-rework-public-job-projection`은 공유 client의 완료 assistant 누락 검사를 유지하면서 서버가 암호화 task/immutable reconciliation admission의 job·operation·target revision·owner 관계를 검증한 내부 작업만 public current/latest chat 표시에서 분리한다. latest의 내부 작업은 기존 nullable 계약의 null이며 과거 작업을 최신으로 승격하지 않는다. 실제 raw current-job lock·CAS·실패·작업·원장·receipt는 그대로이고, 이미 알려진 job ID의 owner-checked GET도 유지한다. 손상한 encrypted proof나 identity 불일치는 성공으로 숨기지 않는다. API DTO·schema/migration·모델·공급자는 변경하지 않는다.

또한 저장된 issued statement를 readonly authorize에도 재검증하고, 해당 admission revision까지의 citation binding 집합만 재조율 source digest/authority에 고정한다. 이후 자동 분석이 만든 별도 binding 추가는 사용자 입력 변경이 아니며, 원래 admitted source의 본문/hash/rights/TTL과 최종 owner/revision/source SQL fence는 유지한다. 수정 전 main의 두 부분을 각각 복원한 실험에서 실제 private-job projection과 이후 binding의 digest 오탐이 독립 실패했다. 최종 코드는 모두 복원했다.

관련46 tests585 assertions가 통과했다. 양 입장의 실제2×3→재조율 확정→native legal analysis/report→설치 Workspace facade get, 현재 canonical receipt 유지·같은 report ID·추가 모델/조회0, 일반 완료 chat의 missing-assistant3회 재조회 후 실제 오류, raw job lock/legacy GET, 다른 owner·operation·암호화 손상과 원래 source 권한 변조의 거절을 포함한다. PDF opt-in1개는 이 focused 실행에서 skip이며 이미 수행한 actual native PDF 및 최종14의 다운로드와 별도다. bun ci/validate:quick·DB drift/fresh/upgrade·production build/local workerd가 통과했다. 새 test fixture의 API 배열 형식·strict guard·타입 오류는 제품 보호를 바꾸지 않고 수정했다. CI/main 뒤04·01이 실제 화면을 다시 소비하며 최종14·최종PDF·최종 main 수동 full은 아직 미완료다.

PR684 exact30f35a48b8e80b186f48847653fefb7976a35fb9의 Quality41332285826/Legal41332285860/native41332285862 성공 후 mainb6020f9c54aaec84dfeeed90c563092ed72cfd61에 병합했다.04의 실제 설치 facade1 test36 assertions가 main 소비 뒤 통과했다. PR683 exact56b2fb5295c89909ae00ccfe0f890baf68d98c9a의 Quality41333275468 성공 후 main341b795ee7b1d3030816f140fcc0867171886571에 병합했다. 최초/재조율의 원래 사용자 검토 canonical과 authoritative 확인 proof를 보존하며 core Chromium53/WebKit53·actual signed customer15·두 목적×초기/재조율 ready/failure actual6이 통과했다. 후속 추가 WebKit actual6의1건은 summary HTTP200 뒤 JSON body 읽기 오류로 실패했고, 좁힌 진단1회에서는 재현되지 않았다. 새 실패를 core53 또는 Chromium6 성공에 합치지 않고 원래 증거를 보존한다. canonical/owner 우회 증거는 없으며 공개 summary stream 경계를00이 별도 조사한다.

mainb6020f9c의 전체 unit 사전 실행은5030 pass/4 skip/9 fail이었다. 모두684의 latest-job projection에 추가한 조회가 기존 bounded read 경로를 늘리거나 combined deletion의 nullable 결과를 바꾼 회귀였다.00의 `codex/621-rework-legacy-job-reads`는 동일 최신-job SQL에 미인증 후보 hint만 함께 읽고, 실제 후보에만 기존 암호화 admission/최종 owner 확인을 적용한다. hint만으로 private를 인정하지 않는다. 일반 intake/chat·null 경로는 원래 호출 수와 삭제 계약을 복원하며 카운트 기대·권한·무결성을 완화하지 않는다. 기존50 calls/6-call 최신 job/33-call warm focus·원본 coverage hydration0 등의 기대를 그대로 두고 관련101 tests2300 assertions가 통과했다.

실제 NLP add_material에서 assistant admission W14와 현재 publication W15의 차이로 UI의 정확 revision guard가 실행을 거절하는 문제도 확인했다. public intent의 workspaceRevision은 실제 완료 chat job과 같은 owner/workspace/operation·target revision 및 암호화 message identity가 검증된 **게시 revision(admission+1)** 이다. 저장된 legacy message DTO는 admission revision을 그대로 유지하며 과거 intent를 현재 revision으로 자동 갱신하지 않는다. 원래 projection으로 복원한 테스트는 실패했고, 실제 atomic response commit·기존 DTO·진짜 case purpose 변경 뒤 stale intent·failed job 제외를 포함한 새2개와 관련123 tests2510 assertions가 통과했다. publication 경합 fixture도 실제 completed job+게시 revision으로 보강했다. bun ci/validate:quick·validate:db drift/fresh/upgrade·production build/local workerd 성공이며, 이 변경 main 뒤04가 실제 NLP·14 경로를 소비한다.

PR675 exact85093766b851e40b35d40b7e2e4d08fbe902fb39의 Quality41324914769/Legal41324914750/nativePDF41324914761 성공 후 main26427659ac8a386334a545e0bf32b4cd3ba1073c에 병합했다. 실제 fixture의 Syntax400은 반복 검사에서0으로 해소됐지만 재조율 context read의 별도503은 남았다.04가 임시 enum 진단으로 readWorkspaceContext의 readIntake→summary unavailable 경합까지 좁혔으며 원복 완료했다.00은 실제 source proof가 바뀐 경우만 stale로 분류하고 unchanged source의 실제 오류는 보존하는 후속을 진행한다. DB corruption 거절을 완화하거나 unknown503을 반복해 성공으로 만들지 않는다.

PR673 exact887187a9b22c58e4b589d3dec7dd5dde01cf3949의 Quality41325273600/nativePDF41325273571 성공 후 main32abc5f79bf04fede1dfdce19c13f967e90c92a3에 병합했다. private scoped read 포트만 추가됐으며00의 실제 current-scope 전후 확인/runtime binding은 아직 남아 있다.

00의 `codex/621-rework-report-edit-binding`은 explicit mock에서 본문 편집 후 새 report ID가 기존 정확한 parent analysis identity를 잃어 PDF를 불필요하게 stale로 막던 문제를 수정한다. 동일 case source revision·제외 목록·mask scope의 parent만 identity를 이어받고, userEdited=true/review_required를 별도 보존해 검증된 새 분석으로 승격하지 않는다. source/context/evidence 변경은 기존 전체 source hash 검사에서 stale이며, scope 변경은 binding을 이어받지 않는다. 최초 canonical 준비는 사용자 편집 표시를 붙이지 않는다. 원래 analysis.checkedAt와 이전 immutable 본문은 그대로 보존하고 사건 삭제 시 두 private map도 지운다.

관련 mock/overflow/shared reports27 tests177 assertions, bun ci/validate:quick·production build/dry-run/local workerd 부팅 통과. 처음 추가 테스트의 넓은 fixture callback 타입을 실제 intersection으로 좁혀 타입 오류를 수정했다. 이 검증은 실제 provider/PDF native 인수와 구분하며05의 shared browser 전체는 이 후속의 CI/main 뒤 다시 검증한다.


### 최종 읽기 경계 및 실제 여정 준비

PR685 exacte2ab7f8d3396215b350e873cf5dae8fb4c9cd26d의 Quality41334505202/Legal41334505229/nativePDF41334505210 성공 후 main90b69502df15cf9a9aef7a27d64f037a289477e2에 squash 병합했다.01/04의 독립 읽기 검토에서 추가 finding은 없었다.04는 이 main으로 실제 intent의 정확 게시 revision과 처리 실패·양 입장3분기를 이어 검증한다. 일반 job 조회 횟수 복원은 기존 기대를 올리지 않았으며 전체 unit 재실행 결과는 별도 기록한다.

00의 codex/621-rework-summary-http-read는 요약 lazy stream의 소유권/삭제/현재 summary·workspace revision/암호화 hash/complete 경계를 보존한다. 기존 단일 owned/alive preflight에서 실제 workspace revision을 추가 응답 header로만 전달하며 strict JSON DTO·DB schema는 그대로다. GET summary body 읽기 실패 뒤 같은 request scope/abort/expected owner로 현재 workspace를 확인하고 같은 사건의 실제 revision 증가가 검증된 경우에만 내부 SummarySourceChangedError로 분류한다. cases.get은 그 내부 증명에만 최대3회의 readonly 재조회가 가능하다. 일반 HTTP409·503/무header·같은 revision의 암호화 손상·malformed 응답·실제 권한 거절은 자동 재시도하지 않는다. POST/모델/법률 조회 재시도와 mutation key 변경은 없다.

실제 Hono/암호화 SQLite/공유 HTTP·Cases client에서 첫 fragment와 중간 fragment의 source 변경을 재현해 새 revision의 온전한 본문으로 복구했고, 계속 변경되면3회에서 중단했다. owner/삭제/무결성의 기존 stream 거절·일반409의 단일 시도·probe401/404/503·계정 전환/abort·무header/같은W/다른사건/invalid probe/네트워크·mutation body 실패를 포함해62 tests343 assertions가 통과했다.01의 리뷰로 일반 CONFLICT 재시도와 증명된 내부 분류를 분리했다. 원래 WebKit 1건의 원인은 아직 미확정이며 이 deterministic 회귀를 그 원인의 확정 증거로 표현하지 않는다.

main90b69502의 전체 validate:unit은5041 pass/4 skip/0 fail·181764 assertions(215.47s)이었다. 4skip은 명시적인 native opt-in 경로이며 기존 별도 실행 증거와 최종 browser/native full에서 구분한다.686 tree의 bun ci·validate:quick673/6286·DB drift/fresh/upgrade·production build/dry-run/local workerd도 성공했다. 첫 build에서는 새 HTTP→contract barrel import가 실제 bundle 초기화 순환으로 usage.dailyCases undefined를 일으켰다. 기존 개별 workspace 계약 export를 직접 참조해 순환을 제거한 뒤 동일 build/runtime 검사가 통과했으며 검사를 생략하거나 초기화 오류를 숨기지 않았다.

PR686 exactd34b106cd18c3d4d477d47fd0233996c0c016daf의 Quality41335805514 성공 후 mainc23ee86abbd48ca51e5042fd00796d23e5812523으로 병합했다. 같은 main의 CI41336286933도 성공했다. 추가 native/legacy 파일47 tests362 assertions와 기존 bounded Workspace/intake86 tests2204 assertions가 통과했다.01은 이 exact main에서 양 입장×최초 확인/재조율 source-ready/source-failure actual6을 Chromium과 WebKit 각각1.7분에 통과했다. 초기2×3부터 수동 goto 없이 Workspace/composer로 진입했다. 브라우저별 summary transport42/browser42가 완전 JSON이며 불완전 관측0이다. 원래 WebKit 실패의 원인 확정·실제 외부 모델/법률 API/OAuth/native 출력/배포 인수로 확대하지 않는다. 원본 실패와 새 결과는01의 ignored `.wrangler/ui622/readback-686-{chromium,webkit}` 및 `readback-686-results.json`에 분리 보존했다.

04의 실제 정상 업로드는 처리 ready 이후 queue의 원본 identity guard에서 보수적으로 멈췄다. 동일 fresh W34/정본·맥락/epoch·text·선택 IDs/semantic baseline과 원본 관찰은 일치했지만 upload ACK projection의 hash가 없었다.00은 `codex/621-rework-file-hash-projection`에서 검증된 서버 metadata.contentHash를 이미 선언된 optional FileView.uploadContentHash로 보존하고, Workspace presentation schema가 이를 지우지 않도록 정비한다. 기존 v2HashSchema만 사용하며 원본 hash를 생성·변경하지 않는다. 새 API/DTO 필수필드/DB/migration·새 모델/공급자는 없다. 구형 hash 없음은 없음으로 읽고, malformed hash는 실제 오류다. 수정 전3개 실패를 확인한 뒤 metadata→설치 Workspace facade round-trip·legacy absence·malformed 및 기존 native upload/ACK 유실/owner 복구를 포함한77 tests396 assertions가 통과했다.04의 semantic/owner/원본 exact guard와 이미 보낸 body/key는 그대로이며 공통 변경 CI/main 뒤 전체 여정에 소비한다.

이 hash projection tree의 bun ci·validate:quick 전체 profile(673/6286 포함)·docs:check·production build/dry-run/local workerd 기동이 성공했다. DB/schema 변경은 없다.

PR687 exact5d17c96b90d619d4e339a736eb815f770e93b1ce의 Quality41337840051 성공과03/04 독립 읽기 검토 후 main35036f81bab7b2ed642a378cd2814d2eb0a85b60에 병합했다. 실제 SDK에서는 서버가 보존할 값을 주지 않는 추가 원인도 드러났다. v2-files.write가 검증된 manifest를 보존하면서 metadata 재암호화에는 contentHash를 누락했다.04의 원본 bytes SHA-256 대조 ACK 회귀가 이 main에서 실패했으며 UI/fixture에 대용 hash를 만들지 않았다.

00의 PR688은 upload/직접 처리/관찰 수정에 기존 검증 manifest의 digest를 보존한다. 기존 storedFileMetadataSchema를 순환 없는 DB leaf로 이동하고 staged 처리·분할 수정·job admission·workspace reference·report reader가 같은 strict schema를 사용한다. 기존 export와 optional hash/rejection 없는 구형 envelope 읽기를 유지한다. manifest 전체/part·원본 receipt·owner/consent/lease/revision/CAS·최종 SQL fence와 조회 횟수는 그대로다. 중복 strict reader를 풀거나 모르는 필드를 무시하도록 바꾸지 않았다. DB schema/migration·새 API 필수필드·새 hash/가격/관측 시각 생성은 없다.

수정 전 digest 보존3개 회귀가 실패했고 수정 후 실제 암호화 SQLite의 두 처리/두 수정 경로와 파일·공유 facade132 tests109548 assertions가 통과했다. exact7a3919546ce52086071935b856374c133d85a154의 전체 validate:unit5067 pass/4 opt-in skip/0 fail·181914 assertions(221.55s), bun ci/quick673/6286·DB drift/fresh/upgrade·production build/dry-run/local workerd와 Quality41339390069가 성공했다.03/04 독립 검토 추가 finding 없이 mainf17f7181312c45cd226ad81be3bd3de6fc098ee5에 병합했다.04가 새 main에서 원래 실패 native SDK 회귀1 test56 assertions를 통과했고 ACK/ready hash=actual original SHA-256·원본 전체 bytes·Docker PDF 저장 영수증을 확인했다. 원격 공급자/R2 인수와는 별도다.

실제 첫 정상 여정의 자료 추가·대화 반영·FileReview 이후, 새 자료로 이전 reconciliation receipt가 stale이 되는 현재 UI 계약을 검사에서 처음 요청 화면으로 오인한 것을 분리했다.01은 SummaryReconfirmation의 단독 소유를 유지하고,04는 명시적 다시 설명/최신 내용 읽기/사용자 재요청 경로를 검증한다. cancel 이후 자동 준비의 W36→37→38 사이 foreground 읽기 충돌과 request POST 부재를 숫자로 분류 중이며 일반503/parse 또는 이미 접수된 동일시도의 body/key를 자동 변경하지 않는다. 최종 정상14 성공으로 아직 표시하지 않는다.

00이 첫 actual materials.png를 직접 확인했을 때 전경이 흐리고 배경이 겹쳐 시각 인수를 보류했다.04는 dialog 수와 ancestor opacity/filter/visibility·실제 animation 종료를 확인한 안정 캡처 및 수치 artifact를 보존한다. 임의 sleep·사진 보정으로 흐림을 숨기지 않고 최종 화면/PDF를 다시 검토한다.

PRD/MVP 본문도 ADR-0018에 맞춰 목적/맥락/분야/절차, 재조율·확인, 자동 공식 분석·리포트·후속3분기와 기존 전용 금지의 대체 범위를 구체화한다. 공개 약관·동의 버전/과거 동의 시각·정책 service-content 검토 시각이나 독립 법률 승인 사실을 새로 만들지 않는다.

재조율 진단 정정: 초기 protocol allowlist에 request endpoint가 빠져 있었으므로 로그 부재로 실제 POST가 없었다고 추론할 수 없었다. 그 가설은 철회한다. endpoint를 포함한 실제 관측은 cancel200(expectedW36)→cancelledW37, 새 request202(expectedW37/S3)→pendingW38, 즉시 GET200의 동일W38/stale였다. 명시 latest 읽기 후에도 proposal로 진행할 수 없었으므로 정상409 복구로 처리하지 않는다.01의 암호화 DB/합성 cutoff port 결정적 회귀도 pending→stale로 실패했다. 원래 실제 실패는04의 /tmp/baro-625-recon-202-stale-original에 따로 보존한다.

원인은 storage 새 admission이 이전 requestMessage의 citation cutoff를 사용한 반면 새 request GET/claim은 새 issued message cutoff를 사용한 것이다. 이전 receipt의 cutoff 보호는 유지해야 한다.00의 선행 PR689는 runtime이 이미 계산한 새 modelSource를 내부 admissionSource로 전달하며 추가 조회/공개 DTO 변경은 없다. 이 PR 단독으로 결함 해결을 주장하지 않는다.01은 선행 CI/main 뒤 storage 단독 소유로 기존 old-issued load/active gate를 먼저 확인하고 새 source를 검증·저장하며 old/new/plan 최종 authority를 함께 사용한다. 기존 pending/running/proposed를 새 cutoff 차이만으로 stale 처리해 덮어쓰는 경로와 source·owner·lease 변조를 negative로 보존한다.

PR689 exactdcfe45361db68b21441333b12298c4f1c59c6479는 runtime1파일만 바꿨다. 기존 source/runtime/storage36 tests349 assertions, bun ci/quick673/6286·production build/dry-run/local workerd와 Quality41341936698/nativePDF41341936721 성공 후 maincd05ff0ed1d6fdf1f424bdafdf53cb4642d7acbe에 병합했다.01 storage 타입/소비 코드는 이 선행 main 뒤 별도 PR로 진행한다. required source를 받으며 기존 adapter의 source 재사용/fallback으로 결함을 숨기지 않는다. 선명한 새 materials.png를00이 직접 재검토해 전경/버튼/본문의 흐림·겹침 해소를 확인했다.

01의 소비 PR690 exactb871c9936b124c57cf6b0c5a2fd7b0772ea2c569는 storage/helper/전용 storage test/신규 intake API test4파일만 바꿨다. old load/active gate를 먼저 유지하고 required admissionSource의 W/S·summary/snapshot ID·전체 정본/intake·현재 issued ID/operation/설명/선택0/refs를 검사한다. 최종 old/new/plan authority AND와 final-clock proof를 유지하며 추가 authorize/lookup/fallback은 없다.40 tests430 assertions, 관련8파일117 pass/1154 assertions·Docker opt-in1 skip, 실제 signed Hono/D1/암호화/gateway 양 입장 재요청2개와 old-digest negative control을 확인했다. bun ci/quick673/6286·build/local workerd와 Quality41343082762 성공,00/02 독립 읽기 검토 추가 finding 없이 main9800a92ed10c97907a8192d3f245b27156504f0d에 병합했다.

최종 manual full의 합성 여정 PDF/HTML·basis(hash/bytes/opaque report revision)와 안정 화면/visual 수치를 SHA별 artifact로 보존하도록 workflow를 정비한다. protocol·browser log·전체 tmp·쿠키/토큰·stack/SQL·실사용자 자료는 수집하지 않는다.04는 basis가 synthetic=true임과 허용된 수치 필드만 포함함을 확인했다. 이 artifact는 성공 receipt가 아니며, 실제 checkout SHA·전체 workflow 성공·기존 full-validation receipt/gate는 별도로 유지한다.

04가690 main을 실제 브라우저로 소비해 request202(expectedW37/S3)→pendingW38→proposedW39→confirm200(expectedW39)→confirmedW40/S4→fresh confirmedW42~43을 확인했다. 원래 확인 receiptW40/S4는 그대로다. queued 메시지의 실제 commit ACK1회 유실 후 명시 재전송도 같은 whole body/key·첨부 게시1회를 통과했다. 다음 실패는04 wrapper가 onConfirmed 뒤 읽기 경합의 null에서 빈 재확인 영역에 남는 조립 문제로 구분했으며01 저장 수정은 동결하고04 소유 파일에서 수정한다. 이 상태를 전체14 완료나 실제 외부 인수로 표시하지 않는다.

04의 PR642 head7ebe414698779e85c12376ae4e6ff6a79a766384는 확인 뒤 읽기 재개와 panel 내부의 실제503/parse 오류·명시적 상태 재확인을 보강했다. 일반 오류 뒤 자동 poll 중단과 추가 mutation0을 Chromium/WebKit 각각13개에서 확인했고 bun ci/quick/build·Quality41344383344/Legal41344383333/nativePDF41344383352가 성공했다. 다만 정상 실제14의 PDF/후속 경계가 남아 draft/미병합을 유지했다.

실제 PDF GET200 뒤 다운로드 helper의 사후 검증이 stale을 올바르게 거절했다.04의 별도 signed Hono/D1/암호화/실제 Docker 회귀는 동일 report ID/revision2·basis·analysis.basis·확인 요약을 보존한 채 W28→30, ready/ready→stale/stale를 재현했다. PDF200을 브라우저 파일 전달 성공으로 세지 않는다. 원래 최소 수치 JSON과 실제 PDF는 /tmp/baro-625-runtime-pdf-basis.json 및 /tmp/baro-625-pdf-freshness-repro.pdf에 보존했다.

05의 독립 읽기 검토로 reserveArtifact와 complete의 각각 +1 저장 CAS가 researchRevisionBase에 연결되지 않은 원인을 확인했다.00은 `codex/621-rework-export-basis`에서 정확한 beforeW와 report/operation/summary/snapshot·ciphertext hash를 묶은 private 저장 증명을 기존 checkpoint/암호화 part에 원자 기록한다. 기존 report ciphertext 변경안은 exportFence 자기 무효화 지적에 따라 철회했다. report 본문/strict DTO·사용자 사후 freshness guard·실제 lease/원본/용량/금액과 시각은 유지하며 모델/법률 API 호출은 추가하지 않는다. 결정적 실제 native 회귀는 수정 전1실패→수정 후 해당 파일5 pass/297 assertions로 바뀌었다. 부정·rollback·PDF+ZIP/재시도·전체 검사와 PR CI/main 병합은 별도로 완료해야 한다.

공통 proof PR691은 workspace/publishedW tuple의 SHA를 기존 PK에 사용하고 entity=report ID, record version=publishedW로 묶었다. owner/report의 한 SQL snapshot에서 정확히1part·4096bytes 이하 header/part/envelope를 읽고 기존 strict manifest/AAD/chain을 검증한 뒤 마지막 SQL에서 같은 header/part/report cipher와 owner/op/job/snapshot/영수증을 다시 확인한다. reader 내부2조회이며 research 탐색1을 포함한 실제step3조회다. 권한/source verdict 캐시는 없다. 최종 native PDF5 pass/293 assertions, 공통DB/neutral47/1108, 내보내기 작업 분리12/538이 통과했다. 최초 PDF 관측 작업량만 owned capture1+두 proof의 원자3statement씩으로99 calls/126 statements→100/133이 됐고 published record/part 각2개를 확인했다. 기술 hard/plan/row/byte 한계는 바꾸지 않았다.

추가 실제 PDF→원본ZIP은 기존 plan415의 조회 한도413을 재현했다. 이를 숨기거나 한도를 올리지 않고05가 새 독립 회귀를 준비한다.05는 선행691 CI/main 후 자기 reports 모듈의 중복 source 읽기를 줄이며 마지막 source/owner/lease/receipt fence를 보존한다. stats.queries는 법률 API가 아닌 D1 총조회 관측이므로 ZIP 뒤 증가하는 것이 맞다.00의 추가 hunk에 있었던 전후 동등 기대는 철회했고 models/sources의 외부 호출 수와 실제 bounded200을 구분한다. 기존04 native 파일과 정상14는 선행main까지 동결한다.

PR691 exact90a42c57041a779add305f2bae09d7bfa3c0183b은 전체unit5101 pass/4 opt-in skip/0 fail·182224 assertions(207.23s), ci/quick·DB drift/fresh/upgrade·production build/dry-run/local workerd와 Quality41345758917/Legal41345758894/nativePDF41345758901을 통과했다.04/05 독립 읽기 검토 추가 차단 finding 없이 mainfc00ee2f19a88a0b2d230851235c98804fc7e12a으로 병합했다.00은 최신 합성 PDF52061bytes의4A4쪽을 모두 Poppler 렌더로 직접 확인했고 글자/겹침/잘림 없이 법적 관계·판례 비교·약점/자료·출처·미확인·합성 고지를 읽었다. 원래 실패 증거는 보존한다.04는 이 main에서 실제 UI 다운로드/최종14를,05는 양 입장 native ZIP RED와 최소 조회 최적화를 진행하며 실제 외부/최종full/preview 인수는 별도다.

mainfc00ee2f의 CI41346324550과 Report rendering41346324582도 성공했다.01/02/03의 지정 SHA 읽기 검토는 recon cutoff/legacy·strict DTO, 법률 원문/hash/rights/TTL/독립 audit, file-target 원장/업로드 복구 경계에 추가 actionable finding이 없었다. 제품 변경·반복 테스트/외부 probe는 하지 않았다.

04의 실제 UI PDF 다운로드 뒤 BrowserResponse.body가0bytes로 관측돼 whole-byte 비교가 실패했다. 독립 binary 재생은 동일 transport에서 upstream52082/downloaded52082 전체 동일, BrowserResponse0을 확인했다. 제품/다운로드 guard를 바꾸지 않고 실제 upstream 전체bytes를 oracle로 쓰도록 테스트만 수정했다. 다음 실제 UI PDF51931bytes/revision4가 사후 current와 함께 전달됐고 HTML본문91개가 PDF에91/91 보존됐으며4쪽 렌더를 확인했다. 이 증거는 PDF까지의 성공이며 후속 완료로 확대하지 않는다.

다음 직접 해결 PATCH200 뒤 초안 버튼 비활성 현상을 확인했으나 choice가 W를 올린다는 초기 가설은 철회했다.06의 유일 독립 actual native 진단은 PDF전W28/S2/A25→PDF후W30/S2/A25, PATCH전후W30/S2/A25 불변을 입증했다. report는 stale=false·동일ID/revision2/analysisId/checkedAt/basis/scope이며 isAnalysisCurrent=true였다. resolution은 선택 전부터 not_ready/basis=null였다. 유일 불일치는 준비 snapshot ready와 정상 report partial 표시다. reports/analysis의 기존 투영은 purpose/분야/절차가 미확정이면 ready를 partial로 낮추는데,06 source-loader는 원래 status와 exact 비교하고 있었다.00의 PR692는 이 표시 계산을 공통 pure helper로 추출한다.06은 선행CI/main 뒤 정확한 투영과 비교하고 다른 권한/current/source/ID/checkedAt/facts/scope/편집 검사는 유지한다. 임의 ready/partial OR나 미확정 절차 추정은 하지 않는다.

같은 선행 PR692의 서버 private reportIdentity는05의 이미 읽은 report4필드를 최종 claim의 actual row exact 비교 아래 재사용해 예약 SELECT1회만 줄인다. 기존/file 대상·공개DTO/DB schema·ledger/물리/시각·기술 hard/plan/row/byte 한도는 그대로다. root113 tests2027 assertions가 통과했고05/06이 각각 private capture와 pure projection을 읽기 검토해 차단 finding0을 전달했다.05는 ZIP의 중복 source 읽기·작은 copy의 기존 원자 snapshot helper와 private count를 정비하며 98304B/98305B·누락part rollback·parent/blob 변경·pre/post 분석 교체 경계를 검증한다. 전체 ZIP200/바이트 소비와06 실제후속 성공은 선행CI/main 뒤 별도로 확인한다.

PR692 exact695a70f2f91a90d14a5a1263b9433b4d294ce935는 ci/quick673/6286·focused113/2027·DB drift/fresh/upgrade·build/dry-run/local workerd와 Quality41347886953/nativePDF41347886991을 통과해 main6869aa6c5fffcb7aace0218e204fd976c10dc5d0에 병합했다. 같은 main CI41348299678/Report rendering41348299679도 성공했다.06은 소유 source-loader의 상태 비교1행만 helper로 소비해 기존6RED를 포함한111/924를 통과하고 실제 ignored native 후속 회귀76 assertions에서 선택→사실정리 초안→명시 검토/저장을 확인했다(W30/A25/S2/리포트 metadata불변,3571bytes본문동일,model/source추가0). 작은 소비 PR693의 CI/main과 최종 UI는 별도다.

05는 동일 main의 private4필드 mapping 뒤 actual 양입장 PDF→ZIP2 tests150 assertions를 통과했다. 첫 active plan415를 그대로 유지했고 계측된 전체 stream은414 queries, HTTP middleware 포함 총D1은417이었다. 독립 CRC·원본 전체bytes/파일명·사후 동일ID/revision/body/basis·analysis/report ready와 stale=false·writerStopped/원장 합계·model/source추가0을 확인했다. 후속 download quote320은 이미 planned인 meter에 적용되지 않는 값이므로 cap320 성공으로 쓰지 않는다. 처음 청구 fixture의 처리 중 readonly retryable503과 원래 실패는 보존하며 제품 오류를 빈 성공으로 바꾸지 않는다.05 PR/CI/main·모든 PDF 페이지 시각 검토는 계속 진행한다.

PR693 exact4a2e76cac7a220d182554a181b881d818522db2c는 source-loader와 소유 focused test2파일만 변경했다. ci/quick/build/workerd·focused111/924·유일 ignored actual native76 assertions와 Quality41348655199 성공,00 읽기 검토 추가 finding 없이 main38be24aa037f7c6a2e9d3745d80bbcfb73a650b3으로 병합했다.04는 이 main에서 같은 첫 실제 UI부터 초안/review/save/download 및14여정을 재개한다.06은 제품 동결하며 실제 UI 피드백에만 대응한다.

### 원본 ZIP 조회·부모 리포트 생존 검증과 최종 화면 (2026-11-02)

05의 PR694는 기존 originals_export plan415·hard900·row/byte/시간/시도·owner/동의/lease·최종CAS를 유지하며 중복 source 검증을 줄였다.98304bytes 이하 snapshot copy는 기존 원자 helper로 부모의 exact version/cipher/W/S/op/삭제·전part 수/크기와 새ID 부재를 같은 claim에서 검사한다. 큰 copy와 canonical 생성 경로는 기존 staged 처리를 유지한다. 같은 fresh report에서만 private count·PR692의 reportIdentity4필드를 재사용하고 저장/재생의 실제 source·analysis authority를 생략하지 않는다. 기존 snapshot AAD/hash/chain과 원본 whole bytes는 그대로다.

00의 읽기 검토에서 첫 ZIP stream에 부모 report ID가 전달되지 않는 문제를 발견했다.05는 부모 삭제의 R2쓰기 중/첫 바이트 전/262KB 이후 경계를3RED로 재현하고 알려진 부모ID를 기존 download fence로 전달했다.17경계143 assertions가 통과했고 추가 조회는 없다. 실제 ready file 대기의 일시 retryable UNAVAILABLE는 단일 accepted file·단일 active processing job 조건의 test helper에서만 bounded 재조회한다. 일반 SDK/제품 retry·다른 오류/owner/parse/실패 상태는 변경하지 않는다.

PR694 exact019fddbf028e5250c08f45aaea229e35aa2e5499는 reports348 PASS/2 opt-in SKIP/3831 assertions, 작업량12/538, native 양 입장2/150, ci/quick/build/workerd와 Quality41350017110/nativePDF41350017092 SUCCESS 후 main96c6aba70755e8a4999be07ad425427a33e0d270으로 병합했다. main CI41350541501/Report rendering41350541470도 SUCCESS다. 첫 PDF 작업량은90calls/121statements, 저장 PDF31/33으로 줄었으며 기존 proof header/part 각2개와 다운로드의 모델/법률 호출0을 보존했다.

00은 exact694 CI artifact를 독립 다운로드해 양 입장 PDF52083/52498bytes·4쪽씩, HTML83/85개본문 누락0·receipt SHA·ZIP CRC/원본1개 whole bytes를 확인했다. Poppler로 총8쪽을 렌더해 글자/읽기 열/근거·요건 사실/판례 공통점·차이점/약점·보완/미확인·합성 고지와 잘림·겹침 없는 출력을 확인했다. 이는 합성 공식 원문/gateway 포트와 실제 D1/R2 adapter·네이티브 PDF/ZIP 실행의 연결 검증이며 실제 모델 의미 품질·법률 API·법률 승인이 아니다. 최종 main 수동 full에서 다시 SHA를 고정한다.

PR642 선행11dc5e89의 Chromium 실제14여정과 별도 사진 respond/save는 통과했다. 사진은 기존 capture=environment picker에 합성PNG21700bytes를 넣어 metadata/original SHA 일치·native Sharp·low_quality/partial/uncertain·image 위치·자료의 분석 반영·HTML filename·PDF/저장 재생 whole bytes를 검증했다. 실제 카메라 기기나 OCR 의미 품질 인수로 표시하지 않는다. 자료 모달 footer의20px 가림은04 영역 CSS로 수정했다.00의 최초 materials 이미지 판독이 빈 화면처럼 보였으나 원본 SHA가 같은 immutable copy를 원해상도로 다시 열어 실제 전경/본문/footer가 모두 정상임을 확인했다. 이 판독 이상을 제품 결함이나 캡처 조작으로 기록하지 않는다.

WebKit의 Blob PUT을 Playwright postDataBuffer가 null로 관측해 test proxy가 본문 없이 재전송하던 경계는 test-only 같은 origin의 원본 HTTP stream 중계로 수정했다. 실제 signed cookie/Origin/content-length/hash/owner/API 검증과 CSP를 유지한다. 이후14개 중 마지막 Escape만 실패했으며 실제 focus는 role=log인 대화 scroll ancestor 또는 tabindex=-1의 main이었다.04는 해당 pane의 idle/current owner·epoch/no native Dialog 조건에서만 ancestor Escape를 닫기로 전달하고 구조적 main/scroll opener는 실제 composer로 복귀시켰다. 외부 interactive control의 focus는 보존한다. 독립17개를 C/W 각각 통과했고 실제 WebKit 직접 해결도 초안 저장/다운로드/Escape/textarea 복귀까지 통과했다. 최종 고정 b424eb2125c2fef3399adbb5790423c45921f7d8의 전체14는 Chromium3.5m·WebKit3.8m 모두 PASS다. 실제33/engine 수집도 확인했다. 최종 PR head/CI·main은 별도 확인한다.

05는 고정된 b424의 actual12PDF/48쪽을 별도 tmp로 bytecopy한 뒤 Poppler1600px 전페이지·12contact sheet를 직접 검토했다. clipping/overlap/blank/brokenGlyph0, bbox page 밖 단어0, 별도 pypdf6.20.1/HTMLParser 본문1108/1108·SHA/bytes 일치와 작업 후 원본 PDF/HTML/basis hash 불변을 확인했다. 양 입장·후속3경로의 법 요건/사실·증거·미확인·판례 공통/차이·약점·출처/날짜·읽기 열·페이지 전환과 사진 경로의 확인 필요/품질 낮음/보완 고지를 확인했다.12PDF의 embedded image는0이므로 이 검사를 선택 사진 삽입 인수로 확대하지 않는다. 제품/소유 파일 변경과 새 모델/공급자/브라우저 실행은 없었다.

추가 shared mock Chromium2에서 queued 첨부가 안전 중단됐다.04 readonly probe의9개 canonical 영역 digest는 모두 같고 W/view/case/conversation은10→13으로 동등했으며 summaryConfirmed=true를 유지했다. 파일은 ready·유효 hash지만 list/Workspace의 revision이 없고 완료 ACK/review만1이었다.00은 최신 main96c6의 깨끗한 별도 checkout·`codex/621-rework-upload-mock-revision`에서 새 FileView에 revision1을 저장하는 한 줄 수정과 실제 SDK/HTTP의 upload→list/workspace/review→edit/reconnect/original 보존 회귀를 준비했다. 신규1RED→GREEN, 관련6파일48검사344assertions PASS다.04의 queued guard·실제 제품 API·owner/session/hash/원본/불변 요청·revision 검사를 완화하지 않는다. 선행 PR의 CI/main 후 공통 모드 C/W를 재검증한다.

00의 공통 mock 선행 PR695 exact87a10a6c57e7a8b167a7fb5057dff861005d480d는 files.ts·mock-material-review.test.ts2파일만 변경했다. 실제 SDK의 upload readback·list·strict Workspace parser·review·관찰 수정·재접속·원본 whole bytes와 hash/revision 일치를 검증한다. 신규 test의 unknown JSON 타입 오류는 실제 공유 Workspace schema로 파싱해 수정한 뒤 ci/quick673/6286·관련48/344·production build/dry-run/local workerd가 모두 PASS했다. CI/main과04 shared C/W는 다음 단계이며 구형 optional revision DTO를 필수로 바꾸거나 생산 API를 수정하지 않는다.

00이 실제320px report/materials 화면을 직접 확인했다. report 읽기 열과 기존 브랜드/버튼은 유지됐으나 자료 모달의 footer 끝과 scrollport 사이20px 띠에서 원문이 비치는 hit-test 문제를04가 확인했다. 자료 전용 class/영역CSS에서 bottom padding을 footer로 옮겨 버튼 위치·scroll 공간·44px와 마지막 본문 접근을 유지하며 검증한다. 공통Dialog/global token/03FileReview는 바꾸지 않는다. 실제14 중 respond_to_claim-save 한 경로는 기존 촬영 picker와 실제 합성 image bytes·default low_quality vision을 사용해 원본 hash/범위/미확인 관찰→분석 includedEvidence→리포트를 검증하도록 준비한다. 나머지TXT5/ACK 경로는 보존하며 실제 기기 카메라 성공으로 표시하지 않는다.


PR695 exact87a10a6c57e7a8b167a7fb5057dff861005d480d의 Quality41355266822 SUCCESS를 확인해 main7cea91232f63f6807b62d15b53c6fbc7f27c2e41으로 정상 병합했다.04는 이 main을 소비한 공통 mock C/W2를 재검증하고 최종 PR642의 품질 문서/본문/head CI를 갱신한다. b424 실제14/engine·12PDF48쪽 원본은 그 소스의 증거로 보존하며, 최종 main 수동 full이 다시 전체33/engine을 실행한다.

### 최종 full 사전 보안 관측과 유지 조건

00의 2026-11-02 KST 로컬 raw `bun audit`는 exit1·16건(7 high/5 moderate/4 low)을 보고했다. deepmerge4.3.1, glob13.0.6/7.2.3/10.5.0, minimatch10.2.6/3.1.5/9.0.9, node-forge1.4.0, Zod4.6.6/별도CLI3.25.76 경로를 원본 그대로 보존한다. 실제 직접 Zod4.6.6과 CLI3의 advisory 포함 여부를 혼동하지 않는다. 이는 이번 기능이 추가한 의존성이 아니며 package/lockfile은 변경하지 않았다.

기존 #339는 2026-10-27 사용자의 범위 종료로 CLOSED/not planned이며 node-forge/CLI Zod의 vendor 보완과 raw audit 실패·실제 보안 인수 조건을 보존했다. 자동 재개·대규모 native/toolchain 교체·advisory allowlist·버전명/SRI 조작이나 audit 삭제를 하지 않는다. [deepmerge 공식 advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)와 [forge 공식 advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)의 patched version 없음, [glob14.0.2](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)·[minimatch11.0.1](https://github.com/advisories/GHSA-g3hv-75wg-m249)의 공식 fixed 범위를 확인했다. 새 major의 native/CLI 호환 검증이나 기존 잔여 보안 인수를 이번 웹 개편의 성공으로 대체하지 않는다.

최종 SHA 수동 workflow는 pinned Docker PDF runtime을 먼저 만들고 실제 양 입장 PDF→ZIP2를 필수 실행한 뒤 기존 validate:full을 그대로 수행한다. 이는 raw audit로 full이 중단돼도 이번 export의 정확 SHA 증거를 남기기 위한 순서다. full/보안 검사·성공 receipt 조건은 완화하지 않는다. raw audit 실패를 성공으로 재명명하지 않으며 실제 full 실행 결과·이후 preview/release 가능 여부는#621에 정확 SHA/run과 함께 기록한다.

preview의 실행 조건은 [현행 배포 문서](../operations/DEPLOYMENT-OPERATIONS.md)와 기존 deploy-preview workflow의 현재 main·성공한 main push CI·환경 credential·build/runtime/schema/SHA smoke를 따른다. 이번 사용자 승인의 수동 preview는 격리된 preview 리소스와 PUBLIC_BETA_ENABLED=false를 유지하며 정확한 full 결과와 별도로 기록한다. 성공한 full/security receipt·독립 외부/법률/공개 인수나 production 권한을 만들지 않는다. 이번 작업의 production 배포는 없다.

기존 배포 문서의 migration 전 복구 지점 기록을 위해 deploy-preview의 기존 수동 흐름에 D1 Time Travel bookmark 읽기를 추가한다. 고정 Wrangler4.147.0의 실제 command/JSON 구현을 확인했으며 현재 preview의 DB binding과 GitHub Environment credential만 사용한다. 현재 main CI 성공 뒤·migration 전 실제 bookmark를 읽고 정확 SHA/environment/binding/bookmark/실제 관측시각만 artifact로 보존한다. 원본 CLI JSON·키·사건·SQL은 업로드하지 않는다. DB 복원·키 변경·원장/기존 DB 삭제를 실행하지 않으며 bookmark 관측을 실제 복구 drill 성공으로 확대하지 않는다. 새 workflow·스케줄·Codex 자동화는 만들지 않았다.

workflow의 실제 inline bookmark 코드에 합성 valid·공백 포함 invalid·501자 초과·null4개를 입력해 성공/거절·오류 시 영수증 부재·출력5필드 allowlist·원본 bookmark/SHA 보존을 확인했다. Cloudflare 호출0이며 실제 bookmark를 만들어냈다고 표시하지 않는다. 기존 workflow/릴리스 회귀18개422 assertions도 PASS다.


### 최종 기능 통합과 실행 증거 인계

PR642 exact7282d155b15e5ac16431b5073ba923970dc4cf2f의 Quality41356322025·Legal41356321958·nativePDF41356321964 SUCCESS/COMPLETED와 ready·현재main7cea의 ancestry·38개파일 소유경계를 재확인했다.00 읽기 검토 추가 차단 finding0이며 정상 squash로 main0290957c10328f2f79594faed8e52bf3da57bf02에 병합했다. 최종head는 b424 구현·695 main 통합13f0 위에 소유 품질 문서63행만 추가한 것으로 제품 재변경은 없다. 기능 PR68개가 모두 통합됐다.

최종 증거는 actual C14/W14·격리각17·shared각2/33개 수집, 핵심174/780·native SDK/D1/R2/Docker PDF1/62·ci/결합quick674/6291·build/local workerd, 독립12PDF48쪽1108/1108·bbox/시각 finding0이다. 원본 실패/성공 source와 SHA/bytes·불변 전체 요청/receipt·원장/hold·현재 revision guard를 구분해 보존한다. 최종 main의 수동 full 성공이나 실제 공급자/OAuth/기기·원격 Containers 정지/정책·법률 승인은 아직 주장하지 않는다.

00의 마지막 `codex/621-rework-release-record`는 PRD/MVP·이 문서와 기존 full-validation/deploy-preview의 실행 증거만 소유한다. 최종 기록 PR·실제 병합 결과 main40자 SHA·manual full/preview run·artifact/receipt 유무·실제 외부 조건은#621을 정본으로 남긴다. 검사할 SHA를 문서에 다시 넣기 위한 자기참조 commit을 만들지 않는다.


### 수동 full 회귀 수리와 검증 분리 (2026-11-02)

후속697~701·703은 최신 main 보호를 유지해 매번 새 head의 CI 성공과 소유 파일 불변을 확인한 뒤00이 순차 squash했다.697/700/698/699/701/703의 최종 Quality run은 각각41363338970/41364282895/41364665649/41365056921/41365349707/41365815771이며 마지막 통합 main은25c02059다.01의 제품 변경은 기존 focus 체계에 맞춘 intake CSS6행이고 나머지는 전용 fixture/locator/기본 C/W 등록·서버 lifecycle 정비다. 원래 assertion/실패/기술 한도는 보존했다.

00 PR702는 bun ci·quick708 tests/7083 assertions·집중50/1226·build/dry-run/local workerd·문서 검사를 통과했다. 전체 브라우저 파일의 정확히 한 번 dispatch, 전용 config 우선, 기존 full 명령의 중복 횟수·구간 순서, 실패/skip/cancel/timeout/누락/중복/다른 run·attempt·dispatcher와 완료 join의 checkout guard를 검사한다.02의 독립 읽기 검토에서 join 발행자의 identity 누락 P2를 발견해 RED→GREEN으로 고치고 재검토 추가 blocker0을 확인했다. GitHub read token은 두 검증 step에만 전달한다. 최종 PR head의 CI/main·실제 full/preview 결과는#621에 기록하며 이 사전 결과를 full 성공으로 표시하지 않는다.

main `1fb713a9035bea06138205f1e94f11cc488ac070`의 CI41357406162와 preview41357811030은 성공했다. 수동 full41357435897/job125000428726은 60분 제한으로 취소됐다. 전체 Bun5192 PASS/8 opt-in SKIP/0 FAIL·182906 assertions, native 양 입장 PDF/ZIP2·163 assertions, DB fresh/reapply·eval·build는 통과했으나 브라우저의 옛 locator/fixture와 실제 label focus 결함을 발견했다. 이 실행에서는 raw audit·CSP·전체 native가 도달하지 않았고 full 성공 receipt는 없다. 당시8PDF32쪽·HTML722/722와 원본 불변·bbox6941단어/밖0·전페이지 시각 검토는 별도 합성 증거다.

00은 `codex/621-rework-full-validation-shards`에서 기존 full 명령의 중복 횟수까지 보존하는 core/browser/native 세 구간과 같은 run/attempt/dispatcher·actual checkout 검증 뒤 결합하는 receipt를 소유한다. 각 job의60분·Docker 자원·network none·raw audit·secret scan·CI paid0을 유지하며 실패/취소/skip/부분 재실행은 성공 영수증을 만들지 않는다. 브라우저/CSP와 native가 다른 구간의 실패에 가려지지 않도록 독립 실행하며 기존 full 로컬 profile도 유지한다. root는 전용 config 우선 실행·resolution 변경 대상 매핑도 소유한다.

01은 intake/recovery locator와 소유 intake CSS의 inset focus, 03은 첨부/교정 fixture 및 전용 config, 04는 customer 오류 영역 locator와 기존3개 C/W project 등록, 05는 사건 개요 편집 locator와 same-origin blob 판정, 06은 독립 후속 서버 lifecycle/config와 NFC filename 검증을 소유한다. 공통 customer 서버의 pending-chat-summary 합성 limiter binding만00의 별도 `codex/621-rework-customer-fixture-limiter`가 소유한다. 실제 API 제한기/D1 quota/AI200은 바꾸지 않는다. 한 파일 한 소유자와 CI/main 선행 통합을 유지한다. PR697 exact8c7a440485160fb725e4888c15a7cf293ab03187은 Quality41363338970 성공 뒤 main1c976f92로 병합했고 후속 C22/W22·override/cleanup 증거를 보존한다. 후속 PR과 최종 SHA/run은 #621에 계속 기록한다.

### ACA 수동 검증과 공식 원문 연결 보완 (2026-11-02)

PR702 exactbaad7b89c878183cfd481088e17c6048d8364e18의 Quality41366443495가 성공한 뒤00이 정상 squash로 ACA main에 병합했다. 최종 집중 검사는50 tests/1232 assertions다. 위50/1226은 직전 단계의 실제 기록으로 보존한다. ACA main push CI41366828610 성공을 확인한 뒤 명시40자 SHA로 수동 full41366848207과 preview41367271794를 실행했다.

full core125028704167은 전체 Bun5201 PASS/8 SKIP/0 FAIL·183164 assertions와 DB fresh/reapply·offline eval·production build/dry-run/local workerd를 통과한 뒤 raw bun audit16건(7 high/5 moderate/4 low)으로 실패했다. 기존#339는 CLOSED/not-planned이며 이번 범위에서 재개·major upgrade·allowlist·audit 우회·버전/관측 증거 조작을 하지 않는다. 초반 고정 secret scanner는 통과했으나 audit 이후 단계가 도달하지 않은 것을 전체 security 성공으로 표시하지 않는다. eval artifact13107893571/digest ebf84dd16ad843208a49de8d478017183be2055b365d7fcb91081bd6a2870cea를 보존한다.

full native125028704352는 mandatory 양 입장 PDF/원본 ZIP2 tests/166 assertions와 기존 전체 native profile을 통과했다. network none·CPU/PID/메모리 한도와 HEIF/Office·암호화/악성 문서·audio·PDF·loopback sanitizer 검사를 유지했다. artifact13107677789/digest432a5c76ded3de68d7adc1c12784f0829a35c47b764b19972546e3abe584cabd의3PDF11쪽을05가 전부 렌더해 확인했다. 양 입장 본문 HTML168/168줄과 review64/66줄의 PDF 누락0, bbox2141단어/페이지 밖0, 깨진 한글·겹침·잘림0이다.00도 양 입장 receipt SHA/ZIP CRC/원본110bytes와 실제 방어 PDF 페이지를 독립 확인했다. 이 positive 합성 출력만으로 raw binding/rights/독립 semantic audit·실제 모델/법률 API·촬영·기존 모든 negative 경계를 새로 입증했다고 표현하지 않는다.

같은 ACA preview는 release/schema0022와9개 route smoke를 통과했다. deployment7481490355/status21133205980은 production_environment=false다. recovery artifact13107802089/digest e3eb1bcdcedf6cf9d02564eab19d92900d6a700c9c215bb7c63eb5ff85524626의 실제 JSON238bytes/SHA9f466bbdd75cdebcd2b71c46f56e49111d49bf32e381f860fae6cb715b4d9d5c, 관측2026-11-02T00:28:03.633Z와5개 허용 필드를 확인했다. bookmark 원문·credential·사건/owner ID는 공개하지 않는다. 복구 drill 성공이나 full 통과 영수증은 아니다. 이전 고정 fixture SOURCE_UNAVAILABLE/domainCreateInvoked=false는 조건 변경 없이 재실행·재생성하지 않는다. 사용자 직접 로그인 답변은 완료 확인과 별개다.

ACA 출력 검토에서 공식 URL이 본문에는 있지만 HTML anchor가0개인 실제 요구사항 누락을 확인했다.05는 src/utils/report-markdown.ts, src/components/reports/ReportReading.tsx·document.ts, src/styles/reports.css, src/server/modules/reports/pdf.ts와 전용 테스트/fixture를 단독 변경한다. services/file-processor/report-test.py도 이번 테스트에 한정해05에 명시 배정한다. 중앙 native processor/main.py·03 처리·04 Workspace/여정·DTO/DB/gateway·root 문서는 변경하지 않는다.02는 읽기 전용 독립 안전성 검토를 맡는다.

링크는 기존 출처 섹션의 전체 “공식 원문 · URL” 행에서만 기존 세 canonical 공식 URL/숫자 ID를 허용한다. raw href·표시 URL을 보존하고 query 추가/중복·redirect·userinfo·port·fragment·인코딩·유사 host·HTML/코드/인용/일반 URL은 링크로 승격하지 않는다. 외부 이미지/fetch를 추가하지 않고 새 탭의 referrer를 보내지 않는다. 사용자 편집/재확인 고지와 citation binding·원문 hash·권한·TTL·CAS/lease·기존 PDF/ZIP 한도는 그대로다. production WeasyPrint의 data-resource-only fetcher와 독립 Workers 텍스트 PDF adapter 각각 실제 URI annotation을 검사한다. PDF 다운로드 경로에 모델·법률 API 호출을 넣지 않는다. 기존 ACA run/artifact를 덮어쓰거나 취소하지 않고 새 PR의 CI/main과 새 최종 SHA 검증을 별도로 기록한다.

PR704의 제품 exactff6e8ea3와 문서만 추가한 bdf48188은 제품/테스트가 동일하다. bdf의 Quality41369861509·HTML/PDF native41369861624 SUCCESS와02 읽기 검토 추가 finding0을 확인했다.05의 새 합성 증거는 quick708/7084·reports351/3882·actual native PDF/ZIP2/159·focused8/85·C/W 웹/HTML 클릭4·build/local workerd와4PDF13쪽 전페이지 시각 검토다. HTML172본문/URI annotation/receipt SHA/ZIP CRC를 확인했고00도 실제 PDF의 공식 출처 페이지를 독립 시각 확인했다. 이 목록에 PR704를 추가하는00 문서 commit 이후 최종 exact head CI·실제 정상 병합·새 final SHA/run은#621에 기록한다.

사용자 직접 로그인 뒤 ACA 비공개 preview에서 명확한 합성 사건을 새로 저장하고 실제 공급자의 질문2회×3개와6답변 저장까지 UI로 확인했다. 첫 질문의 기존 읽기 전용 inspection41369851635는 completed/attempt1/failure null 및 generation/audit/publication 완료를 보고했다. 기존 사용자 사건 열람·재시도·삭제·민감자료 전달은 없었다. 이는 실제 intake 일부의 실행 증거이며 전체 OAuth·동의철회·공식 법률 분석/의미 품질·원격 촬영·독립 법률 승인 인수는 아니다. 후속 실제 화면의 결과와 검사한 release는#621에 구분해 기록한다.

### ACA 전체 결과·실제 preview와 상태 읽기 수리 (2026-11-02)

ACA full41366848207/browser125028704500은49분 안에 종료했다.36개 그룹 summary722 PASS/3 FAIL이며 timeout이 아니다.04 소유 WebKit shared defense 입장 확인 Dialog 미발견1개, 실제 defense 직접/변호사 경로 addMaterial 링크 미발견2개다. 뒤 그룹도 모두 실행했고 CSP는 browser 실패로 미도달했다. core audit 실패·native 성공·join SKIP·성공 receipt0을 보존한다.04는 실제 완료 ACK/이미 admitted된 pending 작업과 UI 검사 순서를 조사하며 기존 단언·120초 test/5초 expect·provider 기술 한도·retry 수는 완화하지 않는다.

browser artifact13108889848/2057406bytes/digest8f6ce28348c7c551e7dd81ad248982571306554135735f2a8803f478f7bc80ee의 실제10PDF40쪽을05가 전부 렌더·직접 시각 확인했다. HTML922/922 본문·basis PDF/HTML SHA 일치, bbox8904단어/밖0, 원본97파일 whole hash 불변이다. WebKit 방어2경로는 자료 단계에서 실패해 PDF가 없으며12개 성공으로 표시하지 않는다. report/followup20개 PNG도 확인했으나 고정 header/composer와 scroll viewport 때문에 일부 카드가 화면 밖이다. 정적 이미지로 전체 웹 조판·상호작용을 새로 인수하지 않는다. 카메라2경로도 합성/partial-low-quality이며 실기기 인수가 아니다. ACA anchor0은704 이전 누락이다.

실제 ACA preview에서 청구6질문과 방어5질문(2차2개)을 생성하고 요약 확인→작업 공간까지 갔다. 청구 재조율은 기존 불리한 사실을 유지했고, 확정 응답의 연결 오류 뒤 동일 쓰기를 반복하지 않고 reload로 새 canonical을 확인했다.517bytes 합성 TXT는 browser chooser와 개별 자동 처리 동의를 거쳐 native 검증/처리 두 job이 각각 completed/attempt1/transport response였다. 뒤 analysis 성격의 chat_response는 POLICY_REJECTED/attempt1이며 읽기 전용 JSON은 analysis failed/report ready다. 원인과 실제 법률 품질은 미확정이고 같은 provider 재시도를 반복하지 않는다. 첨부 게시의 revision 충돌·입력 보존과 metadata 연결 오류를 성공으로 숨기지 않는다. inspection41371680186은 허용 enum/숫자 metadata만 읽었으며 실제 사건/owner ID·본문·credential·stack/SQL을 이슈·문서에 남기지 않는다.

상태 GET은 별도 같은 origin 문서 탐색에서도20초 command 제한을 넘긴 뒤 정상 JSON을 반환했다. client30초 오류의 원인 후보이며 정확한 서버 지연이나 해결 성공은 단정하지 않는다.00의 독립10ms 지연 fixture는 단순 state+peek56 DB read가 직렬 peak1/약634ms임을 확인했다. 수정은 첫 workspace revision anchor를 먼저 고정한 뒤 독립 context/scope 및 passive loaded/record/peek 읽기를 병렬화한다. 조회 수56·최종 owner/revision/원문 권한·TTL·CAS 검사를 유지하며 마지막 fixture는 peak5/약375ms다. 합성 성능 수치는 실제 preview 개선 보장이 아니다.

02가 첫 초안의 metadata가 anchor보다 먼저 끝나는 P2를 발견했다. 첫 workspace decrypt hold→old context/scope→실제 context update→repo Wnew 재읽기로 옛 unconfirmed 반환을 RED 재현했고 w를 먼저 await하도록 고쳐 GREEN을 확인했다. 새 concurrency4+기존 state8=12 tests50 assertions, 관련 runtime/public/intent/neutral/bound-source87 PASS/1 opt-in SKIP·1220 assertions다.02 수정 재검토 추가 finding0이다. DB/DTO/새 cache·추상화·공급자/모델·가격 gate/30초 한도 변경은 없다.05 peek 중복read 삭제는 추가 무결성 증명이 필요해 보류하고 보고서 제품을 동결한다. 이 root PR과04 수리의 실제 CI/main·새 최종 SHA 수동 full/preview 및 실제 화면 결과는#621에 기록한다.

### 마지막 여정 검사와 제한된 정책 오류 진단 (2026-11-02)

PR705 exact6a21f3c3d8342ecda29f52c9e9cdedfce5fca7bd는 Quality41373519909·Legal41373519906·Native41373519862 모두 성공하고 최신 main ancestry를 확인한 뒤00이 정상 squash했다. 실제 main12f100409632b35eb9d86fcbfff9c2443e905099/병합2026-11-02T01:43:26Z이며 push CI41373960461·native41373960333도 성공했다. main 직접 push나 production 배포는 없다.

04는 같은5000ms native 지연에서 업로드 complete ACK 전에 기존 첨부 링크 검사가 끝나는 RED를 재현했다. 수정은 실제 complete 응답200과 fileId/DTO 확인→기존 admitted waitUntil만 settle→기존 링크/실패/멱등성 단언 순서다. 빈 settle 두 번은 전체 통계가 같고 추가 admission/drain/provider 재호출이 없다. shared의 실제 parent-read hold에서는 disabled opener에 보낸 Enter가 소실되는 RED를 재현했고 enabled/focused→Enter→Dialog visible 순서를 확인했다.120초 test/5초 expect·retry0·모든 원래 단언과 실제 DTO를 유지한다. transient 첫 hold 실험은 RED가 아니었으며 원인 확정 증거로 사용하지 않는다.

12f를 통합한04 브랜치는 actual Chromium14/WebKit14와 shared각2=32개를 모두 통과했다. 이는 실제 Hono/worker·브라우저·격리 native PDF와 합성 gateway/source 포트를 연결한 검사이며 실제 모델/법률 API/OAuth 인수가 아니다. 새12PDF48쪽·protocol/HTML/PNG는 별도 경로에 보존했고 예전160파일 hash 변경/누락0이다. 중단한 b12 부분 실행C11은 완료32와 구분한다. 최종 PR head·CI/main·수동 full 산출물은#621을 따른다.

POLICY_REJECTED는 workspace 사전 조건이나 provider refusal 등 여러 경로에서 발생하므로 현재 코드만으로 공급자 거절 원인을 단정하지 않는다.00의846118abe7e0febe3808bdf26fe707cefa5ff7fb는 기존 운영자 inspection의 MODEL_SCHEMA numeric-only SELECT와 동일 엄격 schema를 재사용해 policyAttempts를 추가한다. 기존 schemaAttempts·최대12행·숫자 한도/null·[]/not_sent/unknown을 보존하며 원문·credential·providerRequestId·금액·phase ID를 추가 출력하지 않는다. 새 SQL/DB·권한·원장 쓰기·모델/법률 호출·제품 gate 변경은 없다.8 tests61 assertions·bun ci/quick708 및02 privacy 정적 검토 추가 finding0을 확인했다. receipt 존재/부재만으로 특정 phase·provider refusal/독립 audit의 원인이나 성공을 추론하지 않는다. 최종 main에서 실제 비내용 관측을 확인하며 분석 실패를 재시도로 숨기지 않는다.

## c9 최종 검증과 실패 protocol 보존

c9 full native artifact13111273947의3PDF11쪽은05가 전페이지 Poppler/시각 검토했다. HTML172/172 본문·bbox2141 단어의 페이지 이탈0·runtime PDF의공식 URI2개씩·receipt URL/SHA·ZIP CRC/원본 일치를 확인했고 원본14파일의 전체 해시는 불변이다.00도 공식 출처 페이지를 직접 시각 확인했다. legacy PDF에는 HTML/receipt가 없어 해당 비교는 주장하지 않는다.

c9 browser artifact13112951445(2081876B, SHA256 `20b65335f3377a8a63f4df483a6ec68dc71a2a927e6d61dd2ad407a64845c32a`)는 실패한 사진2경로의 성공 PDF를 포함하지 않는다. 기존 finally가 쓰는 합성 `protocol.json`이 workflow whitelist에 없어 당시 CI 원본의 단계별 finite protocol을 복구할 수 없었다.00은 다음 실행부터 해당 파일을 기존14일 artifact에 함께 보존한다. request/response 원문·사건/계정/파일 ID·토큰·스택/SQL은 추가하지 않으며 기존 proxy의 허용된 kind/method/status/error enum·수치 revision/바이트만 기록한다. 제품 시간/시도/처리 용량·assertion·artifact 권한을 바꾸지 않는다.

실제 preview PDF는 합성 사건만 로컬에서 보존했다. 청구52014B/3쪽 SHA256 `6971e3b21c3e7249af2927c6482f858969b85d587fc9723ac4ee1f5ef5599093`, 방어49681B/3쪽 SHA256 `f7494ba346fd171d30ba7198cef5e4c404390b7b6d744c30134bdb11e88fd1c7`다. 둘 다 자료 부족·검증 법률 분석 부재를 명시하고 불리한 사실을 유지한다. 실제 사건/계정 식별자·개인정보·다운로드 원본 이름은 이 문서나 GitHub에 남기지 않는다. 양쪽 웹/HTML/PDF 비교는 알려진 페이지 footer를 제외한 표시 본문 비교이며 citation 권한·보안 증명의 대체가 아니다. 기존 읽기 전용 운영 진단의2400/189·10000/2475·8000/1795 토큰 수치3건은 정확한 phase나 정책 거절 원인·법률 승인 성공을 식별하지 않는다.

## 제한 리포트 후속 조회의 현재성 검증

00은 common `rework/resolution-runtime.ts`의 loaded 입력 anchor 뒤 독립 report 읽기만 raw→readPreparedAnalysis 검증과 동시 진행한다. raw와 validated analysis의 순서는 유지하고 non-null analysis는 raw의 전체 canonical snapshot과 같아야 하며 raw의 workspace revision이 loaded W보다 미래면 거절한다. source 반환 전 기존에 조립하던 owner/alive/loaded W·session·latest report/analysis ID·report ciphertext/review·정본/자료·공식 원문 proof/현재 clock TTL guard를 실제 SELECT로 검사한다. mutation의 최종 CAS는 별도로 유지한다. null basis를 verified로 승격하거나 raw snapshot으로 대체하지 않는다.

c9에서 실제 입력 anchor 뒤 W변경·요청 session 삭제·report proof 읽은 뒤 revision변경의3회귀가 잘못 성공하는 RED를 재현했다. 수정 뒤 이3개와 유효 failed analysis의늦은게시·정상 limited not_ready 유지가 통과했다. 신규5검사9 assertions와 관련 resolution/runtime/state9파일118검사1109 assertions가 통과했다.02는 의존 순서·canonical 결합·현재성 SELECT·최종 CAS를 독립 정적 검토해 추가 blocker/P1/P2 없음으로 회신했다. 이는 실제 preview의 이전 timeout이나 POLICY_REJECTED 원인을 확정하지 않는다.

합성10ms/D1읽기 지연 profile은61 query/peak2/737ms에서 검증 SELECT를 추가한62 query/peak2/682ms로 변했다. 쿼리·권한을 줄인 것이 아니며 이 숫자를 실제 서버 지연·오류 해결 인수로 사용하지 않는다. 기존30초 client deadline·lease·시도·AI200·기술 용량은 동일하다.06은 독립 UI에서 state=null과 유효 basis=null을 구분하고 실제 공통 responseError의CONFLICT를 통과하는 보존형 오류 회귀를 담당한다.

위00변경은 bun ci(고정 의존 변경0), validate:quick(모바일534·rework/법률/후속457 PASS/4 SKIP·tooling708 PASS/7084 assertions), validate:build의 production worker dry-run/local workerd와 diff check를 통과했다. 최초 quick의 신규 테스트1곳 formatting 실패는 해당 파일 formatter로 수정한 뒤 전체 quick을 재실행해 성공했다. DB migration·클라이언트 DTO·모델/법률 API·production 변경은 없다. 실제 최종 exact head CI·정상 병합·새 final SHA는#621에 남긴다.

## 후속 상태 오류 구분과 실제 preview PDF 독립 검토

06 PR708은 `FollowUpResolution.tsx`와 독립 helper2개/browser1개만 바꿨다. 초기 state=null의 loadError를 action error와 분리해 PDF 저장 성공이 metadata 확인 실패를 지우지 않으며, 다시 확인 전 lawyer/self 선택은 추가 GET/files/report/PATCH를 실행하지 않는다. 유효 basis=null/not_ready 응답에서는 기존대로 lawyer 선택을 저장할 수 있고 검증되지 않은 draft는 거절한다. 실제 공통 responseError를 거친409는 CONFLICT 안내와 이전 초안의 비최신 처리를 유지한다. 서버 code·DTO·공통 client·timeout·lease·owner/동의/epoch guard는 바꾸지 않는다.

초기503와실제정규화409의2개 RED를 확인한 뒤 기존44+신규16=Chromium30/WebKit30 총60검사를 통과했다. network/invalid200·명시 재확인1회·양쪽 입장 제한report·formal guard·저장본불변과 기존 계정/철회/삭제 회귀를 유지했다. bun ci/quick708 PASS/7084 assertions·build/local workerd도 통과했다. 원 headff45b0c0f591c20acc9532c9534652263f22a9c1을34f 최신main에 갱신한 a3c32429에서도 소유4파일 바이트가 동일하며 새 Quality41384196523 SUCCESS·CLEAN·ancestry 뒤2026-11-02T03:42:22Z main deb11에 정상 병합했다. 이 결과는 원래 실제 preview 오류의 원인 확정이 아니다.

05는 c9 실제 preview의generic 청구/방어 PDF2개6쪽을 독립 새Poppler렌더/contact sheet/시각 검토했다. bbox1095단어의 페이지 이탈0·잘림/겹침/빈쪽/한글깨짐0,13섹션 순서·보완 필요/판례 비교 미완성/검증 법률 분석 부재·불리한 사실과 원본SHA를 확인했다. 공식 URI·임의 법률 인용 생성0이다. 실제 기술적 POLICY_REJECTED 코드를 PDF에 노출하지 않고 제한 상태를 사용자 언어로 알린다. 원본 폴더15파일의 전후 해시가 불변이다. 웹/HTML의 각13본문 비교는00 실행 증거와 구분하며05가 별도 HTML 원문을 독립 검증한 것으로 표현하지 않는다. 실제 법률 분석/판례 완성·새 final full이나 사진 실패2경로를 이2개PDF로 대체하지 않는다.

707/708 실제 UI 상태 구분을 위한 중간 preview41384947482는 main deb11의 push CI41384536434 성공 뒤 수행했다. schema0022/9 route smoke와 비공개 deployment7483853304/status21140951938이 성공했다. recovery artifact13114976881(335B archive, sha2564cab663f8af07887f7676ff4609009c13aee0573fbd99dde6beda4fa82f0c60c)의 원본238B/정확한5필드·DB/preview/정확SHA를 확인했다. 원본SHA dc877da066f3819de117006e61a2e4c21434797152b2d74444bb1bccb1c9ad45, 관측2026-11-02T03:47:32.613Z이며 bookmark 값은 공개하지 않는다. 복원 훈련이나04최종SHA 검증의 대체가 아니다.

## 리포트 후속 요청의 별도 진행 계약

04의 deb11+조회순서 수리 자연 baseline은 actual32중31 PASS/1 FAIL이었다. 원문 사진 review200/R3 뒤 metadata W33에서 analysis ready/report stale를 읽는 동안 model-free report continuation이 W34를 게시해, selected-file POST 이전에 보존형 preflight 오류가 발생했다. 기존순서수리의 통제409→202/원본4회귀/57 unit236 assertions,실제peer409 1회와새chat0·본문첨부보존은 별도 원본으로 유지한다. 이 자연 baseline의11PDF나 이전160파일 해시불변을 최종32 PASS로 표현하지 않는다. 현재 CI2 FAIL/실제 preview와 원인이 완전히 같다고 단정하지 않는다.

기본 `conversation-report-v1`과 기존 GET conversation/strict report.pending⇔currentJobId 계약은 유지한다. 새 명시 GET `/api/v2/cases/:id/rework/conversation-progress`의 계약은 `conversation-report-progress-v1`: `{contractVersion,state,reportContinuation}`이며 state는 기존 DTO다. nullable continuation은 `{phase:requested|registered,requestId,basis,expectedReportRevision}`이다. requested는 분석과 같은 atomic claim에 후속 리포트 요청 의무가 저장됐다는 뜻이고 registered는 실제 미완료 등록 checkpoint가 있다는 뜻이다. 어느 쪽도 실행 중 job/lease/공급자 시도·재시도 권한을 증명하지 않는다. job ID가 없는 값을 currentJobId에 넣지 않는다.

분석 성공·실패의 private prepared record에 task.continueWithReport가 true일 때만 검증된 task.requestId와 실제 expectedReportRevision의 optional `continuationObligation`을 함께 게시한다. 분석 terminal commit→checkpoint 등록 사이에도 의무가 보인다. 옛 field 부재에서 task/입장/자동완료를 추측하지 않는다. 등록 checkpoint의 optional `registeredWorkspaceRevision`은 실제 등록 W로 고정되고 mark는 original을 유지한다. 같은 요청 또는 의무 게시 이후의 명시 재요청 terminal checkpoint는 이전 의무를 부활시키지 않으며, 현재 reportReady·현재 basis·report CAS가 우선한다. DB schema/migration은 없다.

새 projection은 하나의 anchored read에서 기존 checkpoint를 재사용하고 검증된 원문 sourceAuthority를 private callback으로 전달받아 마지막 SELECT에서 owner/alive/role/정확 W·요청 session·정본/자료·최신analysis/checkpoint head ID 또는 null·report ID/revision·현재 clock 원문 TTL을 묶는다. private SQL은 wire에 노출하지 않는다. 구 GET 응답은 그대로이고 새 GET에만 이 추가 검증 SELECT가 있다. HTTP 한 번 교체가 D1 query 개수까지 같다는 뜻은 아니다. 기존 passive STALE 재읽기 최대3회와세션재확인·권한·동의읽기·dispatch0·가격관측전용·AI200/일/2×3·lease/시도/시간제한은 유지한다.

04는 공통 선행 CI/main 뒤 Agent.load 및 queued preflight의 GET 1회를 새 progress 1회로 교체한다. review→progress(완료 미확인일 때 POST0·기존 보존 대기)→완료 확인 뒤 workspace/case→원래 frozen 의미·file revision·3개 revision·owner/epoch·CAS를 검사한다. 미완료 등록을 무기한 running으로 표시하지 않고 기존 metadata30초 확인 창 뒤 저장 보존/명시 재확인·대기 취소를 제공한다. timeout은 서버 실패·취소·성공 판정이 아니며 새 모델/법률·POST 자동 재시도를 허용하지 않는다.

공통 신규 검증은 atomic 성공/실패 직후 등록 전 상태·실제 report ready 후 등록완료지연·old field 부재·현재 CAS와입장변경·R2 명시 재요청의 terminal·같은 W checkpoint head교체·원문 TTL최종proof·요청session삭제·구strict client/새route query/owner/no-store를 포함해4파일51 PASS/399 assertions다. 최초 새 테스트의 literal 타입/부적절한 TTL fixture CHECK와기대 HTTP status를 바로잡아 재실행했으며 제품 guard를 완화하지 않았다.02가 source/dataflow를 독립 정적 검토해 추가 P1/P2 없음으로 회신한 사실은 root 실행 결과와 구분한다.

중간 deb11 실제 preview에서 리포트 panel/failed 고지는 확인했지만 lawyer 선택1회가 보존형 generic 오류를 반환했고, 쓰기 재전송 없이 UI의다시확인 GET1회를 수행해도 완료 연결 성공 증거를 얻지 못했다. HTTP 상태/원래 error code가 없어 timeout/503/원인을 확정하지 않는다. 합성10ms/D1 read-or-batch 지연 select profile133 calls/peak2/1505ms는 실제 지연 원인의 증거가 아니다. 불필요한 옛 검증 탭을 정리했으며 미전송 입력이 있는 탭과 저장된 사례/자료·기존 policy 실패·리포트는 보존했다. 새 progress 계약의 수리를 이 실제 후속 실패나 법률 분석 성공으로 표현하지 않는다.


## 후속 오류의 제한 진단과 실제 transport 경계

PR709는 exact head의 Quality·Legal·native 세 CI 성공 후 정상 squash로 통합했고 main push CI41389742127·native41389742126도 성공했다. 변경별 bun ci·quick(모바일534·domain467 PASS/4 SKIP·tooling708/7084)·build/dry-run/local workerd를 통과했다. 합성10ms 지연 profile의 기존 state56 query/peak5/373ms와 새 progress57/peak5/408ms는 마지막 검증 SELECT 1개 추가를 관측한 수치이며 실제 preview 성능이나 공급자 성공의 증거가 아니다.

PR710의 root 소유 공통3파일은 기존 ApiError/HTTP DTO·UNAVAILABLE code·안내·status·retryable을 유지하고 optional transportFailure(timeout/abort/unknown)만 보존한다. 실제 apiRequest에서 native Error/DOMException의 정확한 TimeoutError/AbortError 이름만 분류하며 임의 message/cause/stack/URL/ID/원래 이름을 복사하지 않는다. HTTP responseError는 body의 동명 필드를 신뢰하지 않는다. root 제품 commit683880872f54dbd897b25b0a1cabb1e6b2bfb641과 test 타입 수정a03e3a7e231f5fb3a9f6735b2226ebae2f5e69fd를06이 순서대로 가져왔고 소유3파일 바이트 보존을 재확인했다.

06의 독립6파일은 기존 오류 알림에 load/action별 code·http-status·transport의6개 data 속성만 추가한다. 허용 code10종 또는 unknown, HTTP 정수100~599 또는 none, transport timeout/abort/unknown만 기록한다. none은 HTTP 상태 증거 부재를 뜻하며 invalid JSON 응답에서도 가능하므로 응답을 받지 못했다고 추론하지 않는다. helper는 예외를 던지는 getter도 안전하게 처리하며 본문·임의 오류 이름·원문·console·telemetry를 추가하지 않는다. 초기 metadata 오류는 PDF 성공으로 지워지지 않고, 새 요청/성공/purge/owner 전환은 해당 channel만 초기화한다. 기존 Props/API·사용자 문구·30초 deadline·재시도·owner/동의/epoch guard는 같다.

fixture facade도 실제 createJsonRequester→apiRequest 경로를 사용해 fetch TimeoutError/AbortError와 HTTP200 invalid JSON의 분류를 검증했다. Chromium37/WebKit37 총74 PASS, helper+공통core/deadline/client 집중18 tests147 assertions, bun ci·quick(모바일534·domain474 PASS/4 SKIP·tooling708/7084)·build/dry-run/local workerd를 통과했다.02는 root 공통 privacy/호환성을 읽기 전용 검토해 추가 P1/P2 없음으로 회신했다. 실제 preview/공급자 probe를06이 수행한 것으로 표현하지 않는다.

중간 deb11의 별도 읽기 전용 resolution 응답은 revision1·basis=null·selection=null·status=not_ready·draft=null이었다. 이는 그 읽기 시점에 저장된 선택을 확인하지 못했다는 증거이며 앞선 선택 성공/늦은 commit/timeout 원인으로 해석하지 않는다.710의 새 preview 진단과04 최종 소비·브라우저·exact SHA full/preview는#621에 별도 기록한다. 원래 실패·저장 사건/자료·기존 리포트·미전송 입력을 보존하며 모델/법률 재시도로 숨기지 않는다.


## 마지막 대화 소비 구현과 중간 preview 증거

04 PR711의 source43e3644d0dcada2ba4f6512cbbe016f680723045는 최신 main ab1eac을 포함한다. review의 canonical/전체 페이지/미확인 교정 없음과 정확 file revision을 확인한 뒤 새 progress를 읽고, 논리적 continuation·실제 analysis/report 작업이 미완료면 selected-file POST0으로 기존 대기를 유지한다. 완료 확인 뒤에만 workspace/case를 읽어 frozen 의미·file revision·기존3 revision·owner/epoch·서버 CAS를 검사한다. queued pendingEvidence/continuation 동안 Agent의 whole-view catchup을 미뤄 native 처리 중 옛 전체 workspace 응답이 전송을 중단하지 않게 한다. 다른 담당의 구현을 복제하거나 실패를 성공으로 바꾸지 않는다.

progress 소비는 요청 시작부터 기존 metadata와 같은30초 확인 창을 사용한다. phase requested→registered·W/request 변화로 창을 연장하지 않는다. 만료 후 자동 읽기/전송은 멈추고 저장 입력·첨부와 명시 재확인/대기 취소를 제공한다. 늦은 성공도 확인 없이 자동 전송을 재개하지 않으며 이전 owner의 응답은 폐기한다. 등록 대기를 서버 job·공급자 시도·실패/취소로 추측하지 않고, 리포트 pane은 기존 저장본 읽기와 passive GET만 허용한다. 새 자동 action/모델/법률 재시도·시간/시도 한도 완화는 없다.

같은 source의 actual Chromium16/WebKit16 총32 PASS(7.4분), Agent Chromium21/WebKit21 총42 PASS, shared Chromium2/WebKit2 총4 PASS를04가 검증했다. unit89 PASS/1 opt-in SKIP·868 assertions와 tools typecheck·bun ci·quick708/7084·build/local workerd도 통과했다. 첫 shared 실행의 opt-in flag 누락4 SKIP는 별도 로그로 보존한 뒤 올바른 flag로 실제4 PASS를 확인했다. 실제 Hono/worker·격리 native PDF와 합성 model/source 포트로 두입장×후속3경로·사진·처리실패·peer409·동일 fileR 변경 전송0·기술W 변경202·AI200·owner/동의·두 lostACK를 검증한 것이며 실제 외부 공급자/OAuth/법률 승인 인수가 아니다.

04의 새 로컬 artifact는 PDF16개64쪽(기본12+다운로드4)·HTML12개·finite protocol16개2622행이다. protocol 허용 enum/숫자 위반0·예전 원본160파일 hash 변경/누락0을 확인했다. 원래120초 test/5초 링크 단언/retry0은 유지한다. 초기 progress 소비의 C1 PASS/W1 FAIL은 처리 중 whole-view catchup의 별도 원본이며 최종32 성공에 합치거나 삭제하지 않는다.00은 핵심 제품3파일을 읽기 전용 검토해 추가 P1/P2 없음으로 회신했다. 이 문서의 root 단독 commit은04 PR에 그대로 전달하고 마지막 exact head CI·정상 병합·최종 main 수동 full/같은SHApreview는#621에 기록한다. `bun run work:next` 재확인 결과도56 tasks/no cycles다.

중간 preview41393131162는 ab1eac push CI41391998647 SUCCESS 뒤 정상 완료됐다. Foundation smoke는05:24:14.284Z의 정확SHA/schema0022, endpoint smoke는05:24:15.911Z의9 routes, 비공개 deployment7484966843/status21144564698 success를 확인했다. recovery artifact13117489043(334B archive, sha2563b96590f517266e65e3b3098191c589734e8380065449addf0bb2eb700d08418)의 JSON238B·정확5필드·preview/DB/정확SHA를 확인했다. 원본SHA40d7d2ab14f1fe863b04d7687e47460bf3b21f08095d11a26e342de18b3fdf4c·관측2026-11-02T05:17:46.845Z이며 bookmark 값은 공개하지 않는다. 이는 복원 훈련·최종04 SHA 검증·실제 후속 선택 성공의 대체가 아니다. production0이다.


## 요청 내 검증 원본 유지와 큰 기록 호환성

실제710 preview의 같은 후속 선택1회는 기존 알림의 finite DOM에서 action code=UNAVAILABLE/http-status=none/transport=timeout, load 진단 없음으로 확인했다. 이는 client deadline 증거이며 어느 HTTP 요청이 전송됐는지·서버 내부 단계·이전 오류 원인을 확정하지 않는다. 쓰기 재전송 없이 UI 다시확인 GET1회 뒤 세 선택 모두 미선택인 유효 제한 상태를 확인했고 새 모델/법률 호출은 하지 않았다. 실제 합성 사례의 입력·리포트와 이전 실패는 보존한다.

06 PR712는 기존6개 진단 속성에 선택 실패용 data-action-error-step 한 개만 추가한다. 값은 files_read/report_read/resolution_read/selection_update/unknown이며 외부 error/body에서 읽지 않는다. choose 호출마다 lexical tracker가 첫 실패만 고정하고, 기존 run의 owner epoch guard 안에서 값으로 snapshot한다. 늦은 병렬 reject는 다른 요청·owner·새 성공/실패의 진단을 덮을 수 없다. 원래 error identity·동기 throw·병렬 착수 순서/횟수·Props/API·30초 제한과 권한 검사는 그대로다. selection_update는 façade의 session/권한/challenge/응답 검증까지 포함하므로 PATCH 송신 증거가 아니다. 기존74+신규18=Chromium46/WebKit46 총92 PASS, helper13/96·bun ci·quick(534/domain484+4 SKIP/tooling708·7084)·build/dry-run/local workerd를 통과했고00 정적 검토 추가 P1/P2 없음 뒤 정상 병합했다. 초기 browser harness가 첫 GET 전에 실패 interception을 설치한4 FAIL과 helper tuple 타입 수정 로그는 보존하며 제품 guard를 완화하지 않았다.

00은 별도 합성 회귀에서 첫 제한 source를 읽은 뒤 W가 바뀌어도 기존 후속 쓰기가 나중 W로 재조립해 성공하는 RED를 재현했다.713은 service 한 호출의 첫 owner/case·W·전체 projection을 private clone으로 고정한다. load 반환도 clone이며 요청 간 cache는 없다. 매 authorize는 기존 fresh role/동의 검사에 더해 loaded source·summary/files·report 원본/review·analysis head·요청 session·현재 clock 공식 원문 권한/TTL을 SQL로 다시 확인한다. null basis도 검사하며 publication은 null 포함 정확 basis와 고정 W를 final authority에 넣는다. 별도 resolution version CAS·동의/lease/no-writer·저장 후 authorize·멱등 원본 replay는 유지한다. replay를 새 source 권한으로 승격하지 않는다.

공유 v2-rework read의 optional private callback은 실제 AES/AAD 복호화·길이·chain digest·schema·최종 header 검사에 사용한 바로 그 header와 ordered parts의 정확 cipher에서 SQL proof를 만든다. 사후 별도 SELECT로 바뀐 bytes를 과거 값의 증거로 삼지 않는다. 기존 return shape/HTTP DTO·설치 client는 그대로이며 새 쿼리가 없다. raw manifest와 part identity/index/length/cipher·정확 count를 묶어 fragment 삭제나 동일 ID bytes 변경도 검증한다. 강제 손상 테스트의 trigger 제거는 정상 published UPDATE/INSERT 금지 정책과 구분한다.

재사용은 raw proof가 있고 전체 guard JSON UTF-8 1MiB 이하·64 values 이하일 때만 한다. 그 밖의 load/publication·non-null basis 검사는 기존 전체 재조립을 사용하되 처음 W/전체 projection과 달라지면 STALE다. 원래 access만 검사하던 큰 기록의 null-basis preflight는 고정W/owner/session/현재TTL/base source guard와 쓰기 동의를 SQL로 확인하며 전체 큰 기록 읽기를 추가 반복하지 않는다. 큰 prepared fixture의 원래 load+publication 두 번을 정확히 유지하는 것도 검사한다. 최적화 여부를 기능 gate로 쓰지 않으며 기존4MiB/64parts·2MiB batch/100parameters 한도를 늘리거나 줄이지 않는다.720000 bytes 일반 기록의 bounded proof와900000 bytes 기록의 private-proof fallback, 더 큰 유효 prepared analysis의 실제 읽기/선택 성공을 검증했다. exact1MiB 임계값의 모든 바이트 조합이나 임의 DB 관리자 권한의 모든 공격을 새로 입증했다고 주장하지 않는다. DB schema/migration 변경은 없다.

집중71 tests389 assertions는 원래W RED→GREEN, manifest/part 손상·fragment삭제·late analysis head·session/동의/report·동시 resolution CAS·요청별 재조립·postsave session 유실 뒤 committed record 보존·replay·큰 기록을 포함한다. 실제 합성 bound analysis의 원문 body/rights/binding/TTL·fileR/role/owner/report/rawpart 변경9개와 staging 뒤W/body/clock3개도 검증했다. 파일이 없던 초기 mutation fixture 실패는 readyFile 합성 자료를 실제로 넣어 고쳤고 원본 로그를 보존했다.02는 초안과 마지막 role/쓰기 동의 SQL을 읽기 전용 독립 검토해 추가 P1/P2 없음으로 회신했다.

source d8ffd5a7의 bun ci·quick(모바일534/domain504 PASS+4 opt-in SKIP/tooling708·7084)·DB drift/fresh/upgrade·build/dry-run/local workerd가 통과했다. 이후712 main6a40439을 정상 merge한8ae2ee5d에서도 bun ci·quick(모바일534/domain510 PASS+4 SKIP/tooling708·7084)·build/local workerd를 통과했다. 큰 기록의 null-basis 확인이 전체 재조립 횟수를 늘리지 않도록 마지막 private 분기를 보완했으며 같은 집중/quick/build와 문서 검사를 재확인한다. 문서 반영 후 exact head·최종 main 검증은#621에 따로 남긴다. 합성10ms/D1 profile의 report peek18/peak1/약202ms·resolution GET64/peak2/약660ms·select91/peak2/약955ms는 전 select133/약1523ms와 비교하는 관측이며 실제 timeout 원인·실서버 속도 개선 보장이나 공급자 성공의 증거가 아니다. 실제 façade 단계 진단과 최종 preview 확인을 별도로 수행한다. production 배포0이다.


712의 main push CI41396068477 SUCCESS 뒤 같은6a40439 SHA의 중간 preview41396468217을 수동 시작했다. immutable main·main CI·복구 bookmark 보존 검사는 통과했으며 이 기록 작성 시 build/deploy 중이다. 실제 finite step/저장 읽기 결과와713 병합 후 최종 exact SHA full/preview는#621에 기록하며, 이 중간 배포를 최종 통합 완료로 사용하지 않는다.01/03/04/05/06은 담당 제품·테스트 동결을 회신했고02는00 공통 경계의 읽기 전용 검토만 수행한다.


## 파일 publication과 안정 metadata 페이지의 선행 수리

713 initial8ae2ee5d의 Quality41396313244·Legal41396313153는 성공했지만 native41396313260/job125118293088은 청구 업로드 직후 metadata files.list GET503/STORAGE_UNAVAILABLE로 실패했다. PDF/ZIP 이전 단계이며 방어 native는 통과했다. 원본 log·artifact13119423296(7305767B, sha2560bdeaee5e3aa8c18491bdbd290e0f7660e35b717c449e2b197d16d6b5ceba73b)를 보존하고 동일 SHA native 성공으로 표현하지 않는다. 정확한 당시 첫·최종 행 interleaving이 기록된 것은 아니다.

00은 별도 [#714](https://github.com/creno-va/baro/issues/714)를#621 하위 이슈로 만들고 깨끗한 main6a40439의 보조 root checkout에서 codex/714-file-page-stability를 생성했다. 713의143338dd checkpoint와 기존 보조 branch/변경은 보존했다. 변경 소유는00의 src/server/db/v2-files.ts와 전용 repository 회귀다.03은 읽기 전용으로 file publication의 R/state/payload/job 변경이 기존 list 최종 fence의 행 탈락→SNAPSHOT_INVALID→서비스503과 맞는다는 경로를 확인했다. W-only 변화 자체는 해당 fence가 비교하지 않는다. 실제 CI 원인을 단정하는 대신 실제 writeProcessed publication을 metadata decrypt 중 완료시키는 통제 회귀에서 같은 실패를 RED 재현하고 GREEN으로 고쳤다.

PR715의 안정 HTTP 페이지만 최대3회 동일 owner/workspace/cursor/limit 전체를 새로 읽는다. 기존 final row 비교가 감지한 정확한 known length mismatch에서만 다음 회로 진행하고 rows/values/current/result는 매번 새로 만든다. queued→processing→실제 terminal publication ready 두 변화를 세 번째 정확한R/hash로 확인한다. 지속3회 변화는 기존 오류이고 네 번째 읽기는 없다. 일반 DB/crypto/schema 오류는 재시도하지 않으며 known change 후 다음 read의 실제 오류도 그대로 실패한다. 비stable direct caller와W-only 변경은 기존2쿼리를 유지한다. owner/workspace/account/file 삭제는 기존 tombstone/owner SQL과 서비스 최종 workspace 확인을 유지하며 이전 plaintext를 반환하지 않는다. 기존20행 pagination·manifest pointer·관찰revision·installed DTO·fixture의 completed-file-job 재시도 거절·30초·AI200/2×3·기술/시도·원장/관측·PDF 쿼리 예산은 그대로다.

최종 repository54 PASS/65833 assertions·실제 Docker native PDF/원본 ZIP2 PASS/160 assertions·bun ci·quick(모바일534/domain484 PASS+4 opt-in SKIP/tooling708·7084)·DB drift/fresh/upgrade·build/dry-run/local workerd·tools/test TypeScript를 통과했다. 최초 pagination 테스트의 잘못된 column명과 별도 타입 명령의 잘못된 config 경로를 바로잡은 로그는 제품 결함 증거와 구분한다.03은 정확 diff를 읽기 전용 검토해 추가 차단 finding0을 회신했고 queued/processing/ready 표현을 실제 lifecycle 회귀로 강화했다. 이54검사/2 native는 실제 외부 공급자/OAuth 인수나 마지막 main full의 대체가 아니다.

report-rendering.yml의 기존 pull_request/push filter가 v2-files.ts 변경을 누락한 것도 발견했다.715에서 두 경로 항목만 추가하도록 해당 파일 소유를05에서00으로 이 수정에 한정해 회수했고05의 동결 회신을 확인했다. 기존 Docker/격리/CPU/PID/메모리/네트워크/permissions/검사·artifact 보존은 같다.715 exact407462c0c05d77fc5aff62045d645d705f80cf2b의 Quality41398601692·native41398601734를 모두 확인해 정상 병합한 뒤713을 그 main 위에서 새 exact head로 검증한다. canonical 문서는 계속 primary00 단독 소유다.

## 실제 후속 선택 façade 단계 확인

712 중간 preview41396468217은6a40439의 main CI41396068477 성공 뒤 완료됐다. Foundation smoke05:58:29.526Z에서 정확SHA/schema0022, endpoint05:58:31.208Z에서9 routes, 비공개 deployment7485379716/status21145954730 success를 확인했다. recovery artifact13119417914(334B archive, sha256ed2bc996e54b691dc86363b2dbdf246f89b263c3f550af7077c925316179fd2d)의 원본238B·정확5필드·preview/DB/SHA를 확인했다. 원본SHA1132018cf2acf3c3bea3a2c0c5f5770a5cd20b1cb37c798cbafd9df1c3198233·관측2026-11-02T05:52:07.132Z이며 bookmark 원문은 공개하지 않는다. 복원 drill이나 최종713 SHA 검증의 증거가 아니다.

해당 preview에서 기존 제한 합성 사건을 읽은 뒤 같은 후속 선택1회만 수행했다. 최초 실패의 finite DOM은 action UNAVAILABLE/http-status none/transport timeout/step selection_update이며 load 진단은 없었다. 파일·리포트 사전 façade는 통과했지만 update façade의 세션/권한/challenge/송신/응답 중 어느 세부 단계인지나 서버 내부 원인은 단정하지 않는다. 쓰기 재전송 없이 UI 다시확인 GET1회 뒤 세 checkbox가 모두 선택0인 유효 제한 상태를 확인했다.713의 요청 원본 유지와 이 단계의 실제 해결 여부는 마지막 preview에서 확인한다. 새 모델/법률 재시도와 제3자 연락·제출·production 배포는 없다.


715 exact407462c0의 두 CI 성공/CLEAN/최신 main ancestry를 확인한 뒤00이 정상 squash했고 main4a186fa5·병합2026-11-02T06:19:24Z를 기록했다. 순수 read 경합 이슈714는 CI·필요 로컬/DB/native 조건을 만족해 자동 CLOSED(06:19:26Z)됐으며, 실제 외부 인수가 남은620/621과 담당622~627을 함께 닫지 않는다. 713은 해당 main을 정상 merge한 뒤 마지막 quick/build·필요 검증과 새로운 exact head의 세 CI를 확인한다. 이전8ae native 실패는 계속 보존한다.


715 main4a186fa5를 정상 merge한713 최종 로컬 후보는 bun ci·quick(모바일534/domain510 PASS+4 opt-in SKIP/tooling708·7084)·DB drift/fresh/upgrade·build/dry-run/local workerd와 문서139 Markdown/18 ADR 검사를 재통과했다. root 최종 문서/코드 commit의 정확CI와 main SHA는#621에 남긴다. 마지막 PR을 아직 병합하지 않은 이 작성 시점의 상위/담당 실제 외부 인수 상태는 OPEN이며, 원래 c9 full의audit16·사진2 FAIL과8ae native filelist503, 실제 POLICY_REJECTED·selection_update client timeout을 성공으로 덮지 않는다.


## 3f 최종 후보 검증과 만료 실패 경계 수리

3f 수동 full41400468393의 core125130990791은 전체Bun5283 PASS/8 SKIP/1 FAIL·183815 assertions로 실패했다. 기존 v2-expired-undispatched-job HTTP/client 회귀가 만료로 failed 전환된 첫 metadata read의503을 기대했지만715의 넓은 재조회가200으로 흡수했다. 이 실행은 audit 단계에 도달하지 않았으며 과거c9 audit16건과 구분한다.00은 순수 구현 이슈714를 다시 OPEN/in-progress로 바꾸고 clean3f의 별도 브랜치에서 수리한다. 기존 HTTP 실패 assertion은 변경하지 않는다.

stable page의 재조회는 같은 operation·이미 입장된 job의 queued→processing(동일R/job/cipher) 또는 queued/processing→ready(상승R/jobnull)라는 관측 전후 변화에만 허용한다. publication은 실패한 staging namespace를 건너뛸 수 있어 R+1로 제한하지 않는다. 만료·failed·삭제·owner 이탈·역방향·job/operation 대체·동일R cipher 교체·ready 내용 편집이 하나라도 섞인 페이지는 즉시 기존 SNAPSHOT_INVALID→503이다. 다음 명시 읽기는 새 failed/ready 사실을 읽을 수 있다. 기존2쿼리 일반 읽기·전체 페이지3회 한도·네 번째 읽기 금지·실제crypto/DB오류 전파·strict DTO/설치 client는 그대로다. 이는 읽기 전후 head 비교이며 숨은 중간 이력 전체의 새 증명이 아니다.

변경별 집중88 PASS/66487 assertions는 실제 expiry HTTP, 실제 writeProcessed publication, 상승R4, 혼합 페이지와8개 실패/대체 경계를 포함한다.03은 정확 diff를 읽기 전용 검토해 추가 finding0을 회신했다. bun ci·quick(모바일534/domain510 PASS+4 opt-in SKIP/tooling708·7084)과 DB/build를 통과했다. 첫 전체 로컬Bun은 Python pypdf 환경을 누락해 PDF 링크 검사1건에서 실패했다(5295 PASS/6 SKIP/1 FAIL·183928 assertions). 별도 고정 검증 Python을 PATH에 넣은 같은 PDF 검사1 PASS/7 assertions와 전체5296 PASS/6 opt-in SKIP/0 FAIL·183938 assertions(482 files,226.20s)를 확인했다. 실제 Docker PDF→원본 ZIP2 PASS/157 assertions도 통과했다. 이 환경 실패를 제품 변경으로 우회하지 않았다.

3f native125130990770은 실제 Docker PDF/ZIP2 PASS/174 assertions와 전체 native 검사를 통과했다. artifact13121715634(692031B, sha2566b9d9302e074a5190e63e17d8fa6060928cce61a2eba1c48c3c77b5d7474c073)를00이 한 번 내려받고05가 복사본을 검토했다. 합성 청구/방어 각4쪽과 구형3쪽 총11쪽을 새 Poppler 렌더로 시각 검토했고 본문172/172·bbox2141 outside0·공식URI2개씩·UTF16 quote58/89·PDF/ZIP receipt/hash/CRC/110B 원본을 확인했다. 원본14개 전후 hash는 동일하며00도 contact sheet 전쪽과 대표 원본 페이지를 확인했다. 실제 법률 인수의 대체가 아니다.

3f browser125130990457은 네 그룹에서9건 실패했다:03 소유 chat-attachments3,05 소유 report-rework-state lost_ack1,04 소유 shared-mock 양입장 Chromium/WebKit4 및 workspace 첨부link1이다. 실패/현재계약 원인에 따라 독립 PR로 수리하며 timeout이나 assertion을 임의로 완화하지 않는다. artifact13122817433(2528003B, sha256fe25068c506968cc9838ff27750275f4ed82e918d7b101630d59375194c9749c)를00이 한 번 내려받았다.132개(12PDF/12HTML/36PNG/68JSON/4TXT)와 protocol을 보존하고 최종 join SKIP·성공receipt0을 유지한다.

3f preview41400980459는 Foundation06:43:05.882Z의 exactSHA/schema0022와 endpoint06:43:07.527Z의9 routes, 비공개 deployment7485985598/status21147945712 success를 확인했다. recovery artifact13121795010(333B archive, sha256d93cbf10fc2478b6ceaecf2094ec03da6f26aa3bd133d729aa022e70e88e2dd9)의238B 원본·정확5필드·preview/DB/SHA를 확인했다. 원본SHA d48a0206b3a1d2112ae4d6fbc33fcde422b6db5418c6c1f4b9d776113f9c8181·관측2026-11-02T06:36:49.246Z이며 bookmark 값은 비공개다. 복원 drill·전체full 성공 증거가 아니다.

이 preview에서 사용자 직접 로그인한 기존 합성 방어 사건의 “변호사와 해결” 선택1회가 성공해 상담 준비/공유 범위 화면을 확인했다. 쓰기 없는 별도 정상 GET의 저장 결과는 revision2/selection lawyer/basisnull/status not_ready/draftnull이다. 분석 미준비를 준비 완료로 바꾸지 않았고 식별정보·실제 사건 ID·토큰을 이슈/artifact에 남기지 않는다. 이전 client timeout과 미선택 결과도 보존한다. 새 모델/법률 재시도·변호사 연락/제출·production 배포는 없다. 청구 화면의 미전송 입력/첨부는 그대로 보존한다.


03/04의 독립 RED에서 새 conversation-progress mock handler가 이미 존재하지만 중앙 route regex에 누락돼 진입할 수 없음을 확인했다.00은 보존한 clean3f 보조 checkout의 codex/621-mock-progress-route에서 이 공통파일과 실제SDK 회귀만 단독 소유한다. 기존 route를 열고 owned 검사를 거친 progress 읽기에서 기존 ensureMockWorkspace의 due 작업 관측을 소비한다. 새 작업/모델 호출이나 deadline 단축 없이 기존 at/failed/원문/revision 규칙을 사용한다. 구형 conversation DTO와 철회 후 기존 읽기 허용·mutation 거절도 유지하며 별도 선행PR CI/main 뒤03/04가 전체 소비 검증한다.04의 독립 custom fixture도 동일 관측 계약을 따르되 다른 담당 제품 구현을 복제하지 않는다.
