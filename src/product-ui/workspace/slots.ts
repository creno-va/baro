import type { ComponentProps, ComponentType } from "react";
import type { CaseDetail } from "../../components/analysis/CaseDetail";
import type { FollowUpResolution } from "../../components/resolution/FollowUpResolution";
import type { CaseContextPanel } from "../../components/workspace/CaseContextPanel";
import type { ConversationAgent } from "../../components/workspace/ConversationAgent";
import type { ConversationReconfirmation } from "../../components/workspace/ConversationReconfirmation";
import type { EvidencePicker } from "../../components/workspace/EvidencePicker";
import type { FileReview } from "../../components/workspace/FileReview";
import type { LookupDialog } from "../../components/workspace/LookupDialog";

/** Authenticated child entries are supplied by the existing runtime facade. */
export type WorkspaceComponents = {
  CaseDetail: ComponentType<ComponentProps<typeof CaseDetail>>;
  ConversationReconfirmation: ComponentType<ComponentProps<typeof ConversationReconfirmation>>;
  FollowUpResolution: ComponentType<ComponentProps<typeof FollowUpResolution>>;
  ConversationAgent: ComponentType<ComponentProps<typeof ConversationAgent>>;
  CaseContextPanel: ComponentType<ComponentProps<typeof CaseContextPanel>>;
  EvidencePicker: ComponentType<ComponentProps<typeof EvidencePicker>>;
  FileReview: ComponentType<ComponentProps<typeof FileReview>>;
  LookupDialog: ComponentType<ComponentProps<typeof LookupDialog>>;
};
