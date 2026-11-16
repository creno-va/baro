import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import type { WorkspaceComponents } from "../../product-ui/workspace/slots";
import {
  useWorkspaceController,
  type WorkspaceProps,
} from "../../product-ui/workspace/useWorkspaceController";
import { WorkspaceView } from "../../product-ui/workspace/WorkspaceView";
import { CaseDetail } from "../analysis/CaseDetail";
import { FollowUpResolution } from "../resolution/FollowUpResolution";
import { CaseContextPanel } from "./CaseContextPanel";
import { ConversationAgent } from "./ConversationAgent";
import { ConversationReconfirmation } from "./ConversationReconfirmation";
import { EvidencePicker } from "./EvidencePicker";
import { FileReview } from "./FileReview";
import { LookupDialog } from "./LookupDialog";
export type WorkspaceTab = "chat" | "files" | "timeline" | "actions";
const components: WorkspaceComponents = {
  CaseDetail,
  FollowUpResolution,
  CaseContextPanel,
  ConversationAgent,
  ConversationReconfirmation,
  EvidencePicker,
  FileReview,
  LookupDialog,
};
export function Workspace(props: WorkspaceProps) {
  return <WorkspaceContent key={props.caseId} {...props} />;
}
function WorkspaceContent(props: WorkspaceProps) {
  const controller = useWorkspaceController(props);
  return (
    <GlobalProductTheme className="contents">
      <WorkspaceView controller={controller} components={components} />
    </GlobalProductTheme>
  );
}
