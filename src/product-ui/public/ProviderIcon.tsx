export type Provider = "google" | "naver" | "kakao";

export const providers: Array<{ id: Provider; label: string; name: string }> = [
  { id: "kakao", label: "Kakao로 계속하기", name: "카카오로 계속하기" },
  { id: "naver", label: "Naver로 계속하기", name: "네이버로 계속하기" },
  { id: "google", label: "Google로 계속하기", name: "Google로 계속하기" },
];

export function ProviderIcon({ provider }: { provider: Provider }) {
  if (provider === "kakao") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 3C6.48 3 2 6.47 2 10.75c0 2.78 1.89 5.22 4.73 6.59l-.96 3.57a.32.32 0 0 0 .49.35l4.18-2.78c.51.06 1.03.1 1.56.1 5.52 0 10-3.5 10-7.83S17.52 3 12 3Z" />
      </svg>
    );
  }
  if (provider === "naver") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 3h6.15l5.7 8.56V3H21v18h-6.15l-5.7-8.56V21H3V3Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.01v2.5h3.23c1.89-1.74 2.98-4.3 2.98-7.34Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.23-2.5c-.89.6-2.03.96-3.39.96-2.61 0-4.82-1.76-5.61-4.12H3.05v2.59A10 10 0 0 0 12 22Z"
      />
      <path fill="#FBBC05" d="M6.39 13.91a6 6 0 0 1 0-3.82V7.5H3.05a10 10 0 0 0 0 9l3.34-2.59Z" />
      <path
        fill="#EA4335"
        d="M12 5.97c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.5l3.34 2.59C7.18 7.73 9.39 5.97 12 5.97Z"
      />
    </svg>
  );
}
