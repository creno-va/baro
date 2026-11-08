import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./button";

export interface CaseWorkspaceFrameProps {
  header: ReactNode;
  children: ReactNode;
  panel?: ReactNode;
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  panelLabel?: string;
  panelId?: string;
  kind?: "conversation" | "document";
}

/** A single mounted panel becomes a native modal below 1200px; no API or shared island state. */
export function CaseWorkspaceFrame({
  header,
  children,
  panel,
  panelOpen = false,
  onPanelOpenChange,
  panelLabel = "자료",
  panelId = "case-materials-panel",
  kind = "conversation",
}: CaseWorkspaceFrameProps) {
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [desktop, setDesktop] = useState(false);
  const panelPresent = panel !== undefined && panel !== null;
  // Read latest controlled state from queued native close events, including a mode change.
  const current = useRef({ panelOpen, onPanelOpenChange });
  current.current = { panelOpen, onPanelOpenChange };
  useEffect(() => {
    const frame = root.current?.closest<HTMLElement>("[data-app-workspace]");
    if (!frame || kind !== "conversation") return;
    const viewport = window.visualViewport;
    const update = () =>
      frame.style.setProperty(
        "--app-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      frame.style.removeProperty("--app-viewport-height");
    };
  }, [kind]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1200px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inside = focused && node.contains(focused);
    if (node.open) node.close();
    if (panelOpen && panelPresent) {
      if (!inside) previousFocus.current = focused;
      if (desktop) node.show();
      else node.showModal();
      // Native mode changes must preserve the current field/selection, not refocus the first control.
      if (inside) focused.focus({ preventScroll: true });
      else if (desktop && focused?.isConnected) focused.focus({ preventScroll: true });
    } else if (inside) {
      const opener = previousFocus.current;
      const destination =
        opener?.isConnected && opener.getClientRects().length ? opener : toggle.current;
      destination?.focus({ preventScroll: true });
    }
  }, [panelOpen, desktop, panelPresent]);
  useEffect(() => {
    const node = dialog.current;
    return () => {
      if (!node?.open) return;
      node.close();
      const opener = previousFocus.current;
      if (opener?.isConnected && !document.querySelector("dialog:modal")) opener.focus();
    };
  }, []);
  return (
    <div
      ref={root}
      className={`case-workspace case-workspace--${kind}`}
      data-panel-open={panelPresent && panelOpen}
    >
      <div className="case-workspace__header">
        <div className="case-workspace__heading">{header}</div>
        {panelPresent && (
          <Button
            ref={toggle}
            className="case-workspace__toggle"
            variant="ghost"
            aria-controls={panelId}
            aria-expanded={panelOpen}
            aria-label={`${panelLabel} ${panelOpen ? "닫기" : "열기"}`}
            disabled={!onPanelOpenChange}
            onClick={(event) => {
              event.currentTarget.focus();
              previousFocus.current = event.currentTarget;
              onPanelOpenChange?.(!panelOpen);
            }}
          >
            {panelOpen ? (
              <PanelRightClose size={18} aria-hidden="true" />
            ) : (
              <PanelRightOpen size={18} aria-hidden="true" />
            )}
            <span>{panelLabel}</span>
          </Button>
        )}
      </div>
      <div className="case-workspace__body">
        <div className="case-workspace__content">{children}</div>
        {panelPresent && (
          <dialog
            ref={dialog}
            id={panelId}
            className="case-workspace__panel"
            aria-labelledby={`${panelId}-title`}
            onCancel={(event) => {
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              event.stopPropagation();
              onPanelOpenChange?.(false);
            }}
            onClose={(event) => {
              if (event.currentTarget.open || current.current.panelOpen) return;
              current.current.onPanelOpenChange?.(false);
              const opener = previousFocus.current;
              if (
                opener?.isConnected &&
                opener.getClientRects().length &&
                !document.querySelector("dialog:modal")
              )
                opener.focus({ preventScroll: true });
            }}
            onKeyDown={(event) => {
              if (desktop || event.key !== "Tab") return;
              const node = event.currentTarget;
              if (!(event.target instanceof Element) || event.target.closest("dialog") !== node)
                return;
              const controls = [
                ...node.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])',
                ),
              ].filter(
                (element) => element.closest("dialog") === node && element.getClientRects().length,
              );
              const first = controls[0];
              const last = controls.at(-1);
              if (event.shiftKey && document.activeElement === first && last) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last && first) {
                event.preventDefault();
                first.focus();
              }
            }}
            onClick={(event) => {
              if (desktop || event.target !== event.currentTarget) return;
              const rect = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
              )
                onPanelOpenChange?.(false);
            }}
          >
            <div className="case-workspace__panel-heading">
              <h2 id={`${panelId}-title`}>{panelLabel}</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${panelLabel} 패널 닫기`}
                onClick={() => onPanelOpenChange?.(false)}
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
            <div className="case-workspace__panel-content">{panel}</div>
          </dialog>
        )}
      </div>
    </div>
  );
}
