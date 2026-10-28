import { legalFailureMessages } from "@baro/contracts/v2/legal-availability";
import { v2PrecedentTopicSchema } from "@baro/contracts/v2/precedent-research";
import { PRECEDENT_TOPIC_LABELS } from "@baro/contracts/v2/precedent-topics";
import { useState } from "react";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Choice } from "../../../ui/Choice";
import { Screen } from "../../../ui/Screen";
import { Text } from "../../../ui/Text";
import type { PrecedentsModel, PrecedentsState } from "../model";

export function PrecedentsScreen({
  state,
  actions,
  onSession,
  onReview,
}: {
  state: PrecedentsState;
  actions: PrecedentsModel;
  onSession(): void;
  onReview(): void;
}) {
  const [allTopics, setAllTopics] = useState(false);
  if (state.gate !== "ready")
    return (
      <Screen>
        <Text variant="heading" accessibilityRole="header">
          사건 판례 탐색
        </Text>
        <Text>
          {state.gate === "checking"
            ? "이용 상태를 확인하고 있어요."
            : state.gate === "consent"
              ? "최신 필수 동의를 확인해 주세요."
              : state.gate === "role"
                ? "고객 계정의 사건에서 이용할 수 있어요."
                : (state.error ?? "로그인·이용 상태를 확인해 주세요.")}
        </Text>
        <Button label="로그인·이용 상태 확인" onPress={onSession} />
      </Screen>
    );
  const { context, result, article, busy } = state;
  return (
    <Screen>
      <Text variant="heading" accessibilityRole="header">
        {context?.caseTitle ?? "사건 판례 탐색"}
      </Text>
      <Text variant="muted">
        공개된 주제로 공식 판례를 찾아봐요. 사건 설명은 검색어로 보내지 않아요. 판례의 사실관계와
        적용 여부는 별도로 검토해야 해요.
      </Text>
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {busy ? (
        <>
          <Text accessibilityLiveRegion="polite">
            {busy === "context"
              ? "사건과 요약 기준을 확인하고 있어요."
              : busy === "search"
                ? "공식 판례를 찾고 있어요."
                : "공식 원문을 확인하고 있어요."}
          </Text>
          <Button label="판례 요청 중단" onPress={actions.cancel} />
        </>
      ) : (
        <Button
          label="검색 조건 새로 확인"
          onPress={() => {
            void actions.refresh();
          }}
        />
      )}
      {!context || state.conflict ? (
        <Button label="최신 사건 요약 확인" onPress={onReview} />
      ) : (
        <>
          <Text variant="heading" accessibilityRole="header">
            검색 주제 · 최대 2개
          </Text>
          <Text variant="muted">
            사건 v{context.workspaceRevision} · 요약 v{context.summaryRevision}
          </Text>
          {(allTopics || !context.recommendedTopics.length
            ? v2PrecedentTopicSchema.options
            : [...new Set([...context.recommendedTopics, ...state.topics])]
          ).map((topic) => (
            <Choice
              key={topic}
              label={`${PRECEDENT_TOPIC_LABELS[topic]}${context.recommendedTopics.includes(topic) ? " · 추천 주제" : ""}`}
              checked={state.topics.includes(topic)}
              disabled={!!busy}
              onPress={() => actions.select(topic)}
            />
          ))}
          <Button
            label={allTopics ? "추천 주제만 보기" : "모든 주제 보기"}
            disabled={!!busy}
            onPress={() => setAllTopics(!allTopics)}
          />
          <Button
            variant="primary"
            label="선택 주제로 판례 검색"
            disabled={!!busy || state.topics.length < 1}
            onPress={() => {
              void actions.search();
            }}
          />
        </>
      )}
      {result ? (
        <>
          <Text accessibilityLiveRegion="polite">
            {
              {
                complete: "선택 주제의 확인된 판례",
                partial: "요청한 판례를 일부만 확인했어요",
                empty: "선택 주제에서 확인된 판례가 없어요",
                unavailable: "공식 판례를 현재 확인할 수 없어요",
              }[result.status]
            }
          </Text>
          <Text variant="muted">확인 시각: {result.checkedAt}</Text>
          {result.availabilityIssues?.map(({ topic, reason }) => (
            <Text key={`${topic}:${reason}`} variant="muted">
              {PRECEDENT_TOPIC_LABELS[topic]} · {legalFailureMessages[reason]}
            </Text>
          ))}
          {result.unavailableTopics.length ? (
            <Text>
              확인하지 못한 주제:{" "}
              {result.unavailableTopics.map((topic) => PRECEDENT_TOPIC_LABELS[topic]).join(" · ")}
            </Text>
          ) : null}
          {result.searchTruncated ? (
            <Text>
              일부 검색 범위에서 최대 6건을 확인했어요. 전체 판례를 조사한 결과가 아니에요.
            </Text>
          ) : null}
          {result.items.map((item) => (
            <Card key={item.id}>
              <Text variant="heading" accessibilityRole="header">
                {item.citation.title}
              </Text>
              <Text>
                {item.citation.court} · {item.citation.caseNumber} · {item.citation.decisionDate}
              </Text>
              <Text variant="muted">국가법령정보센터 · 원문 확인 {item.citation.verifiedAt}</Text>
              <Text>{item.excerpt.text}</Text>
              {item.excerpt.truncated ? <Text variant="muted">원문 중 일부 발췌예요.</Text> : null}
              <Button
                label={`${item.citation.title} 원문 읽기`}
                disabled={!!busy}
                onPress={() => {
                  void actions.read(item.id);
                }}
              />
              <Button
                label={`${item.citation.title} 공식 사이트 열기`}
                disabled={!!busy}
                onPress={() => {
                  void actions.openOfficial(item.id);
                }}
              />
            </Card>
          ))}
        </>
      ) : null}
      {article ? (
        <Card>
          <Text variant="heading" accessibilityRole="header">
            확인한 판례 원문
          </Text>
          <Text>{article.citation.title}</Text>
          <Text>
            {article.citation.court} · {article.citation.caseNumber}
          </Text>
          <Text selectable>{article.excerpt.text}</Text>
          {article.excerpt.truncated ? (
            <Text>원문 일부를 표시해요. 전체는 공식 사이트에서 확인해 주세요.</Text>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
