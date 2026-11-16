import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button, type ButtonProps } from "../Button";
import { Dialog } from "../Dialog";
import { TextareaField } from "../Field";

export function ReportButton({ variant = "secondary", ...props }: ButtonProps) {
  return <Button {...props} variant={variant} />;
}
export function Spinner() {
  return (
    <LoaderCircle
      size={17}
      className="shrink-0 animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}
export function LoadingContent({ title }: { title: string; layout?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-24 items-center gap-2 py-6 text-sm text-[var(--pui-muted)]"
    >
      <Spinner />
      <p>{title}</p>
    </div>
  );
}
export function ReportReadonlyText(props: Omit<ComponentProps<"textarea">, "style">) {
  return (
    <TextareaField
      {...props}
      label={props["aria-label"] ?? "보관한 리포트 편집 내용"}
      wrapperClassName="gap-0 [&>label]:sr-only"
      rows={12}
      className="min-h-64 resize-y font-mono text-sm leading-6"
    />
  );
}
export function ConfirmDialog({
  title,
  children,
  busy,
  busyLabel,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  busyLabel?: string;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open
      title={title}
      showCloseButton={false}
      className="pui-report-confirmation"
      panelProps={{ "aria-busy": busy }}
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      {busy && (
        <p role="status" className="mb-4 flex items-center gap-2 text-sm text-[var(--pui-muted)]">
          <Spinner />
          {busyLabel ?? "요청을 처리하고 있어요…"}
        </p>
      )}
      {children}
    </Dialog>
  );
}
