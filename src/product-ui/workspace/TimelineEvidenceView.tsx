import { BadgeCheck, CircleHelp, MessageSquare, Paperclip, PencilLine } from "lucide-react";
import type { FileView, TimelineView } from "../../client/api/types";
import { positionLabel } from "../../components/workspace/source-label";
import { timelineEvidence } from "../../components/workspace/timeline-evidence";
import type { V2Fact } from "../../contracts/v2";
import { Button } from "../Button";
import { Disclosure, DisclosureSummary } from "../Disclosure";
import { cn } from "../utils";

export function TimelineEvidenceView({
  entry,
  files,
  facts,
  base,
  onReviewFile,
}: {
  entry: TimelineView;
  files: readonly FileView[];
  facts?: readonly V2Fact[] | undefined;
  base: string;
  onReviewFile?: (fileId: string) => void;
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
    <div data-product-timeline-evidence="" className="min-w-0 space-y-2">
      <div className="flex flex-wrap gap-2">
        <span
          title={evidence.description}
          data-evidence-kind={evidence.kind}
          className={cn(
            "inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-[var(--pui-border)] bg-[var(--pui-background)] px-2 py-1 text-xs leading-5",
            evidence.tone === "danger" ? "text-[var(--pui-danger)]" : "text-[var(--pui-muted)]",
          )}
        >
          <Icon size={13} aria-hidden="true" />
          {evidence.label}
        </span>
        {evidence.hasMaterials && !["observed", "material"].includes(evidence.kind) && (
          <span className="inline-flex min-h-7 items-center gap-1.5 rounded-lg border border-[var(--pui-border)] px-2 py-1 text-xs leading-5 text-[var(--pui-muted)]">
            <Paperclip size={13} aria-hidden="true" />
            자료 연결
          </span>
        )}
      </div>
      {evidence.materials.length > 0 && (
        <Disclosure className="px-3 py-1">
          <DisclosureSummary>
            연결 자료 {new Set(evidence.materials.map((item) => item.reference.fileId)).size}개
          </DisclosureSummary>
          <div className="space-y-2">
            {evidence.materials.map(({ reference, file, current }) => (
              <div
                key={JSON.stringify(reference)}
                className="min-w-0 space-y-1 [overflow-wrap:anywhere]"
              >
                {file && onReviewFile ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto w-full justify-start whitespace-normal text-left"
                    onClick={(event) => {
                      event.currentTarget.focus();
                      onReviewFile(file.id);
                    }}
                  >
                    {file.name} · {positionLabel(reference.position)}
                  </Button>
                ) : file ? (
                  <a
                    className="inline-flex min-h-11 items-center rounded-lg text-xs leading-6 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--pui-focus)]"
                    href={`${base}/files?file=${encodeURIComponent(file.id)}`}
                  >
                    {file.name} · {positionLabel(reference.position)}
                  </a>
                ) : (
                  <span className="text-xs leading-6">
                    현재 확인할 수 없는 자료 · {positionLabel(reference.position)}
                  </span>
                )}
                {!current && (
                  <small className="block text-xs leading-6 text-[var(--pui-muted)]">
                    {file
                      ? "자료가 변경됐거나 처리가 끝나지 않아 다시 확인해야 해요."
                      : "연결된 자료가 삭제됐거나 접근할 수 없어요."}
                  </small>
                )}
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}
