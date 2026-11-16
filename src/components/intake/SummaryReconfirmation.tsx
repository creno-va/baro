import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { SummaryReconfirmationView } from "../../product-ui/summary/SummaryReconfirmationView";
import {
  type SummaryReconfirmationProps,
  useSummaryReconfirmationController,
} from "../../product-ui/summary/useSummaryReconfirmationController";

export type { SummaryReconfirmationProps } from "../../product-ui/summary/useSummaryReconfirmationController";

/** A case switch remounts the controller and revokes its pending responses. */
export function SummaryReconfirmation(props: SummaryReconfirmationProps) {
  return <SummaryReconfirmationScene key={props.caseId} {...props} />;
}
function SummaryReconfirmationScene(props: SummaryReconfirmationProps) {
  const controller = useSummaryReconfirmationController(props);
  return (
    <GlobalProductTheme>
      <SummaryReconfirmationView controller={controller} />
    </GlobalProductTheme>
  );
}
