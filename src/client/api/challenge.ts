import { ApiError } from "./errors";

interface TurnstileWidget {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      size: "normal" | "compact";
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
    },
  ): string;
  remove(id: string): void;
}
export async function securityToken(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const sitekey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
  if (!sitekey)
    throw new ApiError("UNAVAILABLE", "보안 확인 설정을 준비하고 있어요. 입력은 유지돼요.", true);
  const browser = window as unknown as { turnstile?: TurnstileWidget };
  if (!browser.turnstile)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const cleanup = () => signal?.removeEventListener("abort", abort);
      const abort = () => {
        script.remove();
        cleanup();
        reject(signal?.reason);
      };
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => {
        cleanup();
        resolve();
      };
      script.onerror = () => {
        cleanup();
        script.remove();
        reject(new ApiError("UNAVAILABLE", "보안 확인을 불러오지 못했어요.", true));
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else document.head.appendChild(script);
    });
  signal?.throwIfAborted();
  if (!browser.turnstile) throw new ApiError("UNAVAILABLE", "보안 확인을 불러오지 못했어요.", true);
  return new Promise<string>((resolve, reject) => {
    const panel = document.createElement("dialog"),
      header = document.createElement("div"),
      heading = document.createElement("h2"),
      label = document.createElement("p"),
      content = document.createElement("div"),
      widget = document.createElement("div"),
      actions = document.createElement("div"),
      cancel = document.createElement("button");
    const titleId = `security-title-${crypto.randomUUID()}`;
    const descriptionId = `security-description-${crypto.randomUUID()}`;
    panel.className = "ui-dialog security-dialog";
    panel.setAttribute("aria-labelledby", titleId);
    panel.setAttribute("aria-describedby", descriptionId);
    header.className = "ui-dialog__header security-dialog__header";
    heading.id = titleId;
    heading.textContent = "보안 확인";
    label.id = descriptionId;
    label.textContent = "사건을 저장하기 전에 보안 확인을 완료해 주세요.";
    content.className = "ui-dialog__content";
    widget.className = "security-dialog__widget";
    actions.className = "security-dialog__actions";
    cancel.className = "ui-button ui-button--secondary ui-button--default";
    cancel.textContent = "취소";
    cancel.type = "button";
    header.appendChild(heading);
    header.appendChild(label);
    content.appendChild(widget);
    actions.appendChild(cancel);
    panel.appendChild(header);
    panel.appendChild(content);
    panel.appendChild(actions);
    document.body.appendChild(panel);
    panel.showModal();
    let widgetId: string | undefined;
    let settled = false;
    const finish = (token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (widgetId) browser.turnstile?.remove(widgetId);
      panel.close();
      panel.remove();
      if (token) resolve(token);
      else
        reject(
          new ApiError(
            "VALIDATION_ERROR",
            "보안 확인이 끝나지 않았어요. 입력을 유지했으니 다시 시도해 주세요.",
            true,
          ),
        );
    };
    const timer = setTimeout(() => finish(), 120000);
    const abort = () => finish();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      finish();
      return;
    }
    panel.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish();
    });
    cancel.onclick = () => finish();
    widgetId = browser.turnstile?.render(widget, {
      sitekey,
      action: "case_create",
      size: window.matchMedia("(max-width: 384px)").matches ? "compact" : "normal",
      callback: (token) => queueMicrotask(() => finish(token)),
      "error-callback": () => finish(),
      "expired-callback": () => finish(),
    });
  });
}
