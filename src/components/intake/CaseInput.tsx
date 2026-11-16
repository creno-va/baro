import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { CaseInputView } from "../../product-ui/intake/CaseInputView";
import { useCaseInputController } from "../../product-ui/intake/useCaseInputController";

export function CaseInput({
  siteKey: _siteKey,
  requireSession = false,
}: {
  siteKey?: string;
  requireSession?: boolean;
}) {
  const controller = useCaseInputController(requireSession);
  return (
    <GlobalProductTheme>
      <CaseInputView controller={controller} requireSession={requireSession} />
    </GlobalProductTheme>
  );
}
