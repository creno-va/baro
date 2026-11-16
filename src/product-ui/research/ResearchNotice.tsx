import { LoaderCircle } from "lucide-react";

export function ResearchSpinner() {
  return (
    <LoaderCircle
      size={16}
      data-product-research-spinner=""
      className="inline shrink-0 animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}
