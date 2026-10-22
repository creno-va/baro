import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Choice } from "../../../ui/Choice";
import { Screen } from "../../../ui/Screen";
import { Text } from "../../../ui/Text";
import { TextField } from "../../../ui/TextField";
import type { CasesModel, CasesState } from "../model";
import { LegacyCaseDetails } from "./LegacyCaseDetails";

export function CasesScreen({
  state,
  actions,
  onSession,
  onWorkspace,
  onOpenLink,
}: {
  state: CasesState;
  actions: CasesModel;
  onSession: () => void;
  onWorkspace?: (caseId: string) => void;
  onOpenLink?: (url: string) => void;
}) {
  if (state.gate !== "ready")
    return (
      <Screen>
        <Text variant="heading" accessibilityRole="header">
          내 사건 이용 상태
        </Text>
        <Text>
          {
            {
              checking: "이용 계정과 동의를 확인하고 있어요.",
              login: "사건을 저장하고 이어 보려면 로그인해 주세요.",
              consent: "현재 필수 동의를 확인해 주세요.",
              role: "내 사건은 고객 역할로 이용할 수 있어요.",
              error: "이용 상태를 확인하지 못했어요.",
            }[state.gate]
          }
        </Text>
        {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
        <Button label="로그인·이용 상태 확인" onPress={onSession} />
      </Screen>
    );
  const q = state.questions,
    blocked = state.busy || state.conflict || state.deleteUncertain,
    item = state.item;
  const questions = q?.rounds?.length
    ? q.questions.filter((question) =>
        q.rounds?.find((r) => r.ordinal === state.round)?.questionIds.includes(question.id),
      )
    : (q?.questions ?? []);
  return (
    <Screen>
      <Text variant="heading" accessibilityRole="header">
        {state.view === "list"
          ? "내 사건"
          : state.view === "create"
            ? "새 사건 정리"
            : (item?.title ?? "사건 확인")}
      </Text>
      {state.view !== "list" ? (
        <Text variant="muted">
          다른 화면으로 이동하거나 앱을 종료하면 미저장 입력은 사라져요. 저장한 내용은 내 사건에서
          다시 확인할 수 있어요.
        </Text>
      ) : null}
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {state.notice ? <Text accessibilityLiveRegion="polite">{state.notice}</Text> : null}
      {state.busy ? <Text accessibilityRole="progressbar">요청을 확인하고 있어요.</Text> : null}
      {state.busy ? <Button label="진행 중인 요청 중단" onPress={actions.cancel} /> : null}
      {state.view === "list" ? (
        <>
          <Button label="새 사건 만들기" onPress={actions.newCase} disabled={state.busy} />
          <Button
            label="사건 목록 새로 확인"
            onPress={() => {
              void actions.refresh();
            }}
            disabled={state.busy}
          />
          {!state.items.length && !state.busy ? (
            <Text>아직 저장한 사건이 없어요. 기억나는 내용부터 정리해 보세요.</Text>
          ) : null}
          {state.items.map((row) => (
            <Card key={row.id}>
              <Text variant="heading">{row.title}</Text>
              <Text>
                {row.schemaVersion === "1"
                  ? "기존 사건 기록"
                  : row.stage === "intake"
                    ? "질문 정리 중"
                    : row.stage === "summary"
                      ? "요약 확인"
                      : "저장된 사건"}
              </Text>
              <Button
                label={`${row.title} 이어 보기`}
                onPress={() => {
                  void actions.open(row);
                }}
                disabled={state.busy}
              />
            </Card>
          ))}
        </>
      ) : (
        <Button
          label={
            Object.keys(state.answers).length ||
            Object.keys(state.facts).length ||
            (item && state.summary !== item.summary)
              ? "미저장 수정 버리고 목록으로"
              : "내 사건 목록으로"
          }
          onPress={actions.list}
          disabled={state.busy}
        />
      )}
      {state.view === "create" ? (
        <>
          <Text>기억나는 사실을 적어 주세요. 모르는 내용은 질문에서 따로 표시할 수 있어요.</Text>
          <Choice
            kind="radio"
            label="개인 사건"
            checked={state.subjectContext === "individual"}
            onPress={() => actions.setSubject("individual")}
            disabled={state.busy}
          />
          <Choice
            kind="radio"
            label="기업 사건"
            checked={state.subjectContext === "company"}
            onPress={() => actions.setSubject("company")}
            disabled={state.busy}
          />
          <TextField
            label="사건의 상황"
            value={state.narrative}
            multiline
            maxLength={5000}
            editable={!state.busy}
            onChangeText={actions.setNarrative}
          />
          <Text variant="muted">
            20~5,000자. 저장 전에 보안 확인을 진행해요. 저장하지 않은 내용은 앱을 종료하면 사라질 수
            있어요.
          </Text>
          <Button
            label="보안 확인하고 사건 저장"
            disabled={state.busy}
            onPress={() => {
              void actions.create();
            }}
          />
        </>
      ) : null}
      {state.view === "detail" && item ? (
        <>
          <Button
            label="최신 내용 다시 확인"
            disabled={state.busy}
            onPress={() => {
              void actions.refresh();
            }}
          />
          {state.conflict ? (
            <Button
              label="미저장 수정 버리고 최신 내용 사용"
              onPress={() => {
                void actions.refresh(true);
              }}
            />
          ) : null}
          {item.schemaVersion === "1" ? (
            item.legacyDetail ? (
              <LegacyCaseDetails
                detail={item.legacyDetail}
                {...(onOpenLink ? { onOpenLink } : {})}
              />
            ) : (
              <Text>기존 사건의 저장된 상세 결과를 확인하고 있어요.</Text>
            )
          ) : null}
          {q ? (
            <>
              <Text>질문은 최대 {q.roundLimit ?? 2}차례이며, 한 번에 최대 3개예요.</Text>
              {q.processing ? (
                <Text accessibilityRole="progressbar">
                  {q.processingMessage ?? "저장한 내용으로 정리하고 있어요."}
                </Text>
              ) : null}
              {q.failed ? (
                <Text accessibilityRole="alert">
                  정리를 완료하지 못했어요. 저장한 답변은 보존돼요.
                </Text>
              ) : null}
              {q.rounds?.map((round) => (
                <Choice
                  key={round.ordinal}
                  kind="radio"
                  label={`${round.ordinal}차 질문 보기`}
                  checked={state.round === round.ordinal}
                  disabled={state.busy}
                  onPress={() => actions.selectRound(round.ordinal)}
                />
              ))}
              {questions.map((question) => {
                const answer = state.answers[question.id] ?? {
                  questionId: question.id,
                  state: question.answerState,
                  value: question.answer ?? "",
                };
                return (
                  <Card key={question.id}>
                    <Text variant="heading">{question.text}</Text>
                    {question.kind === "choice" ? (
                      question.options?.map((value) => (
                        <Choice
                          key={value}
                          kind="radio"
                          label={value}
                          checked={answer.state === "answered" && answer.value === value}
                          disabled={blocked || q.processing === true}
                          onPress={() =>
                            actions.answer({ questionId: question.id, state: "answered", value })
                          }
                        />
                      ))
                    ) : (
                      <TextField
                        label={question.text}
                        multiline
                        maxLength={1000}
                        value={answer.state === "answered" ? answer.value : ""}
                        editable={!blocked && !q.processing}
                        onChangeText={(value) =>
                          actions.answer({ questionId: question.id, state: "answered", value })
                        }
                      />
                    )}
                    <Choice
                      label="모르겠어요"
                      checked={answer.state === "unknown"}
                      disabled={blocked || q.processing === true}
                      onPress={() => actions.answer({ questionId: question.id, state: "unknown" })}
                    />
                    <Choice
                      label="답변 건너뛰기"
                      checked={answer.state === "skipped"}
                      disabled={blocked || q.processing === true}
                      onPress={() => actions.answer({ questionId: question.id, state: "skipped" })}
                    />
                  </Card>
                );
              })}
              {questions.length ? (
                <Button
                  label="이 차례의 답변 저장"
                  disabled={blocked || q.processing === true}
                  onPress={() => {
                    void actions.saveAnswers();
                  }}
                />
              ) : null}
              {!q.complete ? (
                <Button
                  label={
                    q.failed
                      ? q.canPrepareSummary
                        ? "저장한 답변으로 요약 준비"
                        : "정리 다시 시도"
                      : "저장한 답변으로 계속하기"
                  }
                  disabled={
                    blocked ||
                    q.processing === true ||
                    (q.failed === true && !q.retryable && !q.canPrepareSummary)
                  }
                  onPress={() => {
                    void actions.advance();
                  }}
                />
              ) : null}
            </>
          ) : null}
          {item.schemaVersion !== "1" &&
          (item.stage === "summary" || item.stage === "active" || item.stage === "archived") ? (
            <>
              <Text variant="heading" accessibilityRole="header">
                저장된 요약
              </Text>
              {item.stage === "summary" ? (
                <>
                  <TextField
                    label="사건 요약"
                    value={state.summary}
                    multiline
                    maxLength={5000}
                    editable={!blocked}
                    onChangeText={actions.editSummary}
                  />
                  {item.summaryDetails?.facts.map((fact, index) => (
                    <Card key={fact.id}>
                      <Text>
                        {
                          {
                            reported: "사용자 진술",
                            observed: "자료 관찰",
                            uncertain: "확인 필요",
                            conflicting: "엇갈리는 내용",
                          }[fact.certainty]
                        }
                      </Text>
                      <TextField
                        label={`사실 ${index + 1}`}
                        value={state.facts[fact.id] ?? fact.text}
                        multiline
                        maxLength={2000}
                        editable={!blocked}
                        onChangeText={(text) => actions.editFact(fact.id, text)}
                      />
                    </Card>
                  ))}
                  <TextField
                    label="아직 모르는 내용 (한 줄에 하나)"
                    value={state.unknowns}
                    multiline
                    editable={!blocked}
                    onChangeText={actions.editUnknowns}
                  />
                  <Button
                    label="수정한 요약 저장"
                    disabled={blocked}
                    onPress={() => {
                      void actions.saveSummary();
                    }}
                  />
                  <Button
                    label="요약 확인하고 계속"
                    disabled={blocked}
                    onPress={() => {
                      void actions.confirm();
                    }}
                  />
                </>
              ) : (
                <>
                  <Text>{item.summary || "사건 기록이 저장됐어요."}</Text>
                  {item.schemaVersion === "2" && onWorkspace ? (
                    <Button
                      label="사건 작업공간 열기"
                      disabled={state.busy || state.deleteUncertain}
                      onPress={() => onWorkspace(item.id)}
                    />
                  ) : null}
                </>
              )}
              {item.summaryDetails?.notices.map((notice) => (
                <Text key={notice} variant="muted">
                  {notice}
                </Text>
              ))}
            </>
          ) : null}
          {item.schemaVersion ? (
            <Card>
              <Text variant="heading">이 사건 삭제</Text>
              <Text>
                사건과 연결된 자료·분석 결과를 삭제 요청해요. 되돌릴 수 없어요. 관련 자료 정리는
                서버에서 이어질 수 있어요.
              </Text>
              {state.deleteUncertain ? (
                <Text>
                  삭제 응답이 불확실해요. 같은 삭제 요청으로 다시 확인하거나 최신 내용을 읽어
                  주세요.
                </Text>
              ) : null}
              <TextField
                label="사건 삭제 확인 (DELETE 입력)"
                value={state.deleteConfirmation}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
                editable={!state.busy && !state.deleteUncertain}
                onChangeText={actions.setDeleteConfirmation}
              />
              <Button
                label={state.deleteUncertain ? "같은 삭제 요청 다시 확인" : "이 사건 삭제 요청"}
                disabled={state.busy || state.deleteConfirmation !== "DELETE"}
                onPress={() => {
                  void actions.deleteCase();
                }}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
