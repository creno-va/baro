# 후속 해결 연결

`createResolutionService`는 직접 해결·변호사와 해결·리포트 저장 선택과 초안의 중단·재개·검토·저장을 처리한다. `FollowUpResolution`을 대화와 리포트가 함께 사용하며, 리포트 저장은 호스트의 기존 다운로드 함수를 호출한다. 제출·발송·상담 자료 전송은 수행하지 않는다.

## 공식 절차 안내

`selectReviewedProcedurePlans(context)`는 기존 EasyLaw endpoint의 검토한 plan을 최대 두 개 반환한다. `buildProcedureSources({ context, asOfDate, now, outcomes })`는 네트워크 없이 `procedureChecks`, `documentSupport`, `citations`, `sourceClaims`, `limitations`를 반환한다. 미확인 단계나 일반 안내를 확인하지 못한 형사 진술서·의견서·항소 문서는 확인할 행동으로 남긴다. 폭행·상해 전용 안내를 모든 형사 사건에 적용하지 않는다.

호출자는 다음 경계를 유지한다.

- 기존 legal-retrieval로 총 12회·120초 안에서 법률 조사와 요청 예산을 공유한다. GET·PDF·다운로드에서 조회하지 않는다.
- 입력은 서버가 얻은 SourceOutcome이다. 요청 JSON의 source/availability를 받지 않는다. `verified`와 `reason=null` 외에는 문서 지원을 열지 않는다.
- helper는 출처 identity·원문 hash·extractor·TTL·검증 시각·citation·전체 본문 span을 재검증한 뒤, 한 번만 나타나는 검토한 literal quotation을 사용한다. 확인 시각을 현재 시각으로 바꾸지 않는다.
- root가 현재 owner·동의·basis·lease와 source binding을 검증하고 immutable 결과를 암호화 저장한다. 게시와 읽기 시 현재 원문 authority를 다시 검사한다. 저장 후 원문이 달라지면 기존 결과를 새 원문으로 조용히 교체하지 않는다.
- 원문에 기재된 일반 작성 안내는 개별 사건의 관할·담당부서·송달일·기한을 확정하는 근거가 아니다. 서비스의 개별 확인 항목은 유지한다.

SourceOutcome는 chunk가 없는 실패에 plan identity를 담지 않는다. helper는 이러한 실패 원인들을 묶어 알리며 개별 guide의 실패라고 단정하지 않는다.

## 실제 관측과 합성 검증

2026-11-01 공개 안내 11개를 기존 bounded transport/parser로 조사한 결과, 민사 안내 등은 `update_pending`, 일부 형사 안내는 `image_omitted`였다. 당시 시각·hash·기준일·URL은 `tests/fixtures/resolution/procedure-source-observations.json`에 보존했다. 실제 owner/basis binding이나 법률 승인을 받았다는 의미가 아니다. 현재 관측으로는 전문 문서 지원을 열지 않고 사실 정리 초안을 유지한다. 동일 실패 조건으로 외부 조회를 반복하지 않는다.

`resolution-procedure-sources.test.ts`의 verified 원문은 짧은 합성 본문이다. 실제 기관의 검증 성공으로 표현하지 않는다. 원문 변경·중복 인용·만료·위조 proof·단계 불일치·실제 limited receipt 회귀와 resolution service 연결을 검증한다.
