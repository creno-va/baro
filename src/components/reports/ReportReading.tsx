/** biome-ignore-all lint/suspicious/noArrayIndexKey: This read-only document has no row state, and repeated verbatim lines need distinct keys. */
import { reportSections } from "../../utils/report-sections";
export function ReportReading({ content }: { content: string }) {
  return (
    <div className="report-reading">
      {reportSections(content).map((section, index) => (
        <section
          key={`${index}:${section.title}`}
          className={`report-reading-section${section.title.includes("미확인") ? " report-reading-section--uncertain" : ""}`}
        >
          <header>
            <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <h3>{section.title}</h3>
          </header>
          <div>
            {section.lines
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
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
