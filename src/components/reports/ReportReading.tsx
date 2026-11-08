/** biome-ignore-all lint/suspicious/noArrayIndexKey: Stable document sections can repeat titles. */
import { ImagePlus, List, PanelLeftClose } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
  isReportSourceSection,
  type ReportPhoto,
  reportMarkdownHtml,
  reportPhotoIds,
  reportPhotoToken,
} from "../../utils/report-markdown";
import {
  type ReviewSection,
  replaceReportReviewSection,
  reportReviewSections,
  reportSectionTitle,
} from "./review-sections";

type PhotoChoice = { id: string; name: string; revision?: number; byteLength?: number };
function SectionEditor({
  content,
  section,
  disabled,
  photos,
  onChange,
}: {
  content: string;
  section: ReviewSection;
  disabled: boolean;
  photos: readonly PhotoChoice[];
  onChange?: ((content: string) => void) | undefined;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const choice = useRef<HTMLSelectElement>(null);
  const insert = (addition: string) => {
    const field = input.current;
    if (!field || disabled) return;
    const start = field.selectionStart,
      end = field.selectionEnd;
    const next = section.text.slice(0, start) + addition + section.text.slice(end);
    onChange?.(replaceReportReviewSection(content, section, next));
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + addition.length, start + addition.length);
    });
  };
  const used = reportPhotoIds(content);
  const usedBytes = photos.reduce(
    (sum, photo) => sum + (used.includes(photo.id) ? (photo.byteLength ?? 0) : 0),
    0,
  );
  const unavailable = (photo: PhotoChoice) =>
    used.includes(photo.id) || used.length >= 12 || usedBytes + (photo.byteLength ?? 0) > 8_000_000;
  return (
    <div className="report-section-editor">
      <textarea
        ref={input}
        aria-label={`${reportSectionTitle(section.title)} 수정`}
        value={section.text}
        rows={Math.max(4, Math.min(18, section.text.split(/\r?\n/u).length + 2))}
        disabled={disabled}
        maxLength={Math.max(0, 30000 - content.length + section.text.length)}
        onChange={(event) =>
          onChange?.(replaceReportReviewSection(content, section, event.target.value))
        }
      />
      <div className="report-photo-insert">
        <select
          ref={choice}
          defaultValue=""
          aria-label={`${reportSectionTitle(section.title)}에 넣을 사진`}
          disabled={disabled || !photos.length}
        >
          <option value="">사건 사진 선택</option>
          {photos.map((photo) => (
            <option key={photo.id} value={photo.id} disabled={unavailable(photo)}>
              {photo.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || !photos.length}
          onClick={() => {
            const photo = photos.find((photo) => photo.id === choice.current?.value);
            if (photo && !unavailable(photo)) {
              insert(`\n\n${reportPhotoToken(photo.id, photo.name)}\n\n`);
              if (choice.current) choice.current.value = "";
            }
          }}
        >
          <ImagePlus size={17} aria-hidden="true" />
          사진 넣기
        </button>
      </div>
    </div>
  );
}
export function ReportReading({
  content,
  editing = false,
  disabled = false,
  onChange,
  photoCandidates = [],
  savedPhotoIds = [],
  reportId,
  photoUrls,
}: {
  content: string;
  editing?: boolean;
  disabled?: boolean;
  onChange?: (content: string) => void;
  photoCandidates?: readonly PhotoChoice[];
  savedPhotoIds?: readonly string[];
  reportId?: string;
  /** Mock originals use the same bounded data-image vocabulary as saved HTML. */
  photoUrls?: Readonly<Record<string, string>> | undefined;
}) {
  const outlineId = useId().replaceAll(":", "");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const sections = reportReviewSections(content);
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
    <div
      className={`report-document${outlineOpen ? "" : " report-document--outline-closed"}${sections.length < 2 ? " report-document--short" : ""}`}
    >
      {sections.length > 1 && (
        <aside className="report-outline" aria-label="문서 탐색">
          <button
            type="button"
            className="report-outline-toggle"
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
          </button>
          <nav id={`${outlineId}-outline`} aria-label="리포트 목차" hidden={!outlineOpen}>
            <ol>
              {sections.map((section, index) => (
                <li key={`${index}:${section.title}`}>
                  <a
                    href={`#${outlineId}-section-${index}`}
                    onClick={() => {
                      if (window.matchMedia("(max-width: 1199px)").matches) setOutlineOpen(false);
                    }}
                  >
                    <span aria-hidden="true">{index + 1}</span>
                    {reportSectionTitle(section.title)}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
      )}
      <div className="report-reading">
        {sections.map((section, index) => (
          <section
            key={`${index}:${section.title}`}
            id={`${outlineId}-section-${index}`}
            tabIndex={-1}
            className="report-reading-section"
            data-report-source={isReportSourceSection(section.title) || undefined}
          >
            <header>
              <span aria-hidden="true">{index + 1}</span>
              <h3>{reportSectionTitle(section.title)}</h3>
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
                className="report-markdown"
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
  );
}
