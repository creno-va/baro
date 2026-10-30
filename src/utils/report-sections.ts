const headings = new Set([
  "사건 개요",
  "당사자와 관계",
  "주요 경위",
  "주요 사실과 자료",
  "추가 확인 사항",
  "사건 요약",
  "사건의 사실과 주장",
  "당사자",
  "사실·주장·출처",
  "미확인 사항",
  "미확인·상반되는 내용",
  "타임라인",
  "공식 출처",
  "준비할 행동",
  "자료 처리 범위",
  "준비할 자료와 처리 범위",
  "연락과 전달",
  "안내",
]);
export function reportSections(content: string) {
  const result: { title: string; lines: string[] }[] = [];
  let current = { title: "검토한 내용", lines: [] as string[] };
  let fenced = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/u.test(line)) fenced = !fenced;
    if (!fenced && !/^[ \t]/u.test(line) && headings.has(line.trim())) {
      if (headings.has(current.title) || current.lines.some((value) => value.trim()))
        result.push(current);
      current = { title: line.trim(), lines: [] };
    } else current.lines.push(line);
  }
  if (headings.has(current.title) || current.lines.some((value) => value.trim()))
    result.push(current);
  return result;
}
