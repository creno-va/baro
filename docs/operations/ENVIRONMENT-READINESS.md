# 환경 readiness — 현재 인수 상태

- Reviewed: 2026-10-14 KST; 총괄 hyunhomon / 현재 정비 채팅.
- 상태는 확인한 시각·환경·SHA 범위만 인정한다. [ADR-0015](../adr/0015-maintenance-and-operating-policy.md)를 따른다.

## 현재 확인된 운영 상태

현재 공개 서비스를 유지한다. 정비 PR230/229/232/233/234/235는 main에 병합됐지만
해당 코드·migration의 원격 적용과 실제 인수는 아직 완료하지 않았다. 이전 배포는
[2026-10-11 동일 SHA receipt](https://github.com/creno-va/baro/issues/71#issuecomment-6107111207)의
범위로 보존하며 새 main을 배포했다고 표시하지 않는다.

| 항목 | 실제 확인 범위 | 남은 담당 행동 |
| --- | --- | --- |
| 비용 DB | status [38522585343](https://github.com/creno-va/baro/actions/runs/38522585343), 양 환경 schema0009·active revision3·allocation1; projection 없음 | 총괄/#57: 최종 후보 migration 후 실제 inventory·용량과 유효한 재원으로 같은 할당 refresh |
| 미정산 | preview ambiguous21,895원·settled283원, production ambiguous44,104원·settled532원 | 비용 모듈: 기존 hold 보존, 개별 호출의 당시 가격·청구 증거 대조 |
| 결제·자원 | 10/14 인증된 Cloudflare 콘솔에서 Workers/R2 Paid·크레딧$39.54·기존 자동충전ON/$10/$30 확인 | 실제 누적 허용 재원·projection 유지비·새 요청 상한 확인; 설정 변경 없음 |
| 두 Gateway | 10/14 인증/ZDR ON, retry/logging/cache/spend-limit OFF, Unified Billing 확인 | #27/#57 실제 모델/사용량·provider 계약 범위 증거; 설정 화면을 실행 성공으로 표시하지 않음 |
| 로컬 Cloudflare CLI | 현재 OAuth는 대상 운영 계정과 다름 | 기존 GitHub Environment credential workflow 사용; 토큰을 로컬/공개 로그로 추출하지 않음 |
| production 승인 | 보호 브랜치 규칙 사용, 필수 reviewer 없음. 정확한 SHA의 두 지정 운영자 receipt 필요 | #71 hyunhomon 또는 hwangeunchan의 최대24시간 기록과 같은 SHA preview 증거 |
| 검색 | PR234 구현·합성 native100/10,000 검증; 원격 projection 미연결 | #231 총괄/변호사 모듈: serving SHA 확인 후 bounded reindex·공개 철회/삭제 smoke |
| 정책 | #20/#70 초안·placeholder 인수 완료, 법률/사실/계약 승인 미확인 | Draft 상태 유지. 정식 공개 checker의 미완료 조건을 승격하지 않음 |

## 남은 실제 인수

#27 Google은 10/14 사용자 수동 검증 완료 확인으로 추가 재검사를 생략한다. Naver/Kakao와
릴리스별 OAuth·Turnstile·복귀 및 모델 retry 증거는 별도이며 사용자 확인을 도구 receipt로 바꾸지 않는다.
#63 법률 모듈은 10/14 로그인한 신청에서 법령·판례 JSON 목록/본문과 목적·도메인을 확인했다.
공식 자가진단은 목록을 표시하지만 직접 인터넷 법령 요청은 현재 OC로도 거부되며 `mobileYn=Y`에서
목록78건 schema/날짜·후보 선택을 확인했다. [범위별 검증 기록](../quality/LEGAL-AUTH-VERIFICATION-2026-10-14.md)의
승인 범위·본문 JSON 조건을 담당기관에 확인하고, 실제 설정/조건 수정 뒤 bounded source
tuple/span을 확보한다. 기관 안내 `update_pending`과 환경별 비밀값 일치·배포 Worker 성공은
별도 미완료다. 기존 API 실패의 조건이 바뀌기 전 같은 호출을 반복하지 않는다.
#58/#59 자료 모듈은 원격 R2/Containers/Whisper·coverage·최대 경계·비용을, #66/#67은
다운로드 bytes·정확한 삭제·늦은 작업 차단을 같은 후보에서 확인한다.

#19 격리 복구는 지정된 합성 전용 대상, DB 밖 최신 deletion journal, 키 복구 관리자,
rollback과 테스트 경보 수신/발송 권한·ACK가 필요하다. production DB restore를 임의 수행하지
않는다. 실제 대상/승인·조건이 준비되지 않은 검사는 pending으로 남긴다.

최종 full·같은 SHA preview/production·제한 합성 흐름과 자료 정리를 완료한 뒤에도
#71 전체 필수 외부 조건은 별도 확인한다. 요구별 담당/증거는 [현재 인수표](../development/MVP-REQUIREMENTS-EVIDENCE.md)를 따른다.
이전 콘솔·설정·실패·배포 기록은 [readiness 이력](../development/ENVIRONMENT-READINESS-HISTORY.md)에 원문 보존한다.
