import {
  DialogPanel,
  DialogTitle,
  Button as HeadlessButton,
  Dialog as HeadlessDialog,
} from "@headlessui/react";
import { cva } from "class-variance-authority";
import clsx from "clsx";
import { AlertCircle, ArrowRight, LoaderCircle, X } from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import { browserSessionScope } from "../../client/api/context";
import { errorMessage } from "../../client/api/errors";

/** Delayed mutation callbacks may run after their old view has unmounted. */
export function useViewGuard() {
  const generation = useRef(browserSessionScope.snapshot());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return () => mounted.current && browserSessionScope.isCurrent(generation.current);
}

const buttonVariants = cva(
  "web-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "web-button--primary",
        secondary: "web-button--secondary",
        ghost: "web-button--ghost",
        danger: "web-button--danger",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);
export function Button({
  children,
  variant = "primary",
  className,
  disabled = false,
  autoFocus = false,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <HeadlessButton
      type={type}
      disabled={disabled}
      autoFocus={autoFocus}
      className={twMerge(clsx(buttonVariants({ variant }), className))}
      {...props}
    >
      {children}
    </HeadlessButton>
  );
}

export function Loading({ children = "내용을 불러오고 있어요." }: { children?: ReactNode }) {
  return (
    <div className="web-loading" role="status">
      <LoaderCircle size={20} className="web-spin" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function Problem({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="web-problem" role="alert">
      <AlertCircle size={19} aria-hidden="true" />
      <div>
        <p>{errorMessage(error)}</p>
        {retry && (
          <Button variant="secondary" onClick={retry}>
            다시 확인하기
          </Button>
        )}
      </div>
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="web-empty">
      <span className="web-empty__mark" aria-hidden="true">
        b.
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Brand() {
  return (
    <a className="web-brand" href="/" aria-label="BARO 홈">
      <span className="web-brand__mark" aria-hidden="true">
        b.
      </span>
      <span>
        baro<span className="web-brand__dot">.</span>
      </span>
    </a>
  );
}

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  // Headless portal placeholders use inline styles before mounting; keep those
  // placeholders out of server HTML under the strict style-attribute policy.
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => setClientReady(true), []);
  if (!clientReady) return null;
  return (
    <HeadlessDialog open onClose={onClose} className="web-dialog-root">
      <div className="web-dialog-backdrop" aria-hidden="true" />
      <div className="web-dialog-position">
        <DialogPanel className="web-dialog">
          <header>
            <DialogTitle>{title}</DialogTitle>
            <Button variant="ghost" aria-label="닫기" onClick={onClose}>
              <X size={20} />
            </Button>
          </header>
          {children}
        </DialogPanel>
      </div>
    </HeadlessDialog>
  );
}

export function SectionTitle({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="web-section-title">
      <div>
        <p className="web-eyebrow">{label}</p>
        <h2>{title}</h2>
      </div>
      {children}
    </header>
  );
}

export function Continue({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button {...props}>
      {children}
      <ArrowRight size={17} aria-hidden="true" />
    </Button>
  );
}

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "날짜 미확인"
    : new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
        timeZone: "Asia/Seoul",
      }).format(date);
}

export function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
