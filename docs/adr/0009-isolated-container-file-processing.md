# ADR-0009: 격리된 Containers 자료 처리

- Status: Accepted
- Date: 2026-10-06
- Owners: Product, Engineering
- Decision scope: User-approved v2 target; implementation, live capability and public approval remain unverified
- Partial supersession: ADR-0002의 Worker Web API 런타임을 web/API에 유지한다. 무거운 자료 처리 서비스에만 독립적인 Container 런타임 예외를 둔다.

## 맥락

문서 렌더링·OCR 보조·영상/음성 분리·프레임 sampling·PDF/ZIP 처리에는 native codec, 파일시스템과 더 긴 CPU 처리가 필요하다. Worker에 Node process/fs를 넣는 것은 기존 경계를 깨뜨린다.

## 결정

1. Cloudflare Containers를 무거운 자료 처리 실행 경계로 사용한다. Astro/Hono/인증/권한/DB/모델 orchestration은 Workers에 남긴다.
2. Container 소스·Docker image·dependency/runtime 검사·test/build를 top-level 격리 서비스로 분리한다. Worker의 Bun/Node filesystem/process 금지와 source gate를 유지한다.
3. Worker/Workflow가 opaque job/revision 과 범위 제한된 입력 접근을 전달한다. Container는 요청한 작업의 private 자료만 잠시 복호화/처리하고 파일·출력·stdout/stderr 원문 기록을 금지한다.
4. 작업별 메모리/disk/CPU/timeout/concurrency 와 inactive shutdown·cleanup을 제한한다. 실패/취소/삭제 후 임시 plaintext를 정리하고 늦은 결과는 alive/revision guard로 거부한다.
5. Container가 모델 공급자·법률 API를 직접 호출하지 않는다. 모델은 llm-gateway, 법률 자료는 legal-retrieval를 통과한다.
6. 환경별 binding·이미지 digest·job status·비용·retention은 운영 명세에 포함하고 실제 capability를 확인한 뒤 deploy 한다.

## 고려한 대안

web/API 전체를 Node 서버로 이전하거나 Worker 제약을 무시한 native package import는 현재 스택/비용/권한 요구와 맞지 않는다. browser-only 처리는 장기 재시도와 server 검증이 불완전하다.

## 결과

별도 이미지 빌드·plan/binding·cold start·job 제한·삭제/보존 검증이 필요하다. mainWorker 와 Container release의 연결 증거를 기록한다.

## 후속 결정 또는 미결 사항

Cloudflare 공식 문서는 Workers Paid 와 Container lifecycle을 설명하지만 현재 계정 entitlement, 선정 instance 한도, 실제 파일 처리 성공은 검증 전이다. 비용은 ADR-0013의 한도 안에서만 사용한다.

## 참고

- [시스템](../architecture/SYSTEM.md)
- [ADR-0002](./0002-web-stack-and-cloudflare-runtime.md)
- [Containers 공식 문서](https://developers.cloudflare.com/containers/)
