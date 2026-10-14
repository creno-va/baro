import { useEffect, useState } from "react";
import { elapsedLabel } from "./processing-progress";

/** Mount only while pending. Server timestamps keep their meaning across reloads. */
export function ElapsedTime({ startedAt, label }: { startedAt: string | number; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = elapsedLabel(startedAt, now);
  return elapsed ? (
    <span aria-live="off">
      {label} {elapsed}
    </span>
  ) : null;
}
