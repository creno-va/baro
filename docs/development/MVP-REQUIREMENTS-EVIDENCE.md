# MVP 요구사항·현재 인수 증거

- Reviewed: 2026-10-14 KST. GitHub 이슈/PR/run이 진행 상태 정본이다.
- 총괄: hyunhomon / 현재 정비 채팅. 기술 모듈 소유권은 [v2 실행 계획](./V2-EXECUTION.md)을 유지한다.
- 기준: [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), [UI 시연 행렬](../product/UI-DEMONSTRATION.md).

## 현재 판정

고객·자료·리포트·변호사 후속 stack은 PR167→main283af452b7093d8cac0d9aa2c41b28a22b58d5e9에
통합됐다. 이전 source PR들의 독립 CI와 최종 통합은 구분한다. #64는 구현 병합 완료와 실제
모델·공식 출처·비용 인수 미완료를 각각 표시한다. 과거 표의 통합 대기 판정은 현재 상태가 아니다.

정책 초안·사업자 플레이스홀더는 사용자 결정으로 #20/#70의 인수 범위를 충족했다.
실제 법률·사업자 사실·공급자 계약 승인 증거는 아니다. 현재 공개 서비스 유지 허가와
독립 외부 검증 완료는 별도다. 질문2×3, AI200/일, 월·누적 재원·요청 금액 차단 해제, 기존 결제·자동충전이 기준이다.
과거 금액 한도를 인수 조건이나 새 작업의 선행 조건으로 다시 적용하지 않는다.

| 정비 근거 | 인정하는 결과 | 남은 실제 증거 |
| --- | --- | --- |
| PR230→229 | bounded storage와 고객 원본 intent/writer/cleanup 통합 | 실제 inventory/projection·제한 PUT/삭제 |
| PR232 | 후보·환경·검사·reference·hash 증거 검사, 정확한 SHA 운영자 승인 | 최종 후보 실행 증거·수동 승인, 미지원 외부 producer는 실패 유지 |
| PR233/235 | 같은 할당 refresh/CAS/replay·최신 funding, 변호사 원본/공개 복사 비용·용량 연결 | 최신 실제 관측·미정산 보존 재개·청구 대조 |
| PR241 | 월·누적 재원·요청 금액 차단 및 비용 초과 동결 해제, 기존 원장·권한·물리 용량 보존 | 같은 SHA의 환경별 설정·0014 적용과 실제 기능 성공 |
| PR234 | 최소 공개 projection·문자 토큰·daily keyset·요청한 페이지 조회 | 기존 공개 목록 reindex·같은 SHA smoke |
| status run38522585343 | 2026-10-14 실제 양 환경 schema0009·control/노출액·projection 없음 읽기 | 변경/활성화 성공 증거 아님; migration·refresh·실제 처리 별도 |

## 요구별 잔여와 책임

모든 F001~F015 및 UI01~35의 정상/실패 절차는 시연 행렬을 유지한다. 기존 기능 SQL/native/
browser 통과는 구현 범위의 증거다. 최종 후보 full과 실제 플랫폼 증거를 연결해야 전체 인수다.

| 요구/범위 | 담당 이슈·모듈 | 필요한 증거·다음 행동 |
| --- | --- | --- |
| F001/인증·복귀 | 인증 모듈 #27, 총괄 #71 | 환경별 실제 OAuth 성공/취소/만료·동의·Turnstile·returnTo |
| F002~F006/사건·질문·요약·chat·사실·행동 | 고객/AI 모듈 #64/#65, #57/#63 | PR167 구현 재사용; 실제 pinned model/medium V18 critical-zero, quota·unknown hold·공식 출처 tuple/span |
| F007~F008/자료·교정·coverage | 자료 모듈 #58/#59 | 문서·이미지·음성·영상의 실제 제한 처리, 정확한 page/time/gap·취소·재시도·용량·비용 |
| F009/HTML·PDF·ZIP | 리포트 모듈 #66 | 최신 확인 revision·마스킹/제외·저장 HTML/PDF 실제 byte·한글 렌더·선택 원본만 다운로드 |
| F010~F012/자기 프로필·공개 목록·연락 | 변호사 모듈 #62/#61, #231 | 공개 최소 필드·이름/사무실 부분검색·필터·daily cursor·철회/삭제·자격 표시; production 가짜 공개 프로필 금지 |
| F013/admin 심사 UX | ADR-0014 범위 제외 | 기존 backend와 검증된 자격 표시 보존. 자기 선택 role을 자격 승인으로 표시하지 않음 |
| F014/삭제·복구 | 삭제 모듈 #67, 총괄 #19 | 실제 object/instance·late completion·외부 journal·격리 restore/re-delete·rollback·경보 ACK |
| F015/비용 관측·사용량 | 비용 모듈 #57, 총괄 #58/#71 | 금액 차단 없음, 최신 가격·공급자 상태·물리 용량·hold 보존 refresh, 경합/응답 유실/월 경계·원래 가격 정산 |
| UI/재동의·legacy·보안·접근성 | 각 client 모듈 #69/#71 | 재동의 전 기존 읽기/다운로드/삭제·변경 차단, v1 보존, mobile/keyboard/CSP·같은 SHA full |
| 정책/공개 문구 | #20/#70 초안 범위 완료, 총괄 #71 | Draft·placeholder 유지, 실제 법률 승인 미확인 사실 보존 |

## 전체 MVP 종료 조건

최종 main SHA 전체 회귀, 같은 SHA preview 제한 검증과 운영자 승인 production 배포,
합성 자료 정리를 완료한다. G01~G08 결합 시나리오는 추가 사실·재확인·교정/coverage·공식 출처·
날짜 정밀도·재동의·자기 프로필 lifecycle·OAuth 복귀를 같은 후보에서 대조한다.
독립 외부 OAuth/모델/법률/자료·정산·삭제/복구·운영 증거의 담당·필요 결과가 명확해야 한다.
정비 완료만으로 #71이나 M5를 닫지 않는다. 미완료 조건이 있는 PR은 Refs를 사용한다.

이전 요구별 상세 검사와 E-ID/SHA/실패·인계 receipt는 [인수 증거 이력](./MVP-REQUIREMENTS-EVIDENCE-HISTORY.md)에
원문 보존했다. 당시 통합 대기·미지정 담당·#20/#70 법률 승인 대기는 현재 초안 인수 판정과 구분한다.
