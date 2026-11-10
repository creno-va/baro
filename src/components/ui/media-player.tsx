import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./button";
import { Select } from "./form";
import { Range } from "./range";

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

/** Native decoding only. Every visible playback control consumes the shared DS. */
export function MediaPlayer({
  src,
  label,
  kind,
  enabled = true,
}: {
  src: string;
  label: string;
  kind: "audio" | "video";
  enabled?: boolean;
}) {
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
    node.currentTime = Math.max(0, Math.min(node.duration, value));
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
  return (
    <fieldset
      ref={root}
      className={"ui-media ui-media--" + kind}
      disabled={!enabled}
      aria-label={label + " 재생기"}
    >
      {/* Original private video has its editable transcript alongside the player. */}
      <Media
        key={src}
        ref={bind}
        src={src}
        aria-label={label}
        hidden={kind === "audio"}
        playsInline
        preload="metadata"
        onLoadedMetadata={sync}
        onLoadStart={sync}
        onDurationChange={sync}
        onProgress={sync}
        onCanPlay={sync}
        onTimeUpdate={sync}
        onPlay={sync}
        onPause={sync}
        onEnded={sync}
        onVolumeChange={sync}
        onRateChange={sync}
        onError={() =>
          setError("원본을 재생하지 못했어요. 다시 불러오거나 원본을 다운로드해 확인해 주세요.")
        }
      />
      {state.duration > 0 ? (
        <Range
          label="재생 위치"
          value={state.time}
          max={state.duration}
          valueText={clock(state.time) + " / " + clock(state.duration)}
          onChange={seek}
          disabled={blocked || !state.ready}
        />
      ) : !error ? (
        <p className="ui-media__status" role="status">
          재생 정보를 확인하고 있어요.
        </p>
      ) : null}
      <div className="ui-media__controls">
        <Button
          size="icon"
          disabled={starting || blocked}
          aria-label={state.playing ? "일시정지" : "재생"}
          aria-busy={starting || undefined}
          onClick={() => void toggle()}
        >
          {state.playing ? <Pause size={18} /> : <Play size={18} />}
        </Button>
        <output className="ui-media__time" aria-label="재생 시간" aria-live="off">
          {clock(state.time)} / {state.duration > 0 ? clock(state.duration) : "길이 미확인"}
        </output>
        <div className="ui-media__volume">
          <Button
            variant="ghost"
            size="icon"
            aria-label={state.muted ? "소리 켜기" : "소리 끄기"}
            aria-pressed={state.muted}
            disabled={blocked}
            onClick={() => {
              if (enabled && media.current) media.current.muted = !media.current.muted;
              sync();
            }}
          >
            {state.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </Button>
          <Range
            label="음량"
            value={state.muted ? 0 : state.volume}
            max={100}
            step={5}
            valueText={String(Math.round(state.muted ? 0 : state.volume)) + "%"}
            onChange={volume}
            disabled={blocked}
          />
        </div>
        <div className="ui-media__speed">
          <Select
            aria-label="재생 속도"
            value={String(state.rate)}
            disabled={blocked}
            onChange={(event) => {
              if (enabled && media.current) media.current.playbackRate = Number(event.target.value);
              sync();
            }}
          >
            <option value="0.75">0.75배</option>
            <option value="1">1배</option>
            <option value="1.25">1.25배</option>
            <option value="1.5">1.5배</option>
            <option value="2">2배</option>
          </Select>
        </div>
        {canFullscreen && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={fullscreen ? "전체 화면 닫기" : "전체 화면"}
            disabled={blocked}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </Button>
        )}
      </div>
      {error && (
        <div role="alert" className="ui-media__error">
          <p>{error}</p>
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              media.current?.load();
            }}
          >
            다시 불러오기
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="ui-media__status">
          {notice}
        </p>
      )}
    </fieldset>
  );
}
