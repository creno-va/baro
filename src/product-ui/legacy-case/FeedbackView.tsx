import { Button } from "../Button";
import { LegacyCaseSection, legacyMutedClass } from "./LegacyCaseParts";
import type { FeedbackController } from "./useFeedbackController";

export function FeedbackView({ controller }: { controller: FeedbackController }) {
  const { busy, message, save } = controller;
  return (
    <LegacyCaseSection title="도움이 됐나요?" data-product-legacy-feedback="">
      <p className={legacyMutedClass}>
        선택 사항이에요. 도움 여부만 사건과 함께 보관하며 사건 삭제 시 지워져요. 원문이나 자유
        의견은 수집하지 않아요.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" type="button" disabled={busy} onClick={() => void save(true)}>
          도움이 됐어요
        </Button>
        <Button variant="secondary" type="button" disabled={busy} onClick={() => void save(false)}>
          도움이 되지 않았어요
        </Button>
      </div>
      <p aria-live="polite" className="text-sm leading-7 text-[var(--pui-muted)]">
        {busy ? "도움 여부 저장 중" : message}
      </p>
    </LegacyCaseSection>
  );
}
