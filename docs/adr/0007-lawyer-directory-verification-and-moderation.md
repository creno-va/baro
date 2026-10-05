# ADR-0007: 변호사 디렉터리·자격 확인·공개 심사

- Status: Accepted
- Date: 2026-10-06
- Owners: Product, Engineering
- Decision scope: User-approved v2 target; implementation, live capability and public approval remain unverified
- Partial supersession: ADR-0001의 AI 사실/법률 경계와 ADR-0003의 소유권을 유지하고 새 공개 프로필·moderator 역할만 추가한다.

## 맥락

핵심 가치는 사용자가 변호사를 직접 탐색하고 연락하는 것이다. AI가 사건 기반 적합도 순위를 만들거나 미승인 자료를 게시하면 선택·광고·개인정보 경계가 바뀐다.

## 결정

1. 개인 변호사가 직접 등록하고 운영자가 본인·변호사 자격·사무실을 수동 확인한다. 확인 범위와 시각을 표시하고 성과/능력 보장을 하지 않는다.
2. 사진·이름·소개·사무실/지도·객관적 분야·연락·글/이미지/PDF 포트폴리오를 제공한다. 공개될 모든 수정은 revision 별 심사를 요구한다.
3. public는 마지막 승인 revision만 읽는다. pending/rejected가 기존 승인본을 대체하거나 private 포트폴리오를 공개하지 않는다. 자격 철회/숨김/삭제는 public 접근을 제거한다.
4. 목록/프로필은 비로그인 탐색을 지원하고 객관적 필터와 투명한 회전 정렬을 사용한다. 실제 분야/지역의 등록 부족을 표시하고 모집 수·전국 커버리지를 보장하지 않는다.
5. 사건 분석을 directory ranking에 전달하지 않는다. 유료 우선 노출·소개/중개 수수료·플랫폼 내부 상담 메시징을 추가하지 않는다.
6. 연락은 사용자가 전화/email/외부 상담 링크를 직접 선택한다. PDF/ZIP은 사용자가 직접 전달하며 플랫폼이 사건 접근권한을 변호사에게 자동 부여하지 않는다.
7. moderator는 자격/공개내용/신고 심사만 담당한다. 사건·채팅·private 사건 파일·리포트 원문을 보는 관리자 기능은 금지한다.

## 고려한 대안

자동 검증·즉시 게시·사건 맞춤 추천은 자격/공개/법률 경계와 다른 제품을 만든다. 내부 상담을 이번 범위에 넣으면 사건 공유/메시지 보존 계약이 별도로 필요하다.

## 결과

승인 전후 revision·private verification 자료·role 제한·moderation audit가 필요하다. 공개 편집에 대기가 생기지만 이전 승인본과 접근 경계를 유지한다.

## 후속 결정 또는 미결 사항

실제 변호사 확인과 확대 서비스 법률 검토/게시 승인은 미완료다. 수수료가 없다는 사실을 적법성 보장으로 표시하지 않는다.

## 참고

- [MVP](../product/MVP-SPEC.md)
- [UX](../product/UX-SPEC.md)
- [보안](../security/SECURITY-PRIVACY.md)
