import { CircleAlert } from "lucide-react";
import { Button } from "../Button";

export function QuestionRecovery({
  title,
  description,
  retryDisabled,
  resumeDisabled,
  retry,
  resume,
}: {
  title: string;
  description: string;
  retryDisabled: boolean;
  resumeDisabled: boolean;
  retry: () => void;
  resume: () => void;
}) {
  return (
    <div
      data-product-question-recovery=""
      role="alert"
      className="mt-8 flex items-start gap-3 rounded-2xl border border-[var(--pui-border)] p-4 sm:p-5"
    >
      <CircleAlert
        size={20}
        className="mt-0.5 shrink-0 text-[var(--pui-danger)]"
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
        <p className="text-sm font-medium text-[var(--pui-text)]">{title}</p>
        <p className="text-sm leading-6 text-[var(--pui-muted)]">{description}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={retryDisabled} onClick={retry}>
            다시 시도
          </Button>
          <Button
            variant="secondary"
            data-appearance="outline"
            disabled={resumeDisabled}
            onClick={resume}
          >
            나중에 이어하기
          </Button>
        </div>
      </div>
    </div>
  );
}
