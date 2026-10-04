# ADR-0004: AI 공급자와 법률정보 검색

- Status: Accepted
- Date: 2026-10-04
- Owners: Engineering, Product
- Last verified: 2026-10-05
- Amended: 2026-10-05 — AI Gateway Unified Billing 채택

## 맥락

BARO의 분석은 구조화 출력, 단계별 재시도, 근거 제한, 공식 법령 인용이 필요하다.
공급자 장애나 모델 변경이 제품 정책을 우회해서는 안 되며, 국가법령정보 API 승인을
기다리는 동안에도 결정론적 개발과 테스트가 가능해야 한다.

## 결정

- 모든 모델 호출은 Worker의 Cloudflare AI binding을 통해 지정된 AI Gateway를
  경유한다.
- AI Gateway Unified Billing과 선불 크레딧을 사용하며 OpenAI 등 모델 공급자의 API
  key를 직접 발급·저장하지 않는다.
- 초기 모델은 Unified Billing catalog에서 확인한 `openai/gpt-6-sol`, reasoning
  effort는 `medium`이다. 구현 시점과 배포 전에 catalog 지원 여부를 다시 확인한다.
- Cloudflare의 통합 모델 인터페이스가 지원하는 JSON Schema 출력을 사용하고 모든 단계
  출력을 Zod로 다시 검증한다.
- AI Gateway는 메타데이터 관측만 허용하고 요청·응답 payload logging을 명시적으로
  끈다.
- gateway와 사용자·모델 단위 spend limit을 설정해 크레딧 소진과 비용 폭주를 차단한다.
- 다단계 실행, 대기, 재시도와 복구는 Cloudflare Workflows가 담당한다.
- 법률 원문은 국가법령정보 공동활용의 공식 API만 정본으로 사용한다.
- API 승인 전 local/CI는 출처 URL·수집일·checksum이 고정된 검증 fixture를 쓴다.
  fixture는 production에서 사용할 수 없다.
- 출처 검증에 실패하거나 시행일을 확인하지 못하면 해당 법률 주장을 결과에서
  제외한다. 모델의 기억을 법률 출처로 사용하지 않는다.
- 모델 ID, 프롬프트, 스키마, 정책은 버전으로 기록해 결과의 재현 가능한 메타데이터로
  남긴다. 사건 원문은 관측 메타데이터에 포함하지 않는다.

모델 버전 변경, 다른 공급자 fallback, 판례 추가는 자동으로 하지 않고 평가셋을 통과한
새 ADR로 결정한다.

## 고려한 대안

- OpenAI 직접 호출/BYOK: 경로는 익숙하지만 provider credential을 별도로 관리해야 하고
  중앙 과금·예산 통제가 분산되어 제외한다.
- 모델의 자체 법률 지식 사용: 최신성·출처를 검증할 수 없어 제외한다.
- 범용 웹 검색: 공식 원문 정본을 보장하기 어려워 제외한다.
- 장애 시 저사양 모델 자동 fallback: 답변 특성이 바뀌고 안전 평가를 우회하므로
  실패 상태와 사용자 재시도를 택한다.

## 결과

- 모델·Gateway·Workflow·법률 API 각각의 장애 상태와 재시도가 필요하다.
- 구조화 출력이 스키마를 만족해도 법률·정책 검증을 별도로 수행해야 한다.
- 배포 전에 AI Gateway credit 잔액, Unified Billing, payload logging 비활성화와 spend
  limit을 환경별로 검증해야 한다.
- 모델 및 플랫폼 사양은 구현 시작과 주요 업그레이드 전에 공식 문서로 다시 확인한다.

## 참고

- [Cloudflare AI Gateway REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/)
- [Cloudflare AI Gateway Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/)
- [Cloudflare AI model catalog](https://developers.cloudflare.com/ai/models/)
- [Cloudflare AI binding](https://developers.cloudflare.com/ai-gateway/usage/worker-binding-methods/)
- [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/)
- [Cloudflare Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [국가법령정보 공동활용 Open API](https://open.law.go.kr/LSO/openApi/guideList.do)
