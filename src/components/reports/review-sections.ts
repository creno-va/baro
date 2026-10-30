import { reportPhotoIds, reportPhotoToken } from "../../utils/report-markdown";
import { reportSections } from "../../utils/report-sections";

const omitted = new Set([
  "사실·주장·출처",
  "공식 출처",
  "자료 처리 범위",
  "준비할 자료와 처리 범위",
  "준비할 행동",
  "연락과 전달",
  "안내",
]);
export const reportSectionTitle = (title: string) =>
  ({
    "사건 요약": "사건 개요",
    "사건의 사실과 주장": "사건 개요",
    당사자: "당사자와 관계",
    타임라인: "주요 경위",
    "미확인 사항": "추가 확인 사항",
    "미확인·상반되는 내용": "추가 확인 사항",
  })[title] ?? title;
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
  let fenced = false;
  for (const line of content.matchAll(/[^\r\n]*(?:\r\n|\n|$)/gu)) {
    if (!line[0]) continue;
    if (/^\s*```/u.test(line[0])) fenced = !fenced;
    if (fenced || /^[ \t]/u.test(line[0])) continue;
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

/** Older explicit photo selections gain positions inside the document without
 * changing saved snapshots. Editing can move/delete their Markdown tokens. */
export function withInlineReportPhotos(
  content: string,
  photos: readonly { id: string; name: string }[],
) {
  const present = new Set(reportPhotoIds(content));
  const missing = photos.filter((photo) => !present.has(photo.id));
  const sections = reportReviewSections(content);
  const target =
    sections.find((section) => section.title === "증거 자료") ??
    sections.find((section) => section.title.includes("자료")) ??
    sections[0];
  if (!missing.length || !target) return content;
  return replaceReportReviewSection(
    content,
    target,
    `${target.text.trimEnd()}\n\n${missing.map((photo) => reportPhotoToken(photo.id, photo.name)).join("\n\n")}`,
  );
}
