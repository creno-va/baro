/** biome-ignore-all lint/suspicious/noArrayIndexKey: Text is controlled by the report; repeated verbatim paragraphs need distinct keys. */
import { replaceReportReviewSection, reportReviewSections } from "./review-sections";
export function ReportReading({
  content,
  editing = false,
  disabled = false,
  onChange,
}: {
  content: string;
  editing?: boolean;
  disabled?: boolean;
  onChange?: (content: string) => void;
}) {
  return (
    <div className="report-reading">
      {reportReviewSections(content).map((section, index) => (
        <section key={`${index}:${section.title}`} className="report-reading-section">
          <header>
            <span aria-hidden="true">{index + 1}</span>
            <h3>{section.title}</h3>
          </header>
          <div>
            {editing ? (
              <textarea
                aria-label={`${section.title} 수정`}
                value={section.text}
                rows={Math.max(3, Math.min(16, section.text.split(/\r?\n/u).length + 1))}
                disabled={disabled}
                maxLength={Math.max(0, 30000 - content.length + section.text.length)}
                onChange={(event) =>
                  onChange?.(replaceReportReviewSection(content, section, event.target.value))
                }
              />
            ) : (
              section.text
                .split(/\r?\n/u)
                .filter((line) => line.trim())
                .map((line, lineIndex) => (
                  <p
                    key={`${lineIndex}:${line}`}
                    className={
                      /^\[|^(출처|주의|작성 시각|검증 시각):/.test(line)
                        ? "report-reading-source"
                        : undefined
                    }
                  >
                    {line}
                  </p>
                ))
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
