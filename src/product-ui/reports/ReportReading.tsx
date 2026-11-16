/** biome-ignore-all lint/suspicious/noArrayIndexKey: Stable document sections can repeat titles. */
import { List, PanelLeftClose } from "lucide-react";
import { useId, useState } from "react";
import { reportOrientation } from "../../components/reports/orientation";
import { reportReviewSections, reportSectionTitle } from "../../components/reports/review-sections";
import {
  isReportSourceSection,
  type ReportPhoto,
  reportMarkdownHtml,
} from "../../utils/report-markdown";
import { Button } from "../Button";
import { cn } from "../utils";
import { type PhotoChoice, SectionEditor } from "./SectionEditor";

// These descendants are emitted by the shared escaped document renderer. Styling
// lives in the view; its trusted HTML vocabulary and source rules stay unchanged.
const bodyClass =
  "report-markdown min-w-0 text-base leading-8 text-[var(--pui-text)] [overflow-wrap:anywhere] [&_p]:mb-3 [&_p]:whitespace-pre-wrap [&_p:last-child]:mb-0 [&_h4]:mb-3 [&_h4]:mt-6 [&_h4]:text-base [&_h4]:font-medium [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li+li]:mt-2 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--pui-border)] [&_blockquote]:pl-4 [&_code]:rounded [&_code]:bg-[var(--pui-background)] [&_code]:px-1 [&_code]:text-sm [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded-xl [&_pre]:bg-[var(--pui-background)] [&_pre]:p-4 [&_.report-source-quote]:whitespace-pre-wrap [&_.report-official-source]:inline-block [&_.report-official-source]:min-h-11 [&_.report-official-source]:max-w-full [&_.report-official-source]:py-2 [&_.report-official-source]:underline [&_.report-official-source]:underline-offset-4 [&_.report-official-source]:focus-visible:outline-2 [&_.report-official-source]:focus-visible:outline-[var(--pui-focus)] [&_.report-inline-photo]:my-6 [&_.report-inline-photo_img]:mx-auto [&_.report-inline-photo_img]:block [&_.report-inline-photo_img]:h-auto [&_.report-inline-photo_img]:max-h-[680px] [&_.report-inline-photo_img]:w-auto [&_.report-inline-photo_img]:max-w-full [&_.report-inline-photo_img]:rounded-lg [&_.report-inline-photo_img]:object-contain [&_figcaption]:mt-2 [&_figcaption]:text-sm [&_figcaption]:text-[var(--pui-muted)] [&_.report-photo-placeholder]:text-sm [&_.report-photo-placeholder]:text-[var(--pui-muted)] [&_.report-table]:my-4 [&_.report-table]:max-w-full [&_.report-table]:overflow-x-auto [&_.report-table]:rounded-xl [&_.report-table]:border [&_.report-table]:border-[var(--pui-border)] [&_table]:w-full [&_table]:min-w-[520px] [&_table]:table-fixed [&_table]:border-collapse [&_table]:text-sm [&_th]:border-b [&_th]:border-[var(--pui-border)] [&_th]:bg-[var(--pui-background)] [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:align-top [&_th]:font-medium [&_td]:border-b [&_td]:border-[var(--pui-border)] [&_td]:px-3 [&_td]:py-2.5 [&_td]:text-left [&_td]:align-top print:[&_.report-table]:overflow-visible print:[&_table]:min-w-0";

export type ReportReadingProps = {
  content: string;
  editing?: boolean;
  disabled?: boolean;
  onChange?: (content: string) => void;
  photoCandidates?: readonly PhotoChoice[];
  savedPhotoIds?: readonly string[];
  reportId?: string;
  /** Mock originals use the same bounded data-image vocabulary as saved HTML. */
  photoUrls?: Readonly<Record<string, string>> | undefined;
  onAsk?: ((context: { sectionTitle: string; excerpt: string }) => void) | undefined;
  showOrientation?: boolean;
};

export function ReportReading({
  content,
  editing = false,
  disabled = false,
  onChange,
  photoCandidates = [],
  savedPhotoIds = [],
  reportId,
  photoUrls,
  onAsk,
  showOrientation = true,
}: ReportReadingProps) {
  const outlineId = useId().replaceAll(":", "");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const sections = reportReviewSections(content);
  const orientation = reportOrientation(sections);
  const photos: ReportPhoto[] = reportId
    ? [...new Set([...photoCandidates.map((photo) => photo.id), ...savedPhotoIds])].map((id) => ({
        id,
        name: photoCandidates.find((photo) => photo.id === id)?.name ?? "사건 사진",
        url: photoUrls
          ? (photoUrls[id] ?? "")
          : `/api/v2/reports/${encodeURIComponent(reportId)}/photos/${encodeURIComponent(id)}`,
      }))
    : [];
  return (
    <>
      {showOrientation && !editing && orientation.some((item) => item.index >= 0) && (
        <section
          data-product-report-orientation=""
          aria-label="먼저 확인할 내용"
          className="mb-8 space-y-5 rounded-2xl border border-[var(--pui-border)] p-5 sm:p-6"
        >
          <header className="space-y-2">
            <h2 className="text-lg font-medium">먼저 확인할 내용</h2>
            <p className="text-sm leading-6 text-[var(--pui-muted)]">
              현재 리포트 본문에서 발췌했어요. 각 항목의 조건과 근거는 본문에서 이어서 확인하세요.
            </p>
          </header>
          <div className="grid gap-6 lg:grid-cols-3">
            {orientation.map((item) => (
              <div key={item.label} className="min-w-0 space-y-3">
                <h3 className="text-sm font-medium">{item.label}</h3>
                {item.text ? (
                  <>
                    <p className="text-xs text-[var(--pui-muted)]">
                      본문 발췌{item.truncated ? " · 일부만 표시했어요" : ""}
                    </p>
                    <div
                      className={cn(bodyClass, "text-sm leading-7")}
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: Reuses the escaped report-body renderer without photos or source-navigation capability.
                      dangerouslySetInnerHTML={{ __html: reportMarkdownHtml(item.text) }}
                    />
                  </>
                ) : (
                  <p className="text-sm leading-7 text-[var(--pui-muted)]">
                    이 항목은 본문에 정리되어 있지 않아요. 필요한 내용을 대화에서 확인해 주세요.
                  </p>
                )}
                {item.index >= 0 && (
                  <a
                    href={`#${outlineId}-section-${item.index}`}
                    className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--pui-focus)]"
                  >
                    {item.label} 본문 보기
                  </a>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="report-document min-w-0" data-product-report-document="">
        {sections.length > 1 && (
          <aside aria-label="문서 탐색" className="mb-4 min-w-0 print:hidden">
            <Button
              variant="ghost"
              type="button"
              className="report-outline-toggle -ml-3 rounded-full px-3"
              aria-expanded={outlineOpen}
              aria-controls={`${outlineId}-outline`}
              aria-label={`문서 목차 ${outlineOpen ? "접기" : "펼치기"}`}
              onClick={() => setOutlineOpen((open) => !open)}
            >
              {outlineOpen ? (
                <PanelLeftClose size={17} aria-hidden="true" />
              ) : (
                <List size={17} aria-hidden="true" />
              )}
              <span>문서 목차</span>
            </Button>
            <nav
              id={`${outlineId}-outline`}
              aria-label="리포트 목차"
              hidden={!outlineOpen}
              className="mt-2 max-h-[min(360px,45dvh)] overflow-auto rounded-2xl border border-[var(--pui-border)] p-3"
            >
              <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {sections.map((section, index) => (
                  <li key={`${index}:${section.title}`} className="min-w-0">
                    <a
                      href={`#${outlineId}-section-${index}`}
                      className="flex min-h-11 items-baseline gap-2 rounded-lg px-3 py-2 text-sm leading-7 text-[var(--pui-muted)] hover:bg-[var(--pui-background)] hover:text-[var(--pui-text)] focus-visible:outline-2 focus-visible:outline-[var(--pui-focus)] [overflow-wrap:anywhere]"
                      onClick={() => {
                        if (window.matchMedia("(max-width: 1199px)").matches) setOutlineOpen(false);
                      }}
                    >
                      <span aria-hidden="true" className="min-w-4 shrink-0 tabular-nums">
                        {index + 1}
                      </span>
                      {reportSectionTitle(section.title)}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        )}
        <div
          data-product-report-reading=""
          className="report-reading mx-auto flex w-full min-w-0 max-w-none flex-col gap-0 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] px-5 py-2 sm:px-8 sm:py-3 print:rounded-none print:border-0 print:p-0"
        >
          {sections.map((section, index) => (
            <section
              key={`${index}:${section.title}`}
              id={`${outlineId}-section-${index}`}
              tabIndex={-1}
              className="report-reading-section m-0 min-w-0 scroll-mt-20 border-0 border-t border-[var(--pui-border)] py-6 first:border-t-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pui-focus)]"
              data-report-source={isReportSourceSection(section.title) || undefined}
            >
              <header className="mb-5 flex flex-wrap items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid h-8 min-w-8 shrink-0 place-items-center rounded-lg bg-[var(--pui-background)] px-2 text-sm tabular-nums text-[var(--pui-muted)]"
                >
                  {index + 1}
                </span>
                <h3 className="min-w-0 flex-1 text-lg font-medium leading-7 [overflow-wrap:anywhere]">
                  {reportSectionTitle(section.title)}
                </h3>
                {onAsk && (
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() =>
                      onAsk({
                        sectionTitle: reportSectionTitle(section.title),
                        excerpt: section.text.slice(0, 600),
                      })
                    }
                  >
                    이 내용 대화로 질문
                  </Button>
                )}
              </header>
              {editing ? (
                <SectionEditor
                  content={content}
                  section={section}
                  disabled={disabled}
                  photos={photoCandidates}
                  onChange={onChange}
                />
              ) : (
                <div
                  className={bodyClass}
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: Escaped renderer permits owned photos and bounded official-source navigation only; covered by XSS tests.
                  dangerouslySetInnerHTML={{
                    __html: reportMarkdownHtml(
                      section.text,
                      photos,
                      isReportSourceSection(section.title),
                    ),
                  }}
                />
              )}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
