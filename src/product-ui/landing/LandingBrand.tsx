import { LandingLink } from "./LandingLink";
export default function LandingBrand() {
  return (
    <LandingLink href="/" variant="brand" aria-label="BARO 홈">
      <img src="/brand/logo.svg" width={32} height={32} alt="" />
      <span>BARO</span>
    </LandingLink>
  );
}
