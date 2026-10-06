export function ApiModeNotice({ preview = false }: { preview?: boolean }) {
  // The shared shell already identifies mock mode on every product route.
  return import.meta.env.PUBLIC_API_MODE !== "mock" && preview ? (
    <p className="lawyer-notice text-sm">Preview 환경 · 실제 API에 연결합니다.</p>
  ) : null;
}
