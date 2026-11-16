import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reportReviewSections } from "../src/components/reports/review-sections";
import { Button } from "../src/product-ui/Button";
import { TextareaField } from "../src/product-ui/Field";
import { ReportReading } from "../src/product-ui/reports/ReportReading";
import { SectionEditor, SectionEditorFields } from "../src/product-ui/reports/SectionEditor";
import { SelectField } from "../src/product-ui/Select";
import { reportPhotoToken } from "../src/utils/report-markdown";

const content =
  "사건 요약\r\n합성 사건 개요\r\n\r\n사실·주장·출처\r\n보존해야 하는 내부 출처\r\n\r\n미확인 사항\r\n추가 확인할 약속 날짜\r\n\r\n공식 출처\r\n공식 원문 · https://law.go.kr/LSW/lsInfoP.do?lsiSeq=123456";
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Record<string, unknown>>(child)) return [];
    return [child, ...elements(child.props.children as ReactNode)];
  });
}

describe("product report reading", () => {
  test("parsed headings, repeated titles and outline targets retain distinct stable document identities", () => {
    const html = renderToStaticMarkup(
      <>
        <ReportReading content={`${content}\n\n사건 요약\n다시 확인한 합성 개요`} />
        <ReportReading content={content} />
      </>,
    );
    const sections = [...html.matchAll(/id="([^"]+-section-\d+)"/g)].map((match) => match[1]);
    expect(sections).toHaveLength(7);
    expect(new Set(sections).size).toBe(sections.length);
    for (const id of sections) expect(html).toContain(`href="#${id}"`);
    expect(html).toContain('aria-label="문서 목차 펼치기"');
    expect(html).toMatch(/<nav[^>]*aria-label="리포트 목차"[^>]*hidden=""/);
    expect(html).not.toContain("보존해야 하는 내부 출처");
    expect(html).toContain("추가 확인 사항");
    expect(html).toContain("공식 원문과 출처");
    expect(html).not.toMatch(/\sstyle=/i);
  });

  test("safe body renderer keeps official navigation restricted to source sections and escapes arbitrary HTML", () => {
    const url = "https://law.go.kr/LSW/lsInfoP.do?lsiSeq=123456";
    const text = `사건 요약\n공식 원문 · ${url}\n<img src=x onerror=synthetic()>\n\n공식 출처\n공식 원문 · ${url}`;
    const html = renderToStaticMarkup(<ReportReading content={text} showOrientation={false} />);
    expect(html.match(/class="report-official-source"/g)).toHaveLength(1);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('data-report-source="true"');
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-product-report-orientation");
  });

  test("orientation stays an explicitly bounded excerpt with no promoted image or URL capabilities", () => {
    const text = `사건 요약\n${"가".repeat(401)}\n\n준비할 행동\n원본을 보관한다.\n\n미확인 사항\n공식 원문 · https://law.go.kr/LSW/lsInfoP.do?lsiSeq=123456`;
    const html = renderToStaticMarkup(<ReportReading content={text} />);
    const orientation = html.split('class="report-document')[0] ?? "";
    expect(orientation).toContain("본문 발췌 · 일부만 표시했어요");
    expect(orientation).toContain("가".repeat(400));
    expect(orientation).not.toContain("가".repeat(401));
    expect(orientation).not.toContain('<a class="report-official-source"');
    expect(orientation).not.toContain("<img");
    expect(text).toContain("가".repeat(401));
  });

  test("saved photo placement uses the exact owned report endpoint and never invents external URLs", () => {
    const text = `사건 요약\n${reportPhotoToken("saved-photo", "합성 사진")}`;
    const html = renderToStaticMarkup(
      <ReportReading
        content={text}
        reportId="synthetic-report"
        photoCandidates={[{ id: "saved-photo", name: "합성 사진" }]}
        savedPhotoIds={["saved-photo"]}
        showOrientation={false}
      />,
    );
    expect(html.match(/data-report-photo="saved-photo"/g)).toHaveLength(1);
    expect(html).toContain("/api/v2/reports/synthetic-report/photos/saved-photo");
    expect(html).toContain("report-inline-photo");
    const unavailable = renderToStaticMarkup(
      <ReportReading
        content={text}
        reportId="synthetic-report"
        savedPhotoIds={["saved-photo"]}
        photoUrls={{ "saved-photo": "https://untrusted.example/synthetic.jpg" }}
        showOrientation={false}
      />,
    );
    expect(unavailable).not.toContain("<img");
    expect(unavailable).not.toContain("https://untrusted.example");
    const noReport = renderToStaticMarkup(<ReportReading content={text} showOrientation={false} />);
    expect(noReport).not.toContain("<img");
  });

  test("editing keeps full-document UTF-16 capacity, bounded rows and native labels", () => {
    const section = reportReviewSections(content)[0];
    if (!section) throw new Error("MISSING_SYNTHETIC_REPORT_SECTION");
    const html = renderToStaticMarkup(
      <SectionEditor content={content} section={section} disabled photos={[]} />,
    );
    expect(html).toContain('aria-label="사건 개요 수정"');
    expect(html).toContain(`maxLength="${30000 - content.length + section.text.length}"`);
    expect(html).toContain('rows="4"');
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toContain("사건 개요에 넣을 사진");
    expect(html).toContain('data-slot="select"');
    expect(html).not.toContain("<select");
    expect(html).not.toMatch(/\sstyle=/i);
    const long = "한 줄\n".repeat(25);
    const longSection = { ...section, text: long };
    expect(
      renderToStaticMarkup(
        <SectionEditor content={long} section={longSection} disabled={false} photos={[]} />,
      ),
    ).toContain('rows="18"');
  });

  test("native section text and controlled photo values route without forged events or changing hidden bytes", () => {
    const section = reportReviewSections(content)[0];
    if (!section) throw new Error("MISSING_SYNTHETIC_REPORT_SECTION");
    const changes: string[] = [];
    const inputRef = { current: null };
    const photo = { id: "synthetic-photo", name: "합성 사진", byteLength: 1 };
    const tree = elements(
      SectionEditorFields({
        content,
        section,
        disabled: false,
        photos: [photo],
        inputRef,
        photoChoice: "",
        setPhotoChoice: (value) => changes.push(`photo:${value}`),
        unavailable: (value) => value.id === photo.id,
        insertPhoto: () => changes.push("insert"),
        onChange: (value) => changes.push(value),
      }),
    );
    const textarea = tree.find((node) => node.type === TextareaField);
    const select = tree.find((node) => node.type === SelectField);
    const button = tree.find((node) => node.type === Button);
    if (!textarea || !select || !button) throw new Error("MISSING_NATIVE_REPORT_EDITOR");
    expect(textarea.props.ref).toBe(inputRef);
    (textarea.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "직접 고친 내용 😀" },
    });
    (select.props.onValueChange as (value: string) => void)(photo.id);
    (button.props.onClick as () => void)();
    expect(changes).toEqual([
      content.replace(section.text, "직접 고친 내용 😀"),
      "photo:synthetic-photo",
      "insert",
    ]);
    expect(changes[0]).toContain("사실·주장·출처\r\n보존해야 하는 내부 출처");
    expect(select.props.options).toEqual([
      { value: "", label: "사건 사진 선택" },
      { value: photo.id, label: photo.name, disabled: true },
    ]);
    expect(textarea.props.maxLength).toBe(30000 - content.length + section.text.length);
  });

  test("readonly conversation questions are disabled and editor does not show excerpt cards", () => {
    const readonly = renderToStaticMarkup(
      <ReportReading content={content} disabled onAsk={() => {}} />,
    );
    const buttons = readonly.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    const asks = buttons.filter((button) => button.includes("이 내용 대화로 질문"));
    expect(asks).toHaveLength(3);
    for (const button of asks) expect(button).toContain('disabled=""');
    const editing = renderToStaticMarkup(<ReportReading content={content} editing />);
    expect(editing).not.toContain("data-product-report-orientation");
    expect(editing.match(/<textarea\b/g)).toHaveLength(3);
  });
});
