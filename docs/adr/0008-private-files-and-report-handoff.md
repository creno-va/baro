# ADR-0008: 비공개 자료와 리포트 전달의 저장·삭제 경계

- Status: Accepted
- Date: 2026-10-06
- Owners: Product, Engineering
- Decision scope: User-approved v2 target; implementation, live capability and public approval remain unverified
- Partial supersession: ADR-0003의 사용자 삭제까지 보관·애플리케이션 암호화와 ADR-0005의 삭제/복구 보장을 유지하면서 D1-only 저장 범위를 R2 객체와 처리 파생물로 확장한다.

## 맥락

최대 1GB media 와 원본 100개, PDF/ZIP은 D1 문자열 저장으로 처리할 수 없다. 원본·파생물·공개 포트폴리오와 승인 전 private 자료가 같은 버킷/URL에 섞이면 소유권과 삭제를 보장하기 어렵다.

## 결정

1. R2를 원본·파생물·리포트·임시 export 저장에 사용한다. private 사건/자격 증빙과 승인 public 프로필 자산의 접근 경계를 분리한다.
2. D1 에는 owner/revision·opaque object reference·size/hash·처리/삭제 상태만 필요한 범위로 저장한다. private 내용은 암호화하고 파일명 등 민감 메타데이터도 보호한다.
3. 대용량 private 객체는 bounded chunk 애플리케이션 암호화로 저장한다. v1 envelope를 파일 암호화로 재해석하지 않고 versioned blob/part AAD·file key 계약을 별도로 둔다.
4. Worker 전체 body1GB buffering 이나 브라우저 raw R2 credential 공개를 하지 않는다. 인증·owner·quota 예약·part 검증·finalize CAS를 거친 업로드와 제한된 다운로드 경로를 사용한다.
5. 자료 처리 동의 후 자동 처리하며 처리된 쪽/시간/프레임·누락/실패·추출 방식·수정 이력을 저장한다. 추출은 진정성/증거능력 보장이 아니다.
6. 사용자 확인 리포트를 revision 별 PDF로 만들고 기본 식별자 유지·검토/편집/마스킹/제외를 제공한다. 선택 원본 ZIP은 원본이 마스킹되지 않았음을 명확히 하고 사용자가 직접 전달한다.
7. 사용자 삭제까지 보관한다. 삭제는 원본·파생물·context·리포트·temporary export·public 승인자산·처리 instance를 추적하고 늦은 완료 부활을 차단한다. 복구 전에 최신 deletion journal을 재적용한다.

## 고려한 대안

public R2에 모든 자료를 올리거나 브라우저에 저장 키를 주는 방식은 private 경계를 파괴한다. D1 blob·Worker 전체 buffer는 제품 최대 크기와 런타임 요구에 맞지 않는다.

## 결과

upload 예약·chunk crypto·finalize·orphan reconciliation·cross-storage deletion이 필요하다. R2 server-side 암호화만으로 앱 암호화를 대체했다고 주장하지 않는다.

## 후속 결정 또는 미결 사항

실제 1GB upload/download·Container 임시삭제·PDF 한글/ZIP·backup 복구·provider 보존은 검증이 필요하다. 상세 crypto 수치/shape는 architecture 계약과 테스트로 고정한다.

## 참고

- [데이터 모델](../architecture/DATA-MODEL.md)
- [보안](../security/SECURITY-PRIVACY.md)
- [삭제/복구](../operations/DELETION-RESTORE.md)
- [Cloudflare R2](https://developers.cloudflare.com/r2/)
