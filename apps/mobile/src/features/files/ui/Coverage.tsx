import type { V2Coverage, V2SourcePosition } from "@baro/contracts/v2";
import { useState } from "react";
import { Button } from "../../../ui/Button";
import { Text } from "../../../ui/Text";

const labels: Record<string, string> = {
  processed: "확인 가능",
  low_quality: "품질 저하",
  missing: "누락",
  failed: "실패",
  silent: "무음",
};
export function sourcePosition(position: V2SourcePosition) {
  if (position.kind === "document")
    return `${position.page}쪽${position.paragraph ? ` · ${position.paragraph}문단` : ""}${position.table ? ` · 표${position.table.index} ${position.table.row}행 ${position.table.column}열` : ""}`;
  if (position.kind === "audio") return `${position.startSeconds}~${position.endSeconds}초`;
  if (position.kind === "video")
    return `${position.timestampSeconds}초 · ${position.sampling === "scene_change" ? "장면 변화 표본" : "1초 간격 표본"}`;
  return position.region
    ? `이미지 영역 · 왼쪽 ${Math.round(position.region.x * 100)}%, 위 ${Math.round(position.region.y * 100)}% · 너비 ${Math.round(position.region.width * 100)}%, 높이 ${Math.round(position.region.height * 100)}%`
    : "이미지 전체";
}
function Rows<T>({
  values,
  label,
  identify,
  format,
}: {
  values: T[];
  label: string;
  identify: (value: T) => string;
  format: (value: T) => string;
}) {
  const [page, setPage] = useState(0),
    start = Math.min(page * 100, Math.max(0, Math.floor((values.length - 1) / 100) * 100));
  return (
    <>
      <Text>
        {label} · {values.length}개 중 {start + 1}~{Math.min(start + 100, values.length)}개
      </Text>
      {values.slice(start, start + 100).map((value) => (
        <Text key={identify(value)}>{format(value)}</Text>
      ))}
      {start > 0 ? (
        <Button label={`${label} 앞 100개`} onPress={() => setPage(Math.max(0, page - 1))} />
      ) : null}
      {start + 100 < values.length ? (
        <Button label={`${label} 다음 100개`} onPress={() => setPage(page + 1)} />
      ) : null}
    </>
  );
}
export function Coverage({ value }: { value: V2Coverage | null }) {
  if (!value) return <Text>아직 처리 범위를 확인할 수 없어요.</Text>;
  if (value.category === "document")
    return (
      <>
        <Text>
          문서 {value.pageCount}쪽 ·{" "}
          {value.status === "complete" ? "전체 페이지 확인 가능" : "일부 누락·품질 저하·실패 있음"}
        </Text>
        <Rows
          label="페이지 처리 범위"
          values={value.pages}
          identify={(page) => String(page.page)}
          format={(page) => `${page.page}쪽 · ${labels[page.status]}`}
        />
      </>
    );
  if (value.category === "image")
    return <Text>이미지 관찰 · {labels[value.observation]} · 원본과 함께 확인해 주세요.</Text>;
  const audio = value.audio;
  return (
    <>
      {value.category === "video" ? (
        <>
          <Text>
            영상 {value.durationSeconds}초 ·{" "}
            {value.status === "complete"
              ? "선택한 표본 확인 가능"
              : "일부 누락·품질 저하·실패 있음"}{" "}
            · 장면 검출 {value.sceneDetection === "complete" ? "완료" : "실패"}
          </Text>
          <Text>표본 추출로 확인하므로 전체 장면의 관찰을 보장하지 않아요.</Text>
          <Rows
            label="영상 표본"
            values={value.frames}
            identify={(frame) => frame.id}
            format={(frame) =>
              `${frame.timestampSeconds}초 · ${frame.sampling === "scene_change" ? "장면 변화" : "1초 간격"} · ${labels[frame.status]}`
            }
          />
        </>
      ) : null}
      {audio ? (
        <>
          <Text>
            음성 {audio.durationSeconds}초 ·{" "}
            {audio.status === "complete" ? "전체 구간 처리" : "일부 누락·품질 저하·실패 있음"}
          </Text>
          <Rows
            label="음성 처리 구간"
            values={audio.intervals}
            identify={(interval) => `${interval.startSeconds}:${interval.endSeconds}`}
            format={(interval) =>
              `${interval.startSeconds}~${interval.endSeconds}초 · ${labels[interval.status]}`
            }
          />
        </>
      ) : (
        <Text>음성 트랙이 없는 영상이에요.</Text>
      )}
    </>
  );
}
