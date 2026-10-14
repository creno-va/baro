# BARO v2 실행 계획

- Reviewed: 2026-10-14 KST
- 정본: [PRD](../PRD.md), [ADR-0015](../adr/0015-maintenance-and-operating-policy.md), [현재 실행](./EXECUTION.md).
- 추적: M5 고객/변호사 실제 기능과 인수, #71 전체 실제 인수. M2/M3/M6 완료 이력은 유지한다.

## 구현과 실제 인수

#53/#54/#55 명세·계약·DB 선행은 이미 main에 통합됐다. 고객·자료·리포트·변호사 후속 stack은
[PR167](https://github.com/creno-va/baro/pull/167)로 통합됐으며 #64의 구현 근거도 PR167이다.
이 구현 병합과 로컬 SQL/native/browser 증거를 실제 OAuth·모델·법률 API·Cloudflare 처리,
운영 복구·정산 완료로 확대하지 않는다. 현재는 신규 기능보다 운영 정비를 우선한다.

| 이슈 | 모듈 소유 범위 | 현재 필요한 증거/행동 |
| --- | --- | --- |
| #53/#54/#55, #87/#93 | 명세·strict shared 계약·공유 DB/유료 실행 계약 | 완료된 구현·migration 보존. 추가 schema는 총괄이 최신 번호 조율 |
| #56/#60/#61/#62 | 디자인·기존 자격 backend·공개 목록·자기 프로필 | 두 역할과 자기 선택/기존 심사 자격 표시 구분. admin UX 제외, 기존 증거 보존 |
| #57 | 사용자 quota·비용 관측/hold와 실행 분리 | 04f25f8 금액 차단 해제 배포. 만료·월할당·refresh·비용 IO 분리는 이번 구현/배포 pending; 신규 환경 가격 proof 결합 잔여 |
| #58/#59 | 원본·파생·R2·Containers·Whisper | PR230/229/235 저장 통합. 실제 용량·writer·네 범주 처리·coverage·실패 cleanup |
| #63 | 공식 출처·schema/date/hash/claim 검증 | 기존 통합 보존. 승인 범위와 bounded live tuple/span 증거 |
| #64/#65 | 질문2×3·요약 확인·지속 chat·고객 client | PR167 구현 병합. 04f25f8 실제 일반 채팅 본문 확인; V18·OAuth/Turnstile·공식 출처 전체 인수는 별도 |
| #66/#67 | HTML/PDF/선택 ZIP·삭제·복구 후 재삭제 | 04f25f8 PDF/HTML 실제 수신·한글 렌더 확인. 선택 ZIP·삭제·journal replay 증거는 별도 |
| #68/#20/#70 | 공개 문구·정책 초안·동의 | 초안/플레이스홀더 인수 완료. 법률 승인 사실을 만들지 않고 Draft 표시 유지 |
| #69 | 두 역할 E2E·접근성·CSP·보안 | 완료된 기능 검증 보존, 최종 후보 전체 회귀와 새 영향 범위 대조 |
| #19/#27/#71 | 환경별 실제 연동·운영·복구·수동 배포 | 명시 SHA full→같은 SHA preview 제한 smoke→운영자 승인→production, 전체 외부 잔여 별도 |
| #231/M5 | 공개 목록 projection·문자 토큰 검색·일별 keyset | PR234 구현. bounded 원격 reindex·필터/철회/삭제 smoke |

## 현재 실행 계약

총괄은 hyunhomon / 현재 정비 채팅이며 기존 인증·AI/법률, 자료·리포트·삭제, 변호사 모듈
소유권은 유지한다. 작업 시작·열린 PR·선행 구현은 bun run work:next로 조회한다.
외부 인수 때문에 OPEN인 이슈를 구현 미병합과 혼동하지 않는다. 새 정비 마일스톤은 만들지 않는다.
M4/M5는 정책 초안 인수 범위를 설명하고 #20/#70의 완료를 실제 법률 승인으로 바꾸지 않는다.

AI200/일·[비용 관측 전용](../operations/PREBETA-COST-POLICY.md)·기존 자동충전/미정산 보존,
두 운영자의 정확한 SHA 승인·최종 수동 full·공개 최소 필드 검색은 ADR-0015를 따른다.
비용 관측 누락/만료·월할당·refresh·비용 IO를 기능/배포 선행 조건으로 요구하지 않는다. 가격/재원은 사용자 API가 받지
않는다. 실제 외부 실패는 조건 변화 전 재시도하지 않는다. 자세한 담당·blocker·다음 행동과
검증·배포 순서는 [현재 실행](./EXECUTION.md), 요구별 잔여는 [인수표](./MVP-REQUIREMENTS-EVIDENCE.md)에 기록한다.

이전 sprint·DAG·개별 구현 SHA와 당시에 유효했던 담당/승인 경계는 [v2 실행 이력](./V2-EXECUTION-HISTORY.md)에 보존한다.
