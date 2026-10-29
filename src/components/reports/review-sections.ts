import { reportSections } from "../../utils/report-sections";

const omitted = new Set(["사실·주장·출처", "공식 출처"]);
export type ReviewSection = { title: string; start: number; end: number; text: string };

/** Exact editable body ranges. Hidden source/provenance blocks stay untouched. */
export function reportReviewSections(content: string): ReviewSection[] {
  const titles = new Set(
    reportSections(content)
      .map((section) => section.title)
      .filter((title) => title !== "검토한 내용"),
  );
  const sections: ReviewSection[] = [];
  let current = { title: "검토한 내용", start: 0 };
  const finish = (end: number) => {
    const body = content.slice(current.start, end);
    const trailing = body.match(/(?:\r?\n)+$/u)?.[0].length ?? 0;
    if (!omitted.has(current.title) && (current.title !== "검토한 내용" || body.trim()))
      sections.push({
        ...current,
        end: end - trailing,
        text: body.slice(0, body.length - trailing),
      });
  };
  for (const line of content.matchAll(/[^\r\n]*(?:\r\n|\n|$)/gu)) {
    if (!line[0]) continue;
    const title = line[0].trim();
    if (!titles.has(title)) continue;
    finish(line.index);
    current = { title, start: line.index + line[0].length };
  }
  finish(content.length);
  return sections;
}

export function replaceReportReviewSection(content: string, section: ReviewSection, text: string) {
  const prefix = section.start > 0 && !/[\r\n]$/u.test(content.slice(0, section.start)) ? "\n" : "";
  // An initially empty section may have no separator before the following heading.
  const separator =
    section.end < content.length &&
    !/^[\r\n]/u.test(content.slice(section.end)) &&
    !/[\r\n]$/u.test(text)
      ? "\n"
      : "";
  const next =
    content.slice(0, section.start) + prefix + text + separator + content.slice(section.end);
  return next.length <= 30000 ? next : content;
}
