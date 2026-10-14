# 환경 readiness — 현재 인수 상태

- Reviewed: 2026-10-14 KST; 총괄 hyunhomon / 현재 정비 채팅.
- 상태는 확인한 시각·환경·SHA 범위만 인정한다. [ADR-0015](../adr/0015-maintenance-and-operating-policy.md)를 따른다.

2026-10-14 후속 정책은 `APPLICATION_COST_LIMITS_ENABLED=false`를 비용 관측 전용으로 정한다.
금액·가격/FX/funding 누락/만료·월할당·수동 refresh·유지비·비용 IO로 기능/배포를 막지 않는다.
실제 권한·기술용량·사용자 quota·provider 오류는 유지한다. [정책과 구현 잔여](./PREBETA-COST-POLICY.md)를
따르며 신규 환경의 가격 proof bootstrap 결합은 아직 남아 있음을 구분한다.

## 현재 확인된 운영 상태

현재 공개 서비스를 유지한다. PR230/229/232/233/234/235와0014를 포함하는
`04f25f804f02e0f221f4b34be0f03edc3d0afd00`의 동일 SHA CI·preview·production이 성공했다.
production 저장 초기화(21:30:58 KST)·당시 같은 할당 refresh(21:31:57 KST) 뒤 일반 채팅의
실제 assistant 본문과 리포트v3·PDF3페이지/3,144,078bytes·HTML14,572bytes 수신을 확인했다.
PDF 한글 렌더를 확인했으며 업로드/ZIP/삭제 전체는 이 증거 범위가 아니다.
[배포·제품 receipt](https://github.com/creno-va/baro/issues/71#issuecomment-6168531808)와
[외부 설정 감사 범위](./PREBETA-COST-POLICY.md#외부-설정-관측-범위)를 따른다.

이번 관측 분리 변경과0015는 `codex/57-prebeta-cost-observation-only`에서 구현 중이며
PR/배포 pending이다. 04f25f8 성공을 이번 변경의 성공으로 표시하지 않는다.

## 이전 관측과 남은 범위

아래 원격 수치·설정은 각 run 당시의 관측이다. 이전 배포도
[2026-10-11 receipt](https://github.com/creno-va/baro/issues/71#issuecomment-6107111207)에 보존한다.

| 항목 | 실제 확인 범위 | 남은 담당 행동 |
| --- | --- | --- |
| 비용 DB | 이전 status [38522585343](https://github.com/creno-va/baro/actions/runs/38522585343), 양 환경 schema0009·active revision3·allocation1; projection 없음 | 이후04f25f8/0014·production 저장 연결 완료. 비용 refresh를 향후 기능 선행 조건으로 요구하지 않음 |
| 미정산 | preview ambiguous21,895원·settled283원, production ambiguous44,104원·settled532원 | 비용 모듈: 기존 hold 보존, 개별 호출의 당시 가격·청구 증거 대조 |
| 결제·자원 | 10/14 이전 Workers/R2 Paid·크레딧$39.54 관측.22시경 Workers Paid/credit$39.21·자동충전ON/$10/$30 확인 | 원본 관측과 실제 비용 보존, 설정 변경 없음. 재원/가격 만료로 기능을 막지 않음 |
| 두 Gateway | 이전 인증/ZDR ON, retry/logging/cache/spend-limit OFF 관측.22시경 Spend Limits/Rate Limit Requests OFF, production Dynamic Routes 없음 | #27/#57 실제 모델/usage·provider 범위와 설정 관측을 구분 |
| 로컬 Cloudflare CLI | 현재 OAuth는 대상 운영 계정과 다름 | 기존 GitHub Environment credential workflow 사용; 토큰을 로컬/공개 로그로 추출하지 않음 |
| production 승인 | 보호 브랜치 규칙 사용, 필수 reviewer 없음. 정확한 SHA의 두 지정 운영자 receipt 필요 | #71 hyunhomon 또는 hwangeunchan의 최대24시간 기록과 같은 SHA preview 증거 |
| 검색 | PR234 구현·합성 native100/10,000 검증; 원격 projection 미연결 | #231 총괄/변호사 모듈: serving SHA 확인 후 bounded reindex·공개 철회/삭제 smoke |
| 정책 | #20/#70 초안·placeholder 인수 완료, 법률/사실/계약 승인 미확인 | Draft 상태 유지. 정식 공개 checker의 미완료 조건을 승격하지 않음 |

## 남은 실제 인수

#27 Google은 10/14 사용자 수동 검증 완료 확인으로 추가 재검사를 생략한다. Naver/Kakao와
릴리스별 OAuth·Turnstile·복귀 및 모델 retry 증거는 별도이며 사용자 확인을 도구 receipt로 바꾸지 않는다.
#63 법률 모듈은 10/14 로그인한 신청에서 법령·판례 JSON 목록/본문과 목적·도메인을 확인했다.
21:10 KST 등록 도메인의 Referer를 추가한 로컬 검사에서 인터넷 JSON 거부가 사라졌고
법령 조문·hash·인용 검사를 통과했다. 실제 판례 날짜/병합 사건번호 형식도 파서에 반영해
본문 tuple/hash를 검증했다. [범위별 검증 기록](../quality/LEGAL-AUTH-VERIFICATION-2026-10-14.md)을
따라 저장된 GitHub credential과 같은 SHA 배포 Worker를 별도로 검사한다. 기관 안내
`update_pending`과 판례 목록의 limited 경계는 유지한다. 기관 문의는 현재 개발의 선행 조건이
아니며, 원문 secret의 일치를 확인했다고 표시하지 않는다.
#58/#59 자료 모듈의 업로드·Containers/Whisper·coverage·최대 경계, #66/#67의 선택 원본 ZIP·
정확한 삭제·늦은 작업 차단은 별도 실제 인수다. 위 PDF/HTML 수신 증거와 섞지 않는다.

#19 격리 복구는 지정된 합성 전용 대상, DB 밖 최신 deletion journal, 키 복구 관리자,
rollback과 테스트 경보 수신/발송 권한·ACK가 필요하다. production DB restore를 임의 수행하지
않는다. 실제 대상/승인·조건이 준비되지 않은 검사는 pending으로 남긴다.

최종 full·같은 SHA preview/production·제한 합성 흐름과 자료 정리를 완료한 뒤에도
#71 전체 필수 외부 조건은 별도 확인한다. 요구별 담당/증거는 [현재 인수표](../development/MVP-REQUIREMENTS-EVIDENCE.md)를 따른다.
이전 콘솔·설정·실패·배포 기록은 [readiness 이력](../development/ENVIRONMENT-READINESS-HISTORY.md)에 원문 보존한다.
