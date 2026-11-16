import type { V2Coverage } from "../../contracts/v2";
import { secondsLabel } from "../../utils/time";

const status: Record<string, string> = {
  processed: "처리됨",
  silent: "무음",
  low_quality: "품질 저하",
  missing: "미처리",
  failed: "실패",
};

/** Labels retain the original page/frame/interval coverage, including failures. */
export function coverageRows(value: V2Coverage): string[] {
  const audio = (v: {
    intervals: { startSeconds: number; endSeconds: number; status: string }[];
  }) =>
    v.intervals.map(
      (p) =>
        `${secondsLabel(p.startSeconds)}–${secondsLabel(p.endSeconds)}초 · ${status[p.status] ?? p.status}`,
    );
  if (value.category === "document")
    return value.pages.map((p) => `${p.page}쪽 · ${status[p.status]}`);
  if (value.category === "image") return [`이미지 · ${status[value.observation]}`];
  if (value.category === "audio") return audio(value.audio);
  return [
    ...value.frames.map(
      (p) =>
        `영상 ${secondsLabel(p.timestampSeconds)}초 · 프레임 ${p.frameIndex} · ${status[p.status]}`,
    ),
    ...(value.audio ? audio(value.audio).map((p) => `음성 ${p}`) : []),
    ...(value.sceneDetection === "failed"
      ? ["장면 변화 탐지 실패 · 추가 장면이 누락될 수 있어요."]
      : []),
  ];
}
