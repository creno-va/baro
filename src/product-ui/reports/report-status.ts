export function preparationFailureText(code: string) {
  const messages: Record<string, string> = {
    MODEL_UNAVAILABLE: "분석 서비스를 지금 이용할 수 없어요. 저장된 사건은 보존돼요.",
    MODEL_SCHEMA_INVALID: "분석 결과가 검증을 통과하지 못했어요. 다시 준비해 주세요.",
    LEGAL_SOURCE_UNAVAILABLE: "공식 법률 자료의 원문을 확인하지 못했어요.",
    CITATION_INVALID: "법률 설명과 원문 인용이 일치하는지 확인하지 못했어요.",
    JOB_TIMEOUT: "처리 시간이 초과됐어요. 현재 상태를 확인한 뒤 다시 시도해 주세요.",
    STORAGE_UNAVAILABLE: "리포트 저장을 완료하지 못했어요. 기존 리포트는 보존돼요.",
    CRYPTO_DECRYPT_FAILED: "저장한 자료를 확인하지 못했어요. 현재 상태를 다시 확인해 주세요.",
    FILE_PROCESSING_FAILED: "자료 처리를 완료하지 못했어요. 자료 상태를 확인해 주세요.",
    COVERAGE_INCOMPLETE: "자료의 처리 범위를 확인한 뒤 다시 준비해 주세요.",
    USER_QUOTA_EXCEEDED: "오늘의 AI 이용 한도에 도달했어요. 저장된 내용은 확인할 수 있어요.",
  };
  return messages[code] ?? "처리를 완료하지 못했어요. 저장된 내용은 보존돼요. 다시 시도해 주세요.";
}
