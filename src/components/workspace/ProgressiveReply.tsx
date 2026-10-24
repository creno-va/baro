import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";

/** Presentation of an already validated, durably published answer. No provider
 * drafts, thought tokens or partially parsed model JSON reach this component. */
export function ProgressiveReply({
  text,
  animate,
  onProgress,
  onComplete,
}: {
  text: string;
  animate: boolean;
  onProgress: () => void;
  onComplete: () => void;
}) {
  const graphemes = useMemo(
    () =>
      Array.from(
        new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text),
        (s) => s.segment,
      ),
    [text],
  );
  const [shown, setShown] = useState(animate ? Math.min(1, graphemes.length) : graphemes.length);
  const skip = useRef(false);
  const callbacks = useRef({ onProgress, onComplete });
  callbacks.current = { onProgress, onComplete };
  const wasAnimating = useRef(false);
  useLayoutEffect(() => {
    if (shown > 0 && (animate || wasAnimating.current)) callbacks.current.onProgress();
    wasAnimating.current = animate;
  }, [shown, animate]);
  useEffect(() => {
    skip.current = false;
    if (!animate) {
      setShown(graphemes.length);
      return;
    }
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let cancelled = false;
    const started = performance.now();
    // Reading remains optional and bounded even for a long answer.
    const duration = Math.min(3200, Math.max(250, graphemes.length * 9));
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(frame);
      setShown(graphemes.length);
      callbacks.current.onComplete();
    };
    const tick = (now: number) => {
      if (cancelled) return;
      if (skip.current || motion.matches || document.hidden || now - started >= duration) {
        finish();
        return;
      }
      setShown(Math.max(1, Math.ceil((graphemes.length * (now - started)) / duration)));
      frame = requestAnimationFrame(tick);
    };
    const changed = () => {
      if (motion.matches || document.hidden) finish();
    };
    motion.addEventListener("change", changed);
    document.addEventListener("visibilitychange", changed);
    if (motion.matches || !graphemes.length) finish();
    else frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      motion.removeEventListener("change", changed);
      document.removeEventListener("visibilitychange", changed);
    };
  }, [animate, graphemes]);
  const typing = animate && shown < graphemes.length;
  return (
    <>
      <p aria-busy={typing} data-reply-revealing={typing || undefined}>
        {graphemes.slice(0, shown).join("")}
      </p>
      {typing && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            skip.current = true;
          }}
        >
          답변 전체 바로 보기
        </Button>
      )}
    </>
  );
}
