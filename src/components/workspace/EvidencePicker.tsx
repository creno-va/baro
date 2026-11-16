import { EvidencePickerView } from "../../product-ui/evidence/EvidencePickerView";
import {
  type EvidencePickerProps,
  useEvidencePickerController,
} from "../../product-ui/evidence/useEvidencePickerController";
import { GlobalProductTheme } from "../../product-ui/GlobalTheme";

/** Native choosers stay mounted; effects never open a picker or request capture. */
export function EvidencePicker(props: EvidencePickerProps) {
  const controller = useEvidencePickerController(props);
  return (
    <GlobalProductTheme className="contents">
      <EvidencePickerView controller={controller} />
    </GlobalProductTheme>
  );
}
