/** biome-ignore-all lint/suspicious/noArrayIndexKey: Stable document sections can repeat titles. */
import { Bold, ImagePlus, List } from "lucide-react";
import { useRef } from "react";
import {
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
  const insert = (value: string, wrap = false) => {
    const field = input.current;
    if (!field || disabled) return;
    const start = field.selectionStart,
      end = field.selectionEnd;
    const selected = section.text.slice(start, end);
    const addition = wrap ? `**${selected || "강조할 내용"}**` : value;
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
      <fieldset
        className="report-format-toolbar"
        aria-label={`${reportSectionTitle(section.title)} 편집 도구`}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label="굵게"
          onClick={() => insert("", true)}
        >
          <Bold size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="불릿 목록"
          onClick={() => insert("\n- ")}
        >
          <List size={17} aria-hidden="true" />
        </button>
        <span className="report-photo-insert">
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
        </span>
      </fieldset>
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
}: {
  content: string;
  editing?: boolean;
  disabled?: boolean;
  onChange?: (content: string) => void;
  photoCandidates?: readonly PhotoChoice[];
  savedPhotoIds?: readonly string[];
  reportId?: string;
}) {
  const photos: ReportPhoto[] = reportId
    ? [...new Set([...photoCandidates.map((photo) => photo.id), ...savedPhotoIds])].map((id) => ({
        id,
        name: photoCandidates.find((photo) => photo.id === id)?.name ?? "사건 사진",
        url: `/api/v2/reports/${encodeURIComponent(reportId)}/photos/${encodeURIComponent(id)}`,
      }))
    : [];
  return (
    <div className="report-reading">
      {reportReviewSections(content).map((section, index) => (
        <section key={`${index}:${section.title}`} className="report-reading-section">
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
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Local renderer escapes text and permits only owned-photo URLs; covered by XSS tests.
              dangerouslySetInnerHTML={{ __html: reportMarkdownHtml(section.text, photos) }}
            />
          )}
        </section>
      ))}
    </div>
  );
}
