export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <a className="brand" href={href} aria-label="BARO 홈">
      <img src="/brand/logo.svg" width="32" height="32" alt="" />
      {!compact && <span>BARO</span>}
    </a>
  );
}
