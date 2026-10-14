# 에이전트 실행 기준

- Reviewed: 2026-10-14 KST
- 정비 총괄: hyunhomon / 현재 정비 채팅. 기존 모듈 소유권은 유지한다.
- 결정: [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), 제품: [PRD](../PRD.md), 상세: [v2 실행 계약](../architecture/V2-CONTRACTS.md).

## 현재 범위와 작업 순서

현재 공개 서비스를 유지하고 신규 기능 확장을 멈춘다. 고객/변호사 두 역할, 질문 최대
2차례×3문항, KST AI 하루200회, 애플리케이션 비용 금액 차단 해제와 기존 결제·자동충전을
유지한다. 정책 초안과 사업자 플레이스홀더는 #20/#70의 초안 인수 범위다. 실제 법률 승인이나
독립 외부 검증 완료를 의미하지 않는다. 정비 종료와 전체 MVP 인수 종료는 별도로 판정한다.

1. README·이슈 명세를 읽고 bun run work:next로 GitHub 선행 구현·열린 PR·작업자를 확인한다.
2. 선행 구현 PR의 검토·필수 CI·main 병합 후 제품 코드를 시작한다. 실제 외부 인수로 열린
   이슈의 CLOSED를 개발 선행으로 요구하지 않는다. 독립 계약·fixture는 명시 범위에서 준비한다.
3. 이슈에 담당·브랜치·현재 blocker·다음 행동을 기록하고 status:in-progress를 붙인다.
   기존 작업/PR을 재사용하고 깨끗한 main에서 codex/<issue>-<purpose> 브랜치를 만든다.
4. 공유 계약·schema는 먼저 조율한다. migration 최신 번호를 확인해 한 담당자가 순차 배정한다.
   0010은 보존하며 현재 구현의 최신 migration은 0014이다. 원격 적용은 배포 증거로 확인한다.
5. 변경별 검증 후 PR로 제출하고 검토·CI가 통과한 정확한 head만 정상 병합한다.

## 담당·blocker·다음 행동

| 작업 | 담당/이슈 | 현재 상태·blocker | 다음 행동 |
| --- | --- | --- | --- |
| 업로드·물리 용량 | 자료 모듈 + 총괄, #58 | PR230→229→235 병합; 원격 inventory/projection·실제 cleanup 미검증 | 실제 opaque inventory와 writer 상태 확인 후 용량 연결·제한 upload/delete |
| 비용 갱신·재개 | 비용 모듈 + 총괄, #57 | 후속 직접 지시의 금액 차단 해제 구현·회귀 검증 중. 현재 preview0013은 금액 차단 상태, production0009는 별도 환경 | 새 설정과0014를 같은 preview SHA에 반영해 금액 차단 해제·기존 원장 보존 검증. 최신 상태/권한·실제 비용 대조는 유지 |
| 릴리스 증거 | 총괄, #19/#71 | PR232 병합; 최종 full·동일 SHA 실제 증거 미완료 | 수동 전체 회귀→preview 제한 smoke→정확한 SHA 운영자 승인→production |
| 디렉터리 | 변호사 모듈 + 총괄, #231/M5 | PR234 병합; 기존 공개 목록의 원격 projection 연결 미완료 | serving SHA 확인 후 bounded reindex, 철회·cursor·필터 smoke |
| 문서·작업 체계 | 총괄, #19/#64/#71 | 현행 기준과 과거 기록 분리 중 | 문서 PR과 이슈/마일스톤의 담당·증거·다음 행동 대조 |
| 채팅 실패·재시도 | 고객/AI, #64 / PR238 | PR238 병합, preview7a617b5/schema0013 반영. run38556937083의 foundation·9개 endpoint 통과, text preflight는 model_reservation_headroom으로 차단. 과거 provider 원인은 로그 유실로 미확정 | 재원·기존 비용 대조 후 합성 사건 재시도1회와 안전한 status/category 검증. 기존 비용53,296원/검증 상한53,410원으로 여유114원, 채팅 예약11,018원 부족. #57의 최신 재원 또는 공급자 정산 증거 필요; hold 임의 해제·재원 확대 금지 |
| 전체 실제 인수 | 각 모듈, #27/#59/#63/#64/#66/#67/#71 | OAuth/실제 모델·공식 출처·media·다운로드·복구/경보 증거 잔여 | [요구사항·증거 완료표](./MVP-REQUIREMENTS-EVIDENCE.md)의 조건별 증거 연결 |

2026-10-14 채팅 수정 preview receipt: main `7a617b5acf08c7168482caa3e08ff07208416270`,
[main CI38556751515](https://github.com/creno-va/baro/actions/runs/38556751515) 성공.
[preview38556937083](https://github.com/creno-va/baro/actions/runs/38556937083)는 Worker 반영과
schema/endpoint 검사는 통과했지만 AI 재원 검사 실패로 전체 실패다. 검증된 배포 성공이나
실제 채팅 성공으로 기록하지 않는다. 미정산21,895원·정산283원·유지비 예약31,118원을
보존했다. production 배포 및 유료 모델 호출은 수행하지 않았다.

2026-10-14 후속 직접 지시로 금액 차단 정책을 변경한다. #57의
`codex/57-disable-application-cost-limits`는 `APPLICATION_COST_LIMITS_ENABLED=false`로
월·누적 재원·요청 금액의 admission/dispatch/refresh/preflight 차단을 해제한다.
위 7a617b5 실패는 당시 정책의 실제 기록으로 보존한다. 새 모드는 기존 비용·미정산을
관측·정산하며 가격/최신 funding 상태·권한·물리 용량·횟수 경계를 유지한다.
0014 예약 금액 표현 변경은 #55에 단일 작성자를 기록했으며 과거 migration은 보존한다.

## 검증과 배포

bun ci 후 validate:quick과 해당 기능의 인증·소유권·CAS·멱등 재시도·실패·삭제 회귀를
실행한다. build 영향은 validate:build, DB 변경은 validate:db의 drift·fresh/upgrade와
실패 rollback을 확인한다. 필요한 browser/native/security 검사를 선택하고 통과한 검사는
새 변경이나 미해결 원인 없이 반복하지 않는다. Bun은 도구용이며 제품 런타임은 Workers다.

모든 구현·문서가 병합된 최종 main SHA를 명시해 GitHub 수동 validate:full을 한 차례
수행한다. 실제 checkout SHA를 증거에 기록하고 CI에서는 유료 호출을 하지 않는다.
같은 SHA를 preview에 배포해 합성 계정·자료로 비용 재개, 업로드, 리포트·다운로드·삭제,
디렉터리를 제한 검증한다. production은 같은 SHA와 #71의 유효한 운영자 승인 기록이
필수다. 승인자는 hyunhomon 또는 hwangeunchan, 정확한 SHA와 최대24시간 유효기간을 검사한다.
현재 Environment에 필수 reviewer가 있다는 가정은 하지 않는다. 비공개 합성 고객 흐름을
검증하며 production 디렉터리에 가짜 변호사를 게시하지 않는다.

기존 정식 공개 checker의 미완료 정책·외부 조건은 보존한다. 공개 운영 허가와 독립 외부
검증, 정책 초안 수용과 법률 승인은 별도 상태다. 다른 SHA/환경의 증거는 대상 소스·의존성·
관련 설정 동일성을 입증한 경우에만 재사용하며 현재 resolver는 보수적으로 다른 SHA를 거부한다.
실패한 외부 검증은 원인이나 조건을 바꾸기 전 반복하지 않는다.

## 데이터·비용·권한 경계

미정산 비용·실행 작업·v1 암호문·공개/자격 표시·삭제 journal을 보존한다. 같은 할당
refresh는 현재 revision과 유효 가격·최신 재원·용량 근거를 원자적으로 검사하고 응답 유실은
동일 입력·operation key로 복구한다. 할당 변경은 기존 양 환경 조율을 유지한다.
만료·중단 재원을 과거 값으로 대체하지 않으며 당시 호출은 당시 가격으로 정산한다.

새 모델/공급자·새 결제수단/자동충전 변경·법률 승인·실제 사업자 사실을 임의 결정하지 않는다.
기존 사용자 승인 결제 경로와 자동충전은 유지한다. OAuth 키·실제 사건·토큰·원문·stack/SQL을
공개 이슈/로그/artifact로 보내지 않는다. 다른 작업자의 checkout·합성 자료·secret을 보존한다.
에이전트·새 채팅·Goal·스케줄을 자동 생성하지 않는다.

## 완료 판정과 이력

실제 외부 인수가 남으면 PR은 Refs를 사용하고 이슈를 열어 둔다. 정비 종료에는 문서·설정·
이슈 정합성, 미정산 보존 재개, 증거 결합, bounded 검색, 최종 회귀·같은 SHA 배포·제한 검증·
자료 정리가 필요하다. #71은 전체 MVP 필수 조건의 담당과 실제 증거가 모두 충족될 때만 닫는다.
M2/M3/M6의 완료 이력은 유지하고 새 정비 마일스톤은 만들지 않는다.

2026-10-11 인계와 이전 A/B/C 경계·실패·배포 receipt는 [실행 이력](./EXECUTION-HISTORY.md)에
보존한다. 이전 수치·담당·승인 대기는 현재 실행 기준이 아니다.
