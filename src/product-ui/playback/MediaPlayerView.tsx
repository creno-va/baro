import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "../Button";
import { SelectField } from "../Select";
import { Range } from "./Range";
import type { MediaPlayerController } from "./useMediaPlayerController";

export function MediaPlayerView({ controller }: { controller: MediaPlayerController }) {
  const {
    src,
    label,
    kind,
    enabled,
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
  } = controller;
  return (
    <fieldset
      ref={root}
      data-product-playback=""
      data-kind={kind}
      className="m-0 w-full min-w-0 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-3 text-[var(--pui-text)] [&:fullscreen]:flex [&:fullscreen]:max-w-none [&:fullscreen]:flex-col [&:fullscreen]:justify-center [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:bg-[var(--pui-background)] [&:fullscreen_video]:max-h-[calc(100dvh-160px)]"
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
        className="mb-2 block max-h-[50dvh] w-full rounded-lg bg-[var(--pui-background)] [&[hidden]]:hidden"
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
        onError={onMediaError}
      />
      {state.duration > 0 ? (
        <Range
          label="재생 위치"
          value={state.time}
          max={state.duration}
          valueText={clock(displayedTime) + " / " + clock(state.duration)}
          onChange={seek}
          disabled={blocked || !state.ready}
        />
      ) : !error ? (
        <p
          data-product-playback-status=""
          className="text-sm leading-6 text-[var(--pui-muted)]"
          role="status"
        >
          재생 정보를 확인하고 있어요.
        </p>
      ) : null}
      <div data-product-playback-controls="" className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          size="icon"
          disabled={starting || blocked}
          aria-label={state.playing ? "일시정지" : "재생"}
          aria-busy={starting || undefined}
          onClick={() => void toggle()}
        >
          {state.playing ? <Pause size={18} /> : <Play size={18} />}
        </Button>
        <output
          data-product-playback-time=""
          className="ui-media__time whitespace-nowrap text-xs tabular-nums"
          aria-label="재생 시간"
          aria-live="off"
        >
          {clock(displayedTime)} / {state.duration > 0 ? clock(state.duration) : "길이 미확인"}
        </output>
        <div data-product-playback-volume="" className="flex w-[142px] min-w-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            aria-label={state.muted ? "소리 켜기" : "소리 끄기"}
            aria-pressed={state.muted}
            disabled={blocked}
            onClick={toggleMute}
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
        <div data-product-playback-speed="" className="w-28 min-w-0">
          <SelectField
            label="재생 속도"
            wrapperClassName="[&>label]:sr-only"
            value={String(state.rate)}
            disabled={blocked}
            onValueChange={changeRate}
            options={[
              { value: "0.75", label: "0.75배" },
              { value: "1", label: "1배" },
              { value: "1.25", label: "1.25배" },
              { value: "1.5", label: "1.5배" },
              { value: "2", label: "2배" },
            ]}
          />
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
        <div
          role="alert"
          data-product-playback-error=""
          className="mt-3 space-y-2 text-sm leading-6 text-[var(--pui-danger)]"
        >
          <p>{error}</p>
          <Button variant="secondary" onClick={reload}>
            다시 불러오기
          </Button>
        </div>
      )}
      {notice && (
        <p
          role="status"
          data-product-playback-status=""
          className="mt-3 text-sm leading-6 text-[var(--pui-muted)]"
        >
          {notice}
        </p>
      )}
    </fieldset>
  );
}
