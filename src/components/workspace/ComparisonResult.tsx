import { useState } from "react";
import type { V2PrecedentComparison } from "../../contracts/v2/precedent-comparison";
import { ComparisonResultView } from "../../product-ui/research/ComparisonResultView";
export function ComparisonResult(props: {
  comparison: V2PrecedentComparison;
  fullText?: string | undefined;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  return <ComparisonResultView {...props} selected={selected} setSelected={setSelected} />;
}
