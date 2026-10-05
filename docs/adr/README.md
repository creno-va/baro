# Architecture Decision Records

ADR은 제품 목표가 아니라 중요한 기술 선택·맥락·대안·결과를 기록한다.
범위는 [PRD](../PRD.md), 동작은 [MVP](../product/MVP-SPEC.md), 실행 shape는 architecture,
운영 절차는 runbook에 둔다.

## 상태와 변경

- `Proposed`: 검토 중이며 구현 기준이 아니다.
- `Accepted`: 채택한 구현 목표다. 실제 구현·외부 지원·법률 승인 완료를 뜻하지 않는다.
- `Superseded`: 새 결정으로 전체 대체되었다.
- `Deprecated`: 더 이상 적용하지 않는다.

Accepted 내용을 바꿀 때 새 ADR을 만들고 대체 범위를 명시한다. 기존 결정 내용은
역사로 보존한다. 부분 대체는 이전 ADR의 status를 무조건 Superseded로 바꾸지 않고
`Partial supersession`/연결 metadata로 범위를 표시한다. 기존 v1에 유효한 불변조건은
계속 적용한다. 0003/0004의 2026-10-05 amendment는 당시 사용자 지시에 따른 기록이다.

파일명은 `NNNN-kebab-case-title.md`이며 번호를 재사용하지 않는다. 모든 ADR은 상태·
날짜·맥락·결정·대안·결과·후속/미결 사항을 포함한다. 미검증 capability는 미검증으로 쓴다.

## 결정 목록

| 번호 | 제목 | 상태 |
| --- | --- | --- |
| [0001](./0001-mvp-system-boundaries-and-ai-pipeline.md) | MVP 시스템 경계와 AI 응답 파이프라인 | Accepted; 안전/모듈 유지 |
| [0002](./0002-web-stack-and-cloudflare-runtime.md) | 웹 스택과 Cloudflare 런타임 | Accepted; web/API Workers 유지 |
| [0003](./0003-identity-data-and-privacy.md) | 인증, 데이터와 개인정보 보호 | Accepted; 암호화/보관/삭제 유지 |
| [0004](./0004-ai-provider-and-legal-retrieval.md) | AI 공급자와 법률정보 검색 | Accepted; 기존 모델/Gateway 유지 |
| [0005](./0005-durable-execution-and-release-gates.md) | durable 실행·개인정보 경계와 출시 게이트 | Accepted; CAS/삭제/공개 gate 유지 |
| [0006](./0006-continuous-case-workspace-and-navigation.md) | 지속적 사건 작업 공간과 준비 내비게이션 | Accepted v2 target |
| [0007](./0007-lawyer-directory-verification-and-moderation.md) | 변호사 디렉터리·자격 확인·공개 심사 | Accepted v2 target |
| [0008](./0008-private-files-and-report-handoff.md) | 비공개 자료와 리포트 전달의 저장·삭제 경계 | Accepted v2 target |
| [0009](./0009-isolated-container-file-processing.md) | 격리된 Containers 자료 처리 | Accepted v2 target |
| [0010](./0010-multimodal-ai-and-transcription.md) | 멀티모달 분석과 음성 전사의 모델 경계 | Accepted v2 target |
| [0011](./0011-verified-official-source-expansion.md) | 검증된 공식 법률 출처의 확대 | Accepted v2 target |
| [0012](./0012-shared-ui-system-and-brand-assets.md) | 공통 UI 시스템·한글 폰트·브랜드 자산 | Accepted v2 target |
| [0013](./0013-resource-admission-and-budget.md) | 자료·AI 사용량과 기술 예산 admission | Accepted v2 target |

## v2 부분 대체 관계

| 기존 | 새 ADR | 바뀌는 범위 / 유지하는 범위 |
| --- | --- | --- |
| 0001 | 0006 | 새 사건을 지속 workspace로 확장 / 모듈·사실·안전·검증 파이프라인 유지 |
| 0002 | 0009,0012 | 격리 파일 processor 런타임 예외·UI 시스템 / Workers web/API·Astro/React/Tailwind 유지 |
| 0003 | 0007,0008 | 공개 프로필 역할·R2/파생물/리포트 삭제 범위 추가 / 기존 계정·owner·암호화·삭제까지 보관 유지 |
| 0004 | 0010,0011 | ASR/multimodal·공식 판례/기관 안내 추가 / pinned text model·medium·Gateway·자동 fallback 금지 유지 |
| 0005 | 0006,0008,0013 | workspace·객체 삭제·다차원 사용량/예산 확장 / guardedwrite·outbox·비중복 userquota·실제 retry 비용·공개 gate 유지 |

v1 데이터·계약·읽기/삭제는 그대로 유지하고 v2 추가 schema/contract는 선행 PR을 통합한다.
신규 ADR의 Accepted는 사용자가 승인한 방향이며 P0.3 또는 v2 마일스톤 완료의 증거가 아니다.
