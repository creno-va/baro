import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/product-ui/Button";
import { Dialog } from "../src/product-ui/Dialog";
import {
  ProductExperience,
  ProductExperienceView,
} from "../src/product-ui/experience/ProductExperience";
import {
  type ExperienceController,
  useExperienceController,
} from "../src/product-ui/experience/useExperienceController";

function controller(overrides: Partial<ExperienceController> = {}): ExperienceController {
  return {
    pending: {
      message: "합성 수정 내용을 버리시겠어요?",
      source: null,
      path: "/synthetic-case",
      resolve: () => {},
    },
    cancelButton: { current: null },
    returnFocus: { current: null },
    cancel: () => {},
    discard: () => {},
    ...overrides,
  };
}
function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(value, (node) => {
    if (isValidElement<Record<string, unknown>>(node))
      out.push(node, ...nodes(node.props.children as ReactNode));
  });
  return out;
}
function text(value: ReactNode): string {
  return Children.toArray(value)
    .map((node) =>
      isValidElement<{ children: ReactNode }>(node) ? text(node.props.children) : String(node),
    )
    .join("");
}

describe("product confirmation boundary", () => {
  test("server rendering neither exposes a stale request nor runs the browser effect", () => {
    let c: ExperienceController | undefined;
    function Capture() {
      c = useExperienceController();
      return null;
    }
    expect(renderToStaticMarkup(<Capture />)).toBe("");
    if (!c) throw new Error("MISSING_EXPERIENCE_CONTROLLER");
    expect(c.pending).toBeNull();
    expect(c.cancelButton.current).toBeNull();
    expect(c.returnFocus.current).toBeNull();
    const html = renderToStaticMarkup(<ProductExperience />);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("변경 버리기");
    expect(html).not.toMatch(/\sstyle=|<script|\son[a-z]+=/i);
  });
  test("a pending confirmation supplies the same native dialog name and message without interpreting HTML", () => {
    const c = controller();
    if (!c.pending) throw new Error("MISSING_SYNTHETIC_CONFIRMATION");
    c.pending.message = '<img src=x onerror="synthetic()">';
    const view = ProductExperienceView({ controller: c });
    expect(view.type).toBe(Dialog);
    expect(view.props.open).toBe(true);
    expect(view.props.title).toBe("작성한 내용을 확인해 주세요");
    expect(view.props.description).toBe(c.pending.message);
    expect(typeof view.props.description).toBe("string");
    expect(view.props.preserveMounted).toBe(true);
  });
  test("no request is a closed mounted dialog and cannot fabricate a confirmation", () => {
    const view = ProductExperienceView({ controller: controller({ pending: null }) });
    expect(view.props.open).toBe(false);
    expect(view.props.description).toBeUndefined();
    expect(view.props.preserveMounted).toBe(true);
  });
  test("the safe cancel action is the actual initial-focus ref and retains autoFocus", () => {
    const c = controller();
    const view = ProductExperienceView({ controller: c });
    const buttons = nodes(view).filter((node) => node.type === Button);
    expect(buttons.map((node) => text(node.props.children as ReactNode))).toEqual([
      "계속 작성하기",
      "변경 버리기",
    ]);
    expect(view.props.initialFocus).toBe(c.cancelButton);
    expect(buttons[0]?.props.ref).toBe(c.cancelButton);
    expect(buttons[0]?.props.autoFocus).toBe(true);
    expect(buttons[0]?.props.onClick).toBe(c.cancel);
    expect(buttons[1]?.props.autoFocus).toBeUndefined();
    expect(buttons[1]?.props.onClick).toBe(c.discard);
    expect(view.props.returnFocusRef).toBe(c.returnFocus);
    expect(c.returnFocus.current).toBeNull();
  });
  test("closing, Escape/backdrop and continuing editing all select cancellation; only explicit discard approves", () => {
    const decisions: boolean[] = [];
    const c = controller({
      cancel: () => decisions.push(false),
      discard: () => decisions.push(true),
    });
    const view = ProductExperienceView({ controller: c });
    const buttons = nodes(view).filter((node) => node.type === Button);
    const [cancel, discard] = buttons;
    if (!cancel || !discard) throw new Error("MISSING_CONFIRMATION_ACTIONS");
    expect(decisions).toEqual([]);
    view.props.onClose();
    (cancel.props.onClick as () => void)();
    expect(decisions).toEqual([false, false]);
    (discard.props.onClick as () => void)();
    expect(decisions).toEqual([false, false, true]);
  });
  test("the new prompt has no auth/API or old visual primitive dependency", async () => {
    for (const name of ["ProductExperience.tsx", "useExperienceController.ts"]) {
      const source = await Bun.file(
        `${import.meta.dir}/../src/product-ui/experience/${name}`,
      ).text();
      expect(source).not.toMatch(/from ["'][^"']*(?:client\/api|server\/|components\/ui\/)/);
      expect(source).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
