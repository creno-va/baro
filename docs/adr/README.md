# Architecture Decision Records

BARO의 중요한 기술 결정을 기록한다.

ADR은 하나의 결정과 그 결정의 맥락, 대안, 결과만 다룬다. 제품의 목표와
기능 범위는 PRD에, 반복 가능한 운영 절차는 runbook에, 구현 세부사항은 코드와
기술 문서에 둔다.

## 상태

- `Proposed`: 검토 중이며 아직 구현의 기준이 아니다.
- `Accepted`: 팀이 채택했으며 구현의 기준이다.
- `Superseded`: 새로운 ADR로 대체되었다.
- `Deprecated`: 더 이상 적용하지 않는다.

Accepted ADR의 내용이 바뀌어야 하면 기존 문서를 고치기보다 새 ADR을 만들고
`Superseded by`를 연결한다. 오탈자와 링크 수정은 예외로 한다.

## 작성 규칙

파일명은 `NNNN-kebab-case-title.md` 형식을 사용한다. 번호는 생성 순서대로
증가시키며 재사용하지 않는다.

각 ADR에는 다음 항목을 둔다.

1. 상태와 날짜
2. 맥락
3. 결정
4. 고려한 대안
5. 결과
6. 후속 결정 또는 미결 사항

## 목록

| 번호 | 제목 | 상태 |
| --- | --- | --- |
| [0001](./0001-mvp-system-boundaries-and-ai-pipeline.md) | MVP 시스템 경계와 AI 응답 파이프라인 | Accepted |
| [0002](./0002-web-stack-and-cloudflare-runtime.md) | 웹 스택과 Cloudflare 런타임 | Accepted |
| [0003](./0003-identity-data-and-privacy.md) | 인증, 데이터와 개인정보 보호 | Accepted |
| [0004](./0004-ai-provider-and-legal-retrieval.md) | AI 공급자와 법률정보 검색 | Accepted |
