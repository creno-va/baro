import { useCallback, useEffect, useRef, useState } from "react";

export type MediaPlayerProps = {
  src: string;
  label: string;
  kind: "audio" | "video";
  enabled?: boolean;
};

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  return (
    (minutes >= 60
      ? String(Math.floor(minutes / 60)) + ":" + String(minutes % 60).padStart(2, "0")
      : String(minutes)) +
    ":" +
    String(seconds % 60).padStart(2, "0")
  );
}
const initial = {
  ready: false,
  playing: false,
  duration: 0,
  time: 0,
  volume: 100,
  muted: false,
  rate: 1,
};

export function useMediaPlayerController({ src, label, kind, enabled = true }: MediaPlayerProps) {
  const media = useRef<HTMLMediaElement | null>(null);
  const root = useRef<HTMLFieldSetElement>(null);
  const attempt = useRef(0);
  const [state, setState] = useState(initial);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const bind = useCallback((node: HTMLMediaElement | null) => {
    media.current = node;
  }, []);
  const sync = useCallback(() => {
    const node = media.current;
    if (!node) return;
    if (node.error)
      setError("원본을 재생하지 못했어요. 다시 불러오거나 원본을 다운로드해 확인해 주세요.");
    setState({
      ready: node.readyState > 0,
      playing: !node.paused && !node.ended,
      duration: Number.isFinite(node.duration) ? node.duration : 0,
      time: Number.isFinite(node.currentTime) ? node.currentTime : 0,
      volume: node.volume * 100,
      muted: node.muted,
      rate: node.playbackRate,
    });
  }, []);
  useEffect(() => {
    const node = media.current;
    if (!node || !src || node.tagName.toLowerCase() !== kind) return;
    ++attempt.current;
    setState(initial);
    setStarting(false);
    setError("");
    setNotice("");
    sync();
    return () => {
      ++attempt.current;
      node.pause();
      node.removeAttribute("src");
      node.load();
    };
  }, [src, kind, sync]);
  useEffect(() => {
    if (enabled) return;
    ++attempt.current;
    media.current?.pause();
    setStarting(false);
    sync();
  }, [enabled, sync]);
  useEffect(() => {
    setCanFullscreen(kind === "video" && document.fullscreenEnabled);
    const update = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, [kind]);
  async function toggle() {
    const node = media.current;
    if (!node || starting || !enabled) return;
    if (!node.paused) {
      node.pause();
      sync();
      return;
    }
    const current = ++attempt.current;
    setStarting(true);
    setError("");
    try {
      await node.play();
    } catch {
      if (current === attempt.current)
        setError("원본을 재생하지 못했어요. 다시 불러오거나 원본을 다운로드해 확인해 주세요.");
    } finally {
      if (current === attempt.current) {
        setStarting(false);
        sync();
      }
    }
  }
  function seek(value: number) {
    const node = media.current;
    if (!node || !enabled || node.readyState === 0 || !Number.isFinite(node.duration)) return;
    // The last playable instant avoids paused EOF seeks remaining pending in
    // WebKit/GStreamer. Keep even sub-second originals within their own duration.
    const end = Math.max(0, node.duration - Math.min(0.001, node.duration / 100));
    node.currentTime = Math.max(0, Math.min(end, value));
    sync();
  }
  function volume(value: number) {
    if (!media.current || !enabled) return;
    media.current.volume = value / 100;
    media.current.muted = value === 0;
    sync();
  }
  async function toggleFullscreen() {
    if (!enabled) return;
    try {
      if (document.fullscreenElement === root.current) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setNotice("전체 화면을 열지 못했어요. 현재 화면에서 계속 재생할 수 있어요.");
    }
  }
  const Media = kind;
  const blocked = !enabled || Boolean(error);
  const displayedTime =
    state.duration > 0 && state.duration - state.time <= 0.0011 ? state.duration : state.time;
  function toggleMute() {
    if (enabled && media.current) media.current.muted = !media.current.muted;
    sync();
  }
  function changeRate(value: string) {
    if (enabled && media.current) media.current.playbackRate = Number(value);
    sync();
  }
  function reload() {
    setError("");
    media.current?.load();
  }
  function onMediaError() {
    setError("원본을 재생하지 못했어요. 다시 불러오거나 원본을 다운로드해 확인해 주세요.");
  }
  return {
    src,
    label,
    kind,
    enabled,
    media,
    root,
    state,
    starting,
    error,
    notice,
    fullscreen,
    canFullscreen,
    bind,
    sync,
    toggle,
    seek,
    volume,
    toggleFullscreen,
    Media,
    blocked,
    displayedTime,
    toggleMute,
    changeRate,
    reload,
    onMediaError,
    clock,
  };
}
export type MediaPlayerController = ReturnType<typeof useMediaPlayerController>;
