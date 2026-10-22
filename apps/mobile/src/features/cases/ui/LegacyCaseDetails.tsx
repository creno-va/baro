import type { CaseDetail } from "@baro/contracts/cases";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Text } from "../../../ui/Text";

export function LegacyCaseDetails({
  detail,
  onOpenLink,
}: {
  detail: CaseDetail;
  onOpenLink?: (url: string) => void;
}) {
  const result = detail.result;
  return (
    <>
      <Text variant="heading" accessibilityRole="header">
        기존 사건의 저장된 분석
      </Text>
      <Text>앱에서 열었다는 이유로 다시 분석하거나 새 AI 처리를 요청하지 않아요.</Text>
      <Text>
        상태:{" "}
        {
          {
            screening: "접수 확인 중",
            needs_clarification: "추가 답변 대기",
            queued: "처리 대기",
            analyzing: "분석 중",
            completed: "정리 완료",
            out_of_scope: "서비스 범위 안내",
            urgent_redirect: "긴급 상황 안내",
            failed: "처리 실패",
          }[detail.status]
        }
      </Text>
      {detail.startedAt ? <Text variant="muted">기존 처리 시작: {detail.startedAt}</Text> : null}
      {detail.completedAt ? (
        <Text variant="muted">기존 처리 완료: {detail.completedAt}</Text>
      ) : null}
      {detail.error ? (
        <Text accessibilityRole="alert">저장된 처리 오류: {detail.error.message}</Text>
      ) : null}
      {detail.status === "needs_clarification" ? (
        <Card>
          <Text>
            기존에 요청된 추가 질문이에요. 이 화면은 읽기·삭제를 제공하며 새 답변 제출이나 재분석을
            자동 실행하지 않아요.
          </Text>
          {detail.questions.map((question) => (
            <Text key={question.id}>
              {question.prompt}
              {question.options.length ? `\n선택지: ${question.options.join(" · ")}` : ""}
            </Text>
          ))}
        </Card>
      ) : null}
      {!result && detail.status !== "failed" ? (
        <Text>
          아직 저장된 분석 결과가 없어요. 최신 내용 확인으로 서버 상태를 다시 읽을 수 있어요.
        </Text>
      ) : null}
      {result ? (
        <>
          <Text variant="muted">이 결과의 기준일: {result.asOfDate}</Text>
          <Text>{result.notices.join("\n")}</Text>
          {result.kind === "guidance" ? (
            <>
              <Card>
                <Text variant="heading">사용자 진술</Text>
                <Text>{result.summary.userStatements.join("\n") || "기록된 항목이 없어요."}</Text>
                <Text variant="heading">AI가 정리한 내용</Text>
                <Text>사실 확정이나 법률 판단을 대신하지 않아요.</Text>
                <Text>{result.summary.organizedByAi.join("\n") || "기록된 항목이 없어요."}</Text>
                <Text variant="heading">아직 모르는 내용</Text>
                <Text>{result.summary.unknowns.join("\n") || "기록된 항목이 없어요."}</Text>
              </Card>
              <Card>
                <Text variant="heading">저장된 타임라인</Text>
                <Text>
                  {result.timeline
                    .map(
                      (entry) =>
                        `${entry.date ?? "날짜 모름"} · ${entry.source === "user" ? "사용자 진술" : "AI 정리"} · ${{ stated: "진술된 내용", inferred: "추정", unknown: "확인 필요" }[entry.confidence]}\n${entry.event}`,
                    )
                    .join("\n\n") || "기록된 항목이 없어요."}
                </Text>
              </Card>
              {result.issues.map((issue) => (
                <Card key={issue.id}>
                  <Text variant="heading">{issue.title}</Text>
                  <Text>{issue.explanation}</Text>
                  <Text>확인할 한계: {issue.uncertainty}</Text>
                  {issue.citationIds.map((id) => {
                    const citation = result.citations.find((value) => value.id === id);
                    return citation ? (
                      <Text key={id}>
                        근거: {citation.lawName} {citation.article} (아래 출처에서 확인)
                      </Text>
                    ) : null;
                  })}
                </Card>
              ))}
              <Card>
                <Text variant="heading">자료 확인 목록</Text>
                {result.evidenceChecklist.map((item) => (
                  <Text key={item.id}>
                    {item.label} ·{" "}
                    {
                      { provided: "있다고 입력함", missing: "없다고 입력함", unknown: "확인 필요" }[
                        item.status
                      ]
                    }
                    {"\n"}
                    {item.why}
                  </Text>
                ))}
              </Card>
              {result.nextSteps.map((step) => (
                <Card key={step.id}>
                  <Text variant="heading">{step.label}</Text>
                  <Text>{step.purpose}</Text>
                  <Text>주의: {step.caution}</Text>
                  {step.citationIds.map((id) => {
                    const citation = result.citations.find((value) => value.id === id);
                    return citation ? (
                      <Text key={id}>
                        근거: {citation.lawName} {citation.article}
                      </Text>
                    ) : null;
                  })}
                </Card>
              ))}
              <Text variant="heading">이 결과에 저장된 공식 출처</Text>
              {result.citations.map((citation) => (
                <Card key={citation.id}>
                  <Text>
                    {citation.lawName} {citation.article}
                  </Text>
                  <Text variant="muted">
                    시행 기준: {citation.effectiveDate} · 당시 확인: {citation.verifiedAt}
                  </Text>
                  <Button
                    label={`저장된 출처 열기: ${citation.lawName} ${citation.article}`}
                    disabled={!onOpenLink}
                    onPress={() => onOpenLink?.(citation.url)}
                  />
                </Card>
              ))}
            </>
          ) : (
            <Card>
              <Text variant="heading">
                {result.kind === "out_of_scope" ? "서비스 범위 안내" : "저장된 긴급 상황 안내"}
              </Text>
              <Text>{result.message}</Text>
              {Array.from(
                new Map(result.helpLinks.map((link) => [`${link.label}:${link.url}`, link])),
              ).map(([key, link]) => (
                <Button
                  key={key}
                  label={`안내 링크: ${link.label}`}
                  disabled={!onOpenLink}
                  onPress={() => onOpenLink?.(link.url)}
                />
              ))}
            </Card>
          )}
        </>
      ) : null}
    </>
  );
}
