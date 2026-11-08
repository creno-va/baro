const headings = new Set([
  "내 사건 한눈에",
  "먼저 확인할 핵심 쟁점",
  "선택지와 확인 조건",
  "리포트 준비 상태",
  "사건 입장과 절차",
  "법적 쟁점과 법 조항",
  "판례별 공통점과 차이점",
  "우리 측 약점과 보완",
  "다음 행동과 필요 자료",
  "출처와 분석 기준",
  "사건 개요",
  "당사자와 관계",
  "주요 경위",
  "주요 사실과 자료",
  "주요 사실",
  "증거 자료",
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
