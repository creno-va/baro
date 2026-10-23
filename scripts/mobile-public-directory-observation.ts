/** Irreversible boundary: the device must never be screenshotted after entering profile-bearing UI. */
export function anonymousScreenshotGuard<T>(read: () => Promise<T>) {
  let allowed = true;
  return {
    get allowed() {
      return allowed;
    },
    disable() {
      allowed = false;
    },
    async read() {
      if (!allowed) throw new Error("BUNDLED_PUBLIC_SCREENSHOT_FORBIDDEN");
      return read();
    },
  };
}
/** Parse only owned visible UI; never return text, profile values, IDs or raw hierarchy. */
function nodes(xml: string) {
  if (xml.length > 1_000_000 || !xml.startsWith("<?xml"))
    throw new Error("BUNDLED_PUBLIC_HIERARCHY_REQUIRED");
  return [...xml.matchAll(/<node\b[^>]*>/g)]
    .map((m) => {
      const attrs = Object.fromEntries(
          [...m[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
        ),
        bounds = attrs.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
      if (
        attrs.package !== "site.baro.app.preview" ||
        attrs.enabled !== "true" ||
        attrs["visible-to-user"] === "false" ||
        !bounds
      )
        return null;
      const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
      if (
        x1 === undefined ||
        y1 === undefined ||
        x2 === undefined ||
        y2 === undefined ||
        ![x1, y1, x2, y2].every((n) => Number.isFinite(n) && n <= 8192) ||
        x2 <= x1 ||
        y2 <= y1
      )
        return null;
      return {
        labels: [attrs.text, attrs["content-desc"]],
        clickable: attrs.clickable === "true",
        bounds: { x1, y1, x2, y2 },
      };
    })
    .filter((v) => v !== null);
}
export function publicDirectoryButton(xml: string, width: number, height: number) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 8192))
    throw new Error("BUNDLED_PUBLIC_VIEWPORT_REQUIRED");
  const candidates = nodes(xml).filter(
    (n) =>
      n.clickable &&
      n.labels.includes("변호사 탐색") &&
      n.bounds.x2 <= width &&
      n.bounds.y2 <= height &&
      n.bounds.x2 - n.bounds.x1 >= 80 &&
      n.bounds.y2 - n.bounds.y1 >= 80,
  );
  if (candidates.length !== 1) return null;
  const bounds = candidates[0]?.bounds;
  return bounds
    ? { x: Math.floor((bounds.x1 + bounds.x2) / 2), y: Math.floor((bounds.y1 + bounds.y2) / 2) }
    : null;
}
export function publicDirectoryUiObservation(xml: string) {
  const labels = nodes(xml).flatMap((n) => n.labels),
    has = (s: string) => labels.includes(s),
    loadingVisible = has("공개 프로필을 확인하고 있어요"),
    errorVisible =
      has("목록을 불러오지 못했어요") || has("앱 설정을 확인해 주세요") || has("앱을 열 수 없어요");
  return {
    headingVisible: has("변호사 탐색"),
    loadingVisible,
    errorVisible,
    readyEmpty: !loadingVisible && !errorVisible && has("공개된 프로필을 준비하고 있어요"),
    readyProfileCard:
      !loadingVisible && !errorVisible && (has("자격 확인 프로필") || has("본인 작성 프로필")),
  };
}
