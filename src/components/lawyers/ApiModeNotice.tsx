export function ApiModeNotice({ preview = false }: { preview?: boolean }) {
  return import.meta.env.PUBLIC_API_MODE === "mock" ? (
    <p className="lawyer-notice text-sm" role="status">
      API 예시 응답으로 보기 · 합성 프로필과 브라우저 저장소를 사용합니다.
    </p>
  ) : preview ? (
    <p className="lawyer-notice text-sm">Preview 환경 · 실제 API에 연결합니다.</p>
  ) : null;
}
