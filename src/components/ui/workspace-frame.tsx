import {
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Dialog as HeadlessDialog,
} from "@headlessui/react";
import { PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../../product-ui/Button";
import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { useProductTheme } from "../../product-ui/Theme";
import { cn, useClientReady } from "../../product-ui/utils";
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
export function CaseWorkspaceFrame(props: CaseWorkspaceFrameProps) {
  return (
    <GlobalProductTheme className="contents">
      <CaseWorkspaceFrameContent {...props} />
    </GlobalProductTheme>
  );
}
function CaseWorkspaceFrameContent({
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
  const theme = useProductTheme();
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
      className={cn(
        "case-workspace case-workspace--" + kind,
        "min-h-0 w-full min-w-0",
        kind === "conversation" && "grid h-full grid-rows-[auto_minmax(0,1fr)]",
      )}
      data-panel-open={present && panelOpen}
    >
      <section
        className={cn(
          "case-workspace__header relative z-10 flex min-h-14 min-w-0 items-center gap-2 border-b border-[var(--pui-border)] bg-[var(--pui-surface)] px-3 sm:px-5",
          kind !== "conversation" && "mb-5 px-0 sm:px-0",
        )}
        aria-label="사건 제목과 작업"
        tabIndex={kind === "conversation" ? 0 : undefined}
      >
        <div className="min-w-0 flex-1">{header}</div>
        {present && (
          <Button
            ref={toggle}
            variant="ghost"
            size="icon"
            aria-controls={panelId}
            aria-expanded={panelOpen}
            aria-label={panelLabel + (panelOpen ? " 닫기" : " 열기")}
            title={panelLabel + (panelOpen ? " 닫기" : " 열기")}
            disabled={!onPanelOpenChange}
            onClick={() => requestPanelOpen(!panelOpen)}
          >
            {panelOpen ? (
              <PanelRightClose size={18} aria-hidden="true" />
            ) : (
              <PanelRightOpen size={18} aria-hidden="true" />
            )}
          </Button>
        )}
      </section>
      <div
        className={cn(
          "case-workspace__body grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]",
          present && panelOpen && "min-[1200px]:grid-cols-[minmax(0,1fr)_var(--wb-panel-width)]",
        )}
      >
        <div
          className={cn(
            "case-workspace__content min-h-0 min-w-0",
            kind === "conversation" && "flex flex-col overflow-hidden",
          )}
        >
          {children}
        </div>
        {present && (
          <div
            className={cn("hidden min-w-0", panelOpen && "min-[1200px]:block")}
            aria-hidden="true"
          />
        )}
      </div>
      {present && clientReady && (
        <HeadlessDialog
          static
          open={sheet && panelOpen}
          onClose={() => requestPanelOpen(false)}
          initialFocus={initialFocus.current ? initialFocus : closeButton}
          className={cn(
            "baro-workbench fixed inset-0 z-40 pointer-events-none",
            sheet ? "z-[70] pointer-events-auto" : "max-[1199px]:hidden",
            !panelOpen && "hidden",
          )}
          data-product-ui=""
          data-theme={theme}
          data-product-workspace-panel=""
          data-mode={sheet ? "sheet" : "inline"}
          data-panel-visible={panelOpen ? "true" : "false"}
        >
          {sheet && <DialogBackdrop className="fixed inset-0 bg-black/30" />}
          <DialogPanel
            ref={panelNode}
            id={panelId}
            className={cn(
              "case-workspace__panel pointer-events-auto absolute right-0 flex min-h-0 max-w-full flex-col overflow-hidden border-[var(--pui-border)] bg-[var(--pui-surface)] p-0 text-[var(--pui-text)]",
              sheet
                ? "inset-y-3 right-3 h-[calc(var(--app-viewport-height,100dvh)-24px)] w-[min(440px,calc(100vw-24px))] rounded-2xl border shadow-xl"
                : "top-14 h-[calc(var(--app-viewport-height,100dvh)-56px)] w-[var(--wb-panel-width)] rounded-none border-0 border-l",
            )}
            data-dialog=""
            hidden={!panelOpen}
          >
            <div
              className={cn(
                "shrink-0 items-center justify-between border-b border-[var(--pui-border)] px-4 py-2",
                sheet ? "flex" : "hidden",
              )}
            >
              <DialogTitle as="h2" id={panelId + "-title"} className="text-sm font-medium">
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
            <div className="min-h-0 flex-1 overflow-auto overscroll-contain">{panel}</div>
          </DialogPanel>
        </HeadlessDialog>
      )}
    </div>
  );
}
