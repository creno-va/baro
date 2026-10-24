type Display = {
  width: number;
  height: number;
  keyboardVisible: boolean;
  keyboardTop: number | null;
};
function attributes(text: string) {
  const pairs = [...text.matchAll(/([\w:-]+)="([^"]*)"/g)];
  if (new Set(pairs.map((pair) => pair[1])).size !== pairs.length)
    throw Error("ANDROID_DIRECTORY_HIERARCHY_INVALID");
  return Object.fromEntries(pairs.map((pair) => [pair[1], pair[2]]));
}
function box(text: string | undefined, width: number, height: number) {
  const match = text?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  if (!match) return null;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (
    left === undefined ||
    top === undefined ||
    right === undefined ||
    bottom === undefined ||
    ![left, top, right, bottom, width, height].every(
      (v) => Number.isSafeInteger(v) && v >= 0 && v <= 8192,
    ) ||
    right <= left ||
    bottom <= top ||
    right > width ||
    bottom > height
  )
    return null;
  return { left, top, right, bottom };
}

/** Public owned Emulator only. Return no labels, package names, hierarchy or input values. */
export function androidDirectorySoftwareSearch(xml: string, display: Display, component: string) {
  if (
    xml.length > 1_000_000 ||
    !xml.startsWith("<?xml") ||
    /<!DOCTYPE|<!ENTITY/.test(xml) ||
    !/<displays>/.test(xml) ||
    !xml.trimEnd().endsWith("</displays>")
  )
    throw Error("ANDROID_DIRECTORY_HIERARCHY_INVALID");
  const ime =
    component.trim().length <= 512
      ? component.trim().match(/^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)\/[A-Za-z0-9_.$]+$/)?.[1]
      : undefined;
  const displays = [...xml.matchAll(/<display\b([^>]*)>([\s\S]*?)<\/display>/g)].filter(
    (m) => attributes(m[1] ?? "").id === "0",
  );
  const body = displays.length === 1 ? (displays[0]?.[2] ?? "") : "";
  const windows = [...body.matchAll(/<window\b([^>]*)>([\s\S]*?)<\/window>/g)].filter(
    (m) => attributes(m[1] ?? "").type === "TYPE_INPUT_METHOD",
  );
  const window = windows.length === 1 ? windows[0] : undefined;
  // Nested window structures are not accepted as a flat IME hierarchy.
  const windowBody = window && !/<window\b/.test(window[2] ?? "") ? (window[2] ?? "") : "";
  const windowBox = window
    ? box(attributes(window[1] ?? "").bounds, display.width, display.height)
    : null;
  const elements = [...windowBody.matchAll(/<node\b([^>]*)>/g)];
  if (elements.length > 10000) throw Error("ANDROID_DIRECTORY_HIERARCHY_INVALID");
  const controls = elements
    .map((m) => attributes(m[1] ?? ""))
    .filter(
      (node) =>
        ime &&
        node.package === ime &&
        [node.text, node["content-desc"]].some(
          (label) => label === "검색" || label?.toLowerCase() === "search",
        ),
    );
  const control = controls.length === 1 ? controls[0] : undefined;
  const controlBox = control ? box(control.bounds, display.width, display.height) : null;
  const withinWindow =
    !!controlBox &&
    !!windowBox &&
    controlBox.left >= windowBox.left &&
    controlBox.top >= windowBox.top &&
    controlBox.right <= windowBox.right &&
    controlBox.bottom <= windowBox.bottom;
  const belowKeyboardTop =
    !!controlBox &&
    display.keyboardVisible &&
    display.keyboardTop !== null &&
    Number.isSafeInteger(display.keyboardTop) &&
    display.keyboardTop > 0 &&
    display.keyboardTop < display.height &&
    controlBox.top >= display.keyboardTop;
  const enabledClickable =
    control?.enabled === "true" &&
    control.clickable === "true" &&
    control["visible-to-user"] !== "false";
  const diagnostic = {
    imeComponentValid: !!ime,
    defaultDisplayCount: displays.length,
    imeWindowCount: windows.length,
    matchingControlCount: controls.length,
    controlWithinImeWindow: withinWindow,
    controlBelowKeyboardTop: belowKeyboardTop,
    controlEnabledClickable: enabledClickable,
    uniqueUsableControl:
      controls.length === 1 && withinWindow && belowKeyboardTop && enabledClickable,
  };
  return {
    diagnostic,
    point:
      diagnostic.uniqueUsableControl && controlBox
        ? {
            x: Math.floor((controlBox.left + controlBox.right) / 2),
            y: Math.floor((controlBox.top + controlBox.bottom) / 2),
          }
        : null,
  };
}
