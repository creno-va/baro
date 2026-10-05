# ADR-0011: 검증된 공식 법률 출처의 확대

- Status: Accepted
- Date: 2026-10-06
- Owners: Product, Engineering
- Decision scope: User-approved v2 target; implementation, live capability and public approval remain unverified
- Partial supersession: ADR-0004의 국가법령정보 법령-only 범위를 공식 판례·공식기관 안내까지 확대한다. 모델 기억·일반 검색을 정본으로 쓰지 않는 원칙과 llm/retrieval 분리는 유지한다.

## 맥락

대한민국의 모든 사건 가족을 이해하려면 법령 외 판례와 기관 절차 안내가 필요하다. v1 statute source ID/시행일 필드를 다른 문서에 재사용하면 출처 종류와 최신성 의미가 왜곡된다.

## 결정

1. 법령은 국가법령정보 공식 원문, 판례는 공식 법원/공식 판례 API 원문, 절차 안내는 지정 공식기관 문서를 정본으로 사용한다.
2. sourceType 마다 stable ID·제목·기관·조문 또는 사건번호·결정일/시행일/게시일·verifiedAt·URL·contentHash 와 의미를 정의한다. 존재하지 않는 시행일을 안내/판례에 만들지 않는다.
3. source identity·schema·공식 host/redirect·본문 hash·기준일·주장연결을 legal-retrieval/citation 에서 검증한다. allowlist는 모델 출력에서 만들지 않는다.
4. 공식문서가 없거나 불명확하면 법률 주장을 제외/확인불가로 표시하되 사용자 factual 정리와 리포트는 이용할 수 있게 한다.
5. 전체 KR casefamily는 준비/정리 범위이며 자동 법률판단을 뜻하지 않는다. 출처가 있어도 prohibited 전략/예측/확정판단은 표시하지 않는다.
6. schemaVersion 1 statute citation은 기존 결과에 유지하고 v2 verified-source union 과 cache 계약을 별도로 추가한다.
7. 새 official endpoint·rate/OC·보존/최신성·장애/변경 alarm은 운영 readiness 와 live smoke로 검증한다. fixture 원문은 production fallback이 아니다.

## 고려한 대안

범용 검색 URL·모델이 만든 case 번호·임의블로그를 source로 허용하면 공식정본 검증이 무너진다. 모든 자료에 statute 시행일 필드를 강제하면 허구 metadata가 생긴다.

## 결과

source 별 adapter·schemas·allowlists·cache·eval 확장이 필요하다. 출처 부재를 안전한 부분 응답으로 설명하는 UX 와 claim 검증이 중요하다.

## 후속 결정 또는 미결 사항

실제 endpoint·승인·source coverage·판례날짜·최신성 검증은 구현/환경 이슈에서 수행한다. 현재 v1 법령 live 성공이 확대출처 검증을 대신하지 않는다.

## 참고

- [법률정보 검색](../architecture/LEGAL-RETRIEVAL.md)
- [국가법령정보 공식 가이드](https://open.law.go.kr/LSO/openApi/guideList.do)
- [ADR-0004](./0004-ai-provider-and-legal-retrieval.md)
