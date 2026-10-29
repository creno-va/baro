import { BadgeCheck, CircleHelp, MessageSquare, Paperclip, PencilLine } from "lucide-react";
import type { FileView, TimelineView } from "../../client/api/types";
import type { V2Fact } from "../../contracts/v2";
import { Badge } from "../ui/badge";
import { positionLabel } from "./source-label";
import { timelineEvidence } from "./timeline-evidence";

export function TimelineEvidence({
  entry,
  files,
  facts,
  base,
}: {
  entry: TimelineView;
  files: readonly FileView[];
  facts?: readonly V2Fact[] | undefined;
  base: string;
}) {
  const evidence = timelineEvidence(entry, files, facts);
  const Icon =
    evidence.kind === "observed"
      ? BadgeCheck
      : evidence.kind === "material"
        ? Paperclip
        : evidence.kind === "reported"
          ? MessageSquare
          : evidence.kind === "edited"
            ? PencilLine
            : CircleHelp;
  return (
    <div className="timeline-evidence">
      <div className="timeline-evidence-badges">
        <Badge tone={evidence.tone} title={evidence.description}>
          <Icon size={13} aria-hidden="true" />
          {evidence.label}
        </Badge>
        {evidence.hasMaterials && !["observed", "material"].includes(evidence.kind) && (
          <Badge tone="primary">
            <Paperclip size={13} aria-hidden="true" />
            자료 연결
          </Badge>
        )}
      </div>
      {evidence.materials.length > 0 && (
        <details className="timeline-evidence-sources">
          <summary>
            연결 자료 {new Set(evidence.materials.map((item) => item.reference.fileId)).size}개
          </summary>
          <div className="timeline-evidence-links">
            {evidence.materials.map(({ reference, file, current }) => (
              <div key={JSON.stringify(reference)}>
                {file ? (
                  <a href={`${base}/files?file=${encodeURIComponent(file.id)}`}>
                    {file.name} · {positionLabel(reference.position)}
                  </a>
                ) : (
                  <span>현재 확인할 수 없는 자료 · {positionLabel(reference.position)}</span>
                )}
                {!current && (
                  <small>
                    {file
                      ? "자료가 변경됐거나 처리가 끝나지 않아 다시 확인해야 해요."
                      : "연결된 자료가 삭제됐거나 접근할 수 없어요."}
                  </small>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
