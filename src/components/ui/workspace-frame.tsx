import {
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Dialog as HeadlessDialog,
} from "@headlessui/react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { useClientReady } from "./utils";
export interface CaseWorkspaceFrameProps {
  header: ReactNode;
  children: ReactNode;
  panel?: ReactNode;
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
  panelLabel?: string;
  panelId?: string;
  kind?: "conversation" | "document" | "compare";
}
/** A stable portal keeps the same material/editor DOM through inline and sheet modes. */
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
  const clientReady = useClientReady();
  const root = useRef<HTMLDivElement>(null);
  const panelNode = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousOpen = useRef(panelOpen);
  const returnFocusRequested = useRef(false);
  const initialFocus = useRef<HTMLElement | null>(null);
  const [sheet, setSheet] = useState(false);
  const present = panel !== undefined && panel !== null;
  const requestPanelOpen = (open: boolean) => {
    returnFocusRequested.current = !open;
    onPanelOpenChange?.(open);
  };
  useEffect(() => {
    const closed = previousOpen.current && !panelOpen;
    previousOpen.current = panelOpen;
    if (!closed) return;
    const requested = returnFocusRequested.current;
    returnFocusRequested.current = false;
    if (!requested) return;
    const frame = requestAnimationFrame(() => {
      if (toggle.current?.isConnected) toggle.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [panelOpen]);
  useEffect(() => {
    const query = matchMedia("(max-width: 1199px)");
    let deferred = false;
    const update = () => {
      const own = panelNode.current?.closest('[role="dialog"]');
      // Activating a parent modal while a separate review owns focus would
      // make that review inert. Apply the pending viewport mode after it closes.
      if (
        Array.from(
          document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'),
        ).some((node) => node !== own && !node.hasAttribute("hidden"))
      ) {
        deferred = true;
        return;
      }
      deferred = false;
      const active = document.activeElement;
      initialFocus.current =
        active instanceof HTMLElement && panelNode.current?.contains(active)
          ? active
          : closeButton.current;
      setSheet(query.matches);
    };
    update();
    query.addEventListener("change", update);
    const observer = new MutationObserver(() => {
      if (deferred) update();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-modal", "hidden", "open"],
    });
    return () => {
      query.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    const frame = root.current?.closest<HTMLElement>("[data-app-workspace]");
    if (!frame || kind !== "conversation") return;
    const viewport = window.visualViewport;
    const update = () => {
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      panelNode.current?.style.setProperty(
        "--app-viewport-height",
        String((viewport?.height ?? innerHeight) / zoom) + "px",
      );
      frame.style.setProperty(
        "--app-viewport-height",
        String((viewport?.height ?? innerHeight) / zoom) + "px",
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    const resize = new ResizeObserver(update);
    resize.observe(document.documentElement);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      resize.disconnect();
      frame.style.removeProperty("--app-viewport-height");
    };
  }, [kind]);
  return (
    <div
      ref={root}
      className={"case-workspace case-workspace--" + kind}
      data-panel-open={present && panelOpen}
    >
      <section
        className="case-workspace__header"
        aria-label="사건 제목과 작업"
        tabIndex={kind === "conversation" ? 0 : undefined}
      >
        <div className="case-workspace__heading">{header}</div>
        {present && (
          <Button
            ref={toggle}
            className="case-workspace__toggle"
            variant="ghost"
            aria-controls={panelId}
            aria-expanded={panelOpen}
            aria-label={panelLabel + (panelOpen ? " 닫기" : " 열기")}
            disabled={!onPanelOpenChange}
            onClick={() => requestPanelOpen(!panelOpen)}
          >
            {panelOpen ? (
              <PanelRightClose size={18} aria-hidden="true" />
            ) : (
              <PanelRightOpen size={18} aria-hidden="true" />
            )}
            <span>{panelLabel}</span>
          </Button>
        )}
      </section>
      <div className="case-workspace__body">
        <div className="case-workspace__content">{children}</div>
        {present && <div className="case-workspace__panel-space" aria-hidden="true" />}
      </div>
      {present && clientReady && (
        <HeadlessDialog
          static
          open={sheet && panelOpen}
          onClose={() => requestPanelOpen(false)}
          initialFocus={initialFocus.current ? initialFocus : closeButton}
          className="ds-responsive-panel baro-workbench"
          data-mode={sheet ? "sheet" : "inline"}
          data-panel-visible={panelOpen ? "true" : "false"}
        >
          {sheet && <DialogBackdrop className="ds-modal__backdrop" />}
          <DialogPanel
            ref={panelNode}
            id={panelId}
            className="case-workspace__panel"
            data-dialog=""
            hidden={!panelOpen}
          >
            <div className="case-workspace__panel-heading">
              <DialogTitle as="h2" id={panelId + "-title"}>
                {panelLabel}
              </DialogTitle>
              <Button
                ref={closeButton}
                variant="ghost"
                size="icon"
                aria-label={panelLabel + " 패널 닫기"}
                onClick={() => requestPanelOpen(false)}
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </div>
            <div className="case-workspace__panel-content">{panel}</div>
          </DialogPanel>
        </HeadlessDialog>
      )}
    </div>
  );
}
