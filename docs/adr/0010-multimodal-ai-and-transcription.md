# ADR-0010: 멀티모달 분석과 음성 전사의 모델 경계

- Status: Accepted
- Date: 2026-10-06
- Owners: Product, Engineering
- Decision scope: User-approved v2 target; implementation, live capability and public approval remain unverified
- Partial supersession: ADR-0004의 기존 Unified Billing 모델·reasoning 과 Gateway 개인정보 경계를 유지한다. Cloudflare-hosted Whisper ASR 경로를 추가하되 자동 모델 fallback을 허용하지 않는다.

## 맥락

새 사건 자료에는 이미지·음성·영상이 포함된다. 기존 text-model 성공이나 catalog 존재만으로 vision 지원·전사 coverage·실제 provider 보존·제품최대 1GB/60분 처리 성공을 보장할 수 없다.

## 결정

1. 기존 openai/gpt-6-sol reasoning medium을 변경하지 않는다. vision 지원·입력 shape·실제 Gateway capability를 구현 시 확인한다. 실패했다고 새 공급자/모델을 임의 선택하지 않는다.
2. 음성 경로는 Cloudflare-hosted @cf/openai/whisper-large-v3-turbo를 사용하고 llm-gateway 경계 안의 명시적 ASR adapter로 관리한다. Chat/ASR의 결제·전송·보존 차이를 각각 문서화한다.
3. Container는 audio 추출/분할·frame sampling을 담당하고 Worker adapter가 모델 호출을 orchestration 한다. 실제 model/API 한도에 맞춘 chunk 와 timestamp를 사용한다.
4. 음성 전 구간 전사와 영상의 전 구간 음성·1초 간격 및 장면 전환 frame을 목표로 처리한다. 매 frame 검증/화자정체/진정성/증거능력을 보장하지 않는다.
5. 사용자 자료 AI 처리 동의·모델 전송 최소화·Gateway logging/cache OFF·ephemeral 처리·원문 비로그·검증 전 출력 금지를 모든 modality에 적용한다.
6. 전사/추출에는 file/page/time·confidence/unknown·coverage gaps를 연결하고 무음·환각·손상·언어실패·재시도·삭제를 검증한다.
7. 모든 실제 호출비용과 ambiguous retry는 월 ledger에 기록하며 하루 media 와 사용자 AIquota는 논리 작업 기준으로 제어한다.

## 고려한 대안

Container가 외부 API 키로 직접 모델 호출하면 기존 호출·예산·privacy 경계를 우회한다. 모델 텍스트만 믿고 영상전체 분석으로 표시하면 coverage 증거가 없다.

## 결과

multimodal capability probe·출력 schema·chunk stitching·품질 평가와 modality 별 보존/과금 검증이 필요하다. ASR 문서의 모델 존재는 해당 계정 live 성공의 증거가 아니다.

## 후속 결정 또는 미결 사항

정확한 입력 파라미터와 오류 shape는 공식 API에 맞춰 고정하고 합성/실제 미디어로 확인한다. 모델/공급자/자동 fallback 변경은 새 결정과 평가를 요구한다.

## 참고

- [AI 파이프라인](../architecture/AI-PIPELINE.md)
- [Whisper 공식 모델 문서](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
- [ADR-0004](./0004-ai-provider-and-legal-retrieval.md)
