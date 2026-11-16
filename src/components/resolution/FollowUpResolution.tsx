import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { ResolutionView } from "../../product-ui/resolution/ResolutionView";
import {
  type FollowUpResolutionProps,
  useResolutionController,
} from "../../product-ui/resolution/useResolutionController";

export type {
  FollowUpResolutionProps,
  ResolutionClient,
} from "../../product-ui/resolution/useResolutionController";

export function FollowUpResolution(props: FollowUpResolutionProps) {
  const controller = useResolutionController(props);
  return (
    <GlobalProductTheme className="contents">
      <ResolutionView controller={controller} />
    </GlobalProductTheme>
  );
}
