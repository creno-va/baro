import { Button } from "../Button";
import type { WorkspaceController } from "./useWorkspaceController";
export function workspaceHistory(controller: WorkspaceController) {
  const { view, busy, loadHistory } = controller;
  function historyButton(collection: "messages" | "actions" | "timeline", label: string) {
    if (!view?.pagination?.[collection]) return null;
    return (
      <div data-product-workspace-buttons="" className="flex min-w-0 flex-wrap items-center gap-2">
        <p data-product-workspace-muted="" className="text-xs leading-6 text-[var(--pui-muted)]">
          불러온 기록 {view[collection].length}개 · 나머지 기록을 이어서 확인할 수 있어요.
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={!!busy}
          onClick={() => void loadHistory(collection)}
        >
          {label}
        </Button>
      </div>
    );
  }

  return historyButton;
}
