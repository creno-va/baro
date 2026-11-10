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
import { Button } from "../ui/button";
import { Select, Textarea } from "../ui/form";
import { ReadingContent } from "../ui/reading-content";
import { Section } from "../ui/section";
import { reportOrientation } from "./orientation";
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
      <Textarea
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
        <Select
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
        </Select>
        <Button
          variant="outline"
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
        </Button>
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
  onAsk,
  showOrientation = true,
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
  onAsk?: ((context: { sectionTitle: string; excerpt: string }) => void) | undefined;
  showOrientation?: boolean;
}) {
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
        <Section
          title="먼저 확인할 내용"
          description="현재 리포트 본문에서 발췌했어요. 각 항목의 조건과 근거는 본문에서 이어서 확인하세요."
        >
          {orientation.map((item) => (
            <div key={item.label}>
              <h3>{item.label}</h3>
              {item.text ? (
                <>
                  <p>본문 발췌{item.truncated ? " · 일부만 표시했어요" : ""}</p>
                  <div
                    className="report-markdown"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: Reuses the escaped report-body renderer without photos or source-navigation capability.
                    dangerouslySetInnerHTML={{ __html: reportMarkdownHtml(item.text) }}
                  />
                </>
              ) : (
                <p>이 항목은 본문에 정리되어 있지 않아요. 필요한 내용을 대화에서 확인해 주세요.</p>
              )}
              {item.index >= 0 && (
                <a href={`#${outlineId}-section-${item.index}`}>{item.label} 본문 보기</a>
              )}
            </div>
          ))}
        </Section>
      )}
      <div
        className={`report-document${outlineOpen ? "" : " report-document--outline-closed"}${sections.length < 2 ? " report-document--short" : ""}`}
      >
        {sections.length > 1 && (
          <aside className="report-outline" aria-label="문서 탐색">
            <Button
              variant="outline"
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
            </Button>
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
        <ReadingContent className="report-reading">
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
        </ReadingContent>
      </div>
    </>
  );
}
