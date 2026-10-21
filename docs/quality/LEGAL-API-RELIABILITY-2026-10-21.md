# 법률 API 검색·검증 신뢰성 정비 (2026-10-21)

작업: [#304](https://github.com/creno-va/baro/issues/304), `codex/304-legal-retrieval-reliability`.
기준 main: `8d0e9d6f83a9d708474852d2427fd6496b470adb`.
UI PR303과 랜딩, 모델/공급자, DB schema, 비용 정책은 변경하지 않는다.

## 원인과 수정

1. 판례 최신 무필터 결과에 JSON 본문 미지원 국세청 자료가 섞인다.
   [공식 목록 가이드](https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=precListGuide)의
   `datSrcNm=대법원`으로 기존 법원 corpus를 선택한다. 임의 값·중복 query parameter는 거절한다.
   원문/목록 식별자·법원·사건번호·선고일·hash 검증은 유지한다.
2. 판례 검색 건수 상한을 법령 시행 이력 누락과 같은 실패로 취급했다. workspace는1건만
   요청하므로 결과가2건 이상이면 정상 본문도 인용하지 못했다. 검색 범위의 일부만 확인했다는
   `searchTruncated`와 `sourceCoverage.sourcesPartial`을 보존하고, 선택 원문 검증 성공과
   구분한다. 요약만 있는 판례·지원 불가 형식은 여전히 제한한다.
3. 형법103행·근로기준법143행 시행 이력이 첫100행에서 잘렸다. 각 페이지100행·최대5페이지로
   완전한 이력을 확인한 뒤 기존 기준일 선택을 수행한다. 총 건수 변화·잘못된 페이지·누락·중복
   이력은 실패한다. 같은 공포본(MST)의 서로 다른 시행일은 정상 이력으로 보존한다.
   요청별 권한·취소·quota와 전체30회/workspace12회 상한은 유지한다. 500행 초과 이력을
   최신으로 위장하지 않는다.
4. 일반 법률상담 key가 범죄피해자 전용 문서를 가리켰다. 같은 승인 기관/endpoint의
   [일반 법률구조 안내](https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=568&ccfNo=2&cciNo=2&cnpClsNo=1)로
   수정한다. 공식 페이지 개정 검토 중 표시는 실제로 존재하므로 `update_pending`과 인용 제외는
   유지한다. 전체 readiness 성공으로 위장하지 않는다.
5. 요청별 헤더 수신 시간과 전체 파싱·인용 검증 시간을 안전한 진단 receipt에 추가한다.
   수동 `legal-readiness-workerd.ts`는 실제 workerd의 공식 서버 호출을 검증한다.
   배포 Worker나 로그인·유료 모델을 통한 제품 E2E로 확대하지 않는다.

## 실제 공식 서버 검증

실제 키는 로컬 binding으로만 주입했다. 원문·키·인증 query URL·사건번호·예외 원문은
공개 로그/artifact에 남기지 않는다. 아래는 대역이 아닌 실제 공식 서버 응답이다.

| 범위 | 시각 UTC | 결과 | 요청/소요 |
| --- | --- | --- | --- |
| 민법598조·대여금 판결2건·일반 구조 안내 | 10:53:09 | 법령/판결3원문 verified, 인용3건 통과. 안내 update_pending | 6회/2,052ms |
| 주택임대차보호법3조의2 | 10:53:12 | verified, 인용1건 통과 | 2회/523ms |
| 임대차·임금·손해배상 판결 각1건 | 10:56:51 | 3건 verified, 인용3건 통과. 검색 일부 표시 보존 | 6회/1,191ms |
| 형법347조·근로기준법23조·개인정보 보호법15조 | 11:01:42 | 페이지 처리 수정 후3건 verified, 인용3건 통과 | 8회/2,274ms |
| 최종 selector 포함 민법·대여금 판결2건 | 11:08:04 | 3원문 verified, 인용3건 통과 | 5회/1,310ms |
| 최종 selector 포함 주택임대차보호법3조의2 | 11:08:06 | verified, 인용1건 통과 | 2회/579ms |

모든 요청 HTTP200, 인증 거절0. 호출 위치 **local-workerd**, deployedWorker=false.
계측에는 원문 조회·파싱·hash·인용 검사만 포함하며 원격 D1·모델 시간은 포함하지 않는다.
전체 채팅이2초라는 뜻이 아니며 모든 법령/판례의 완전한 coverage를 입증하지 않는다.

## 재현과 회귀

환경 secret을 안전하게 주입한 뒤 수동으로만 실행한다. 키를 CLI 인수/공개 artifact에 기록하지 않는다.

```powershell
$env:READINESS_LEGAL_SCOPE='core_sources'
bun scripts/legal-readiness-workerd.ts
```

scope: standard, core_sources, statute_matrix, precedent_matrix, housing_article_3_2.
standard는 안내까지 모두 verified여야 진단 성공한다. core/matrix는 전체 readiness나 release
evidence가 아니다. 진단별9회·120초 제한을 유지한다. 주기 실행/자동 에이전트는 추가하지 않는다.

법률·실제 SQLite binding/캐시·인용·workspace/model 경계·workerd·실패/권한/취소·페이지 상한
회귀238개/1,411assert 통과. quick/build 및 정확한 최종 SHA의 PR CI는 #304에 기록한다.

## 배포와 잔여 조건

점검 당시 production `1059887ae8ad1998b6e5432c6ba2da4d5ed4679e`/schema0015,
preview `8d0e9d6f83a9d708474852d2427fd6496b470adb`/schema0016을 공개 health로 확인했다.
운영에는 redirect:error가 남아 있고 기존 수정 f2a4fd5/a91dc00이 미포함이다.
로컬 workerd의 error 거절/manual 허용은 운영 원격 호출 성공 증거와 구분한다.

같은 SHA의 main CI/full 검사·preview smoke·기존 #71 운영 승인/인수 조건을 갖춘 배포가 필요하다.
health ready는 D1 schema만 확인하므로 법률 API 성공 증거가 아니다. 기관 안내 실제 개정 대기,
현재 법률 E2E·운영 credential·remote Worker 검증은 로컬 성공과 구분한다.
