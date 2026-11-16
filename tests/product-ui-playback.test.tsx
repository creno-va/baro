import { describe, expect, test } from "bun:test";
import { Button as HeadlessButton } from "@headlessui/react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MediaPlayer } from "../src/components/ui/media-player";
import { Button } from "../src/product-ui/Button";
import { MediaPlayerView } from "../src/product-ui/playback/MediaPlayerView";
import { Range } from "../src/product-ui/playback/Range";
import {
  type MediaPlayerController,
  type MediaPlayerProps,
  useMediaPlayerController,
} from "../src/product-ui/playback/useMediaPlayerController";
import { SelectField } from "../src/product-ui/Select";

const props: MediaPlayerProps = {
  src: "/__synthetic-original.wav",
  label: "합성 원본",
  kind: "audio",
};
function controller(input: Partial<MediaPlayerProps> = {}): MediaPlayerController {
  let captured: MediaPlayerController | undefined;
  function Capture() {
    captured = useMediaPlayerController({ ...props, ...input });
    return null;
  }
  renderToStaticMarkup(<Capture />);
  if (!captured) throw new Error("MISSING_SYNTHETIC_PLAYBACK_CONTROLLER");
  return captured;
}
function nodes(value: ReactNode): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  Children.forEach(value, (node) => {
    if (isValidElement<Record<string, unknown>>(node))
      out.push(node, ...nodes(node.props.children as ReactNode));
  });
  return out;
}
const tree = (overrides: Partial<MediaPlayerController> = {}) =>
  MediaPlayerView({ controller: { ...controller(), ...overrides } });
function button(value: ReactNode, name: string) {
  const found = nodes(value).find(
    (node) => node.type === Button && node.props["aria-label"] === name,
  );
  if (!found) throw new Error(`MISSING_PLAYBACK_BUTTON:${name}`);
  return found;
}
function range(overrides: Partial<Parameters<typeof Range>[0]> = {}) {
  let result: ReactElement<Record<string, unknown>> | undefined;
  function Capture() {
    result = Range({
      label: "합성 재생 위치",
      value: 0,
      max: 20,
      onChange: () => {},
      ...overrides,
    });
    return null;
  }
  renderToStaticMarkup(<Capture />);
  if (!result) throw new Error("MISSING_SYNTHETIC_RANGE");
  return result;
}
/** A decoder port, not a browser or a claim that native media was exercised. */
function decoder(overrides: Partial<HTMLMediaElement> = {}) {
  return {
    error: null,
    readyState: 1,
    paused: true,
    ended: false,
    duration: 20,
    currentTime: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    ...overrides,
  } as HTMLMediaElement;
}

describe("original decoder and native media boundary", () => {
  test("the compatible public entry keeps audio private and does not request playback during SSR", () => {
    const html = renderToStaticMarkup(<MediaPlayer {...props} />);
    expect(html).toContain('aria-label="합성 원본 재생기"');
    expect(html).toContain('src="/__synthetic-original.wav"');
    expect(html).toContain('hidden=""');
    expect(html).toContain('preload="metadata"');
    expect(html).not.toMatch(/\s(?:controls|autoplay)=/i);
    expect(html).not.toContain('type="range"');
  });
  test("the actual fieldset and media nodes receive the original refs, key and all decoder events", () => {
    for (const kind of ["audio", "video"] as const) {
      const c = controller({ kind, enabled: false });
      const view = MediaPlayerView({ controller: c });
      const media = nodes(view).find((node) => node.type === kind);
      expect(view.type).toBe("fieldset");
      expect(view.props.ref).toBe(c.root);
      expect(view.props.disabled).toBe(true);
      expect(media?.key).toBe(c.src);
      expect(media?.props.ref).toBe(c.bind);
      expect(media?.props.hidden).toBe(kind === "audio");
      expect(media?.props.playsInline).toBe(true);
      expect(media?.props.preload).toBe("metadata");
      for (const name of [
        "onLoadedMetadata",
        "onLoadStart",
        "onDurationChange",
        "onProgress",
        "onCanPlay",
        "onTimeUpdate",
        "onPlay",
        "onPause",
        "onEnded",
        "onVolumeChange",
        "onRateChange",
      ])
        expect(media?.props[name]).toBe(c.sync);
      expect(media?.props.onError).toBe(c.onMediaError);
    }
  });
  test("disabled access prevents play, seek, volume and rate mutations at the controller boundary", async () => {
    const c = controller({ enabled: false });
    let plays = 0;
    const media = decoder({
      play: async () => {
        plays++;
      },
    });
    c.media.current = media;
    await c.toggle();
    c.seek(10);
    c.volume(0);
    c.changeRate("1.5");
    c.toggleMute();
    expect(plays).toBe(0);
    expect(media.currentTime).toBe(0);
    expect(media.volume).toBe(1);
    expect(media.playbackRate).toBe(1);
    expect(media.muted).toBe(false);
  });
  test("seek retains EOF safety, small-original bounds and unknown-duration rejection", () => {
    const c = controller();
    const media = decoder();
    c.media.current = media;
    c.seek(-1);
    expect(media.currentTime).toBe(0);
    c.seek(100);
    expect(media.currentTime).toBeCloseTo(19.999, 6);
    Object.assign(media, { duration: 0.05 });
    c.seek(1);
    expect(media.currentTime).toBeCloseTo(0.0495, 6);
    Object.assign(media, { duration: Number.POSITIVE_INFINITY });
    c.seek(0);
    expect(media.currentTime).toBeCloseTo(0.0495, 6);
    Object.assign(media, { duration: 20 });
    Object.assign(media, { readyState: 0 });
    c.seek(10);
    expect(media.currentTime).toBeCloseTo(0.0495, 6);
  });
  test("volume, mute and direct-string rate update the same decoder; reload remains an explicit action", () => {
    const c = controller();
    let reloads = 0;
    const media = decoder({
      load: () => {
        reloads++;
      },
    });
    c.media.current = media;
    c.volume(0);
    expect(media.volume).toBe(0);
    expect(media.muted).toBe(true);
    c.volume(5);
    expect(media.volume).toBe(0.05);
    expect(media.muted).toBe(false);
    c.toggleMute();
    expect(media.muted).toBe(true);
    c.changeRate("1.5");
    expect(media.playbackRate).toBe(1.5);
    expect(reloads).toBe(0);
    c.reload();
    expect(reloads).toBe(1);
  });
  test("pause and play remain explicit and never swap the source", async () => {
    const c = controller();
    let plays = 0;
    let pauses = 0;
    const media = decoder({
      src: "/__synthetic-original.wav",
      paused: false,
      play: async () => {
        plays++;
      },
      pause: () => {
        pauses++;
      },
    });
    c.media.current = media;
    await c.toggle();
    expect(pauses).toBe(1);
    expect(plays).toBe(0);
    Object.assign(media, { paused: true });
    await c.toggle();
    expect(plays).toBe(1);
    expect(media.src).toBe("/__synthetic-original.wav");
  });
});

describe("playback controls and recovery", () => {
  test("ready duration exposes the real clock and original seek/volume callbacks with their limits", () => {
    const c = controller();
    const view = tree({
      state: { ...c.state, duration: 20, time: 10, ready: true },
      displayedTime: 10,
      seek: c.seek,
      volume: c.volume,
    });
    const sliders = nodes(view).filter((node) => node.type === Range);
    expect(sliders).toHaveLength(2);
    expect(sliders[0]?.props.onChange).toBe(c.seek);
    expect(sliders[0]?.props.max).toBe(20);
    expect(sliders[0]?.props.valueText).toBe("0:10 / 0:20");
    expect(sliders[0]?.props.disabled).toBe(false);
    expect(sliders[1]?.props.onChange).toBe(c.volume);
    expect(sliders[1]?.props.max).toBe(100);
    expect(sliders[1]?.props.step).toBe(5);
    expect(c.clock(3661)).toBe("1:01:01");
    expect(c.clock(-10)).toBe("0:00");
  });
  test("starting, error and disabled states retain their action gates and accessible labels", () => {
    for (const override of [{ starting: true }, { blocked: true }])
      expect(button(tree(override), "재생").props.disabled).toBe(true);
    const playing = tree({ state: { ...controller().state, playing: true, muted: true } });
    expect(button(playing, "일시정지").props["aria-busy"]).toBeUndefined();
    expect(button(playing, "소리 켜기").props["aria-pressed"]).toBe(true);
    const html = renderToStaticMarkup(tree({ error: "합성 원본 읽기 실패", blocked: true }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("합성 원본 읽기 실패");
    expect(html).toContain("다시 불러오기");
    expect(html).not.toContain("재생 정보를 확인하고 있어요.");
  });
  test("speed receives a real string and fullscreen uses the existing explicit native operation", () => {
    const values: string[] = [];
    let fullscreens = 0;
    const view = tree({
      changeRate: (value) => values.push(value),
      canFullscreen: true,
      toggleFullscreen: async () => {
        fullscreens++;
      },
    });
    const select = nodes(view).find((node) => node.type === SelectField);
    if (!select) throw new Error("MISSING_PLAYBACK_RATE_SELECT");
    expect(select?.props.label).toBe("재생 속도");
    expect(select?.props.options).toEqual([
      { value: "0.75", label: "0.75배" },
      { value: "1", label: "1배" },
      { value: "1.25", label: "1.25배" },
      { value: "1.5", label: "1.5배" },
      { value: "2", label: "2배" },
    ]);
    (select.props.onValueChange as (value: string) => void)("1.5");
    expect(values).toEqual(["1.5"]);
    expect(fullscreens).toBe(0);
    (button(view, "전체 화면").props.onClick as () => void)();
    expect(fullscreens).toBe(1);
    expect(button(tree({ canFullscreen: true, fullscreen: true }), "전체 화면 닫기")).toBeDefined();
  });
  test("ranges remain named Headless buttons with finite clamped values and disabled semantics", () => {
    const upper = range({ value: 100, max: 20, disabled: true, valueText: "0:20 / 0:20" });
    expect(upper.type).toBe(HeadlessButton);
    expect(upper.props.type).toBe("button");
    expect(upper.props.role).toBe("slider");
    expect(upper.props["aria-label"]).toBe("합성 재생 위치");
    expect(upper.props["aria-valuemin"]).toBe(0);
    expect(upper.props["aria-valuemax"]).toBe(20);
    expect(upper.props["aria-valuenow"]).toBe(20);
    expect(upper.props["aria-valuetext"]).toBe("0:20 / 0:20");
    expect(upper.props.disabled).toBe(true);
    expect(range({ value: -1 }).props["aria-valuenow"]).toBe(0);
    for (const max of [0, Number.NaN, Number.POSITIVE_INFINITY])
      expect(range({ max }).props["aria-valuemax"]).toBe(1);
    for (const name of ["onKeyDown", "onPointerDown", "onPointerMove", "onPointerUp"])
      expect(typeof upper.props[name]).toBe("function");
  });
  test("the stable track/time hooks remain available and pure playback imports no legacy controls or API", async () => {
    const html = renderToStaticMarkup(tree());
    expect(html).toContain("ui-media__time");
    expect(renderToStaticMarkup(range())).toContain("ui-range__track");
    for (const name of ["MediaPlayerView.tsx", "Range.tsx", "useMediaPlayerController.ts"]) {
      const source = await Bun.file(`${import.meta.dir}/../src/product-ui/playback/${name}`).text();
      expect(source).not.toMatch(
        /from ["'][^"']*(?:client\/api|server\/|ui\/(?:button|form|range))["']/,
      );
    }
  });
});
