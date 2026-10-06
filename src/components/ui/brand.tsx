export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return <img className={className} src="/brand/logo.svg" width={size} height={size} alt="" />;
}

export function Brand({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <a className="brand" href={href} aria-label="BARO 홈">
      <BrandMark />
      {!compact && <span>BARO</span>}
    </a>
  );
}
