import type { WorkspaceCollection, WorkspaceView } from "@baro/client-core";
import type { V2FactReference } from "@baro/contracts/v2";
import { useState } from "react";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Choice } from "../../../ui/Choice";
import { Screen } from "../../../ui/Screen";
import { Text } from "../../../ui/Text";
import { TextField } from "../../../ui/TextField";
import type { WorkspaceModel, WorkspaceState } from "../model";

function referenceText(reference: V2FactReference, value: WorkspaceView) {
  switch (reference.kind) {
    case "intake_narrative":
      return "처음 입력한 사건 설명";
    case "intake_answer":
      return "추가 질문에 대한 답변";
    case "user_message":
      return `대화: ${value.messages.find((message) => message.id === reference.messageId)?.text ?? "이전 대화 (전체 기록에서 확인)"}`;
    case "official_source":
      return "공식 출처 (해당 답변의 출처 링크에서 확인)";
    case "user_material": {
      const name = value.files.find((file) => file.id === reference.fileId)?.name ?? "이전 자료";
      const position = reference.position;
      return `${name} · ${position.kind === "document" ? `${position.page}쪽${position.paragraph ? ` ${position.paragraph}문단` : ""}` : position.kind === "image" ? "이미지 영역" : "음성·영상 위치"} · 자료 v${reference.fileRevision}`;
    }
  }
}
export function WorkspaceScreen({
  state,
  actions,
  onSession,
  onReview,
  onCitation,
  onFiles,
  onReports,
  onPrecedents,
}: {
  state: WorkspaceState;
  actions: WorkspaceModel;
  onSession(): void;
  onReview(): void;
  onCitation(url: string): void;
  onFiles?: () => void;
  onReports?: () => void;
  onPrecedents?: () => void;
}) {
  const [section, setSection] = useState<"messages" | "facts" | "actions" | "timeline" | "files">(
    "messages",
  );
  if (state.gate !== "ready")
    return (
      <Screen>
        <Text variant="heading">사건 작업공간</Text>
        <Text>
          {state.gate === "checking"
            ? "이용 상태를 확인하고 있어요."
            : state.gate === "role"
              ? "고객 계정으로 이용할 수 있어요."
              : state.gate === "consent"
                ? "최신 이용 동의를 확인해 주세요."
                : "로그인·이용 상태를 확인해 주세요."}
        </Text>
        <Button label="로그인·이용 상태 확인" onPress={onSession} />
      </Screen>
    );
  const value = state.value,
    blocked =
      state.busy || Boolean(state.pending) || state.conflict || value?.case.stage === "archived";
  const more = (collection: WorkspaceCollection) =>
    value?.pagination?.[collection] ? (
      <Button
        label="이전·나머지 기록 더 보기"
        disabled={state.busy}
        onPress={() => {
          void actions.more(collection);
        }}
      />
    ) : null;
  return (
    <Screen>
      <Text variant="heading" accessibilityRole="header">
        {value?.case.title ?? "사건 작업공간"}
      </Text>
      <Text variant="muted">
        입력은 메모리에만 유지돼요. 다른 화면으로 이동하거나 앱을 종료하면 미저장 입력은 사라져요.
      </Text>
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {state.busy ? (
        <>
          <Text accessibilityLiveRegion="polite">최신 내용을 확인하고 있어요.</Text>
          <Button label="요청 중단" onPress={actions.cancel} />
        </>
      ) : (
        <Button
          label="최신 내용 확인"
          onPress={() => {
            void actions.refresh();
          }}
        />
      )}
      {state.pending ? (
        <Card>
          <Text>
            응답이 불확실해요. 같은 내용과 원래 버전으로 확인하며 새 요청을 만들지 않아요.
          </Text>
          <Button
            label="같은 요청 다시 확인"
            disabled={state.busy || state.conflict}
            onPress={() => {
              void actions.replay();
            }}
          />
        </Card>
      ) : null}
      {state.conflict ? (
        <>
          <Text>다른 변경과 겹쳤어요. 입력을 버리고 최신 내용을 확인한 뒤 다시 작성해 주세요.</Text>
          <Button
            label="입력 버리고 최신 내용 불러오기"
            disabled={state.busy}
            onPress={() => {
              void actions.refresh(true);
            }}
          />
        </>
      ) : null}
      {value ? (
        <>
          {value.case.summaryNeedsConfirmation ||
          value.case.stage === "intake" ||
          value.case.stage === "summary" ? (
            <Card>
              <Text>다음 대화 전에 사건 요약을 검토·확인해 주세요.</Text>
              <Button label="요약 검토·확인하기" disabled={state.busy} onPress={onReview} />
            </Card>
          ) : null}
          {value.case.schemaVersion === "2" && onPrecedents ? (
            <Button label="사건 판례 탐색" onPress={onPrecedents} disabled={state.busy} />
          ) : null}
          {value.case.schemaVersion === "1" ? (
            <>
              <Text>
                기존 사건은 내 사건 화면에서 확인해 주세요. 자동으로 다시 분석하지 않아요.
              </Text>
              <Button label="내 사건에서 확인" onPress={onReview} />
            </>
          ) : (
            <>
              {(["messages", "facts", "timeline", "actions", "files"] as const).map((item) => (
                <Choice
                  key={item}
                  kind="radio"
                  label={
                    {
                      messages: "대화",
                      facts: "사실·확인할 내용",
                      timeline: "타임라인",
                      actions: "다음 행동",
                      files: "자료 목록",
                    }[item]
                  }
                  checked={section === item}
                  onPress={() => setSection(item)}
                />
              ))}
              {section === "messages" ? (
                <>
                  {value.messages.length === 0 ? <Text>저장된 대화가 없어요.</Text> : null}
                  {value.messages.map((message) => (
                    <Card key={message.id}>
                      <Text variant="heading">
                        {message.role === "user" ? "내가 보낸 내용" : "BARO 정리"}
                      </Text>
                      <Text>{message.text}</Text>
                      {message.selectedFileIds?.map((fileId) => (
                        <Text key={fileId} variant="muted">
                          선택 자료:{" "}
                          {value.files.find((file) => file.id === fileId)?.name ?? "이전 자료"}
                        </Text>
                      ))}
                      {[...new Set(message.warnings)].map((warning) => (
                        <Text key={warning}>{warning}</Text>
                      ))}
                      {Array.from(
                        new Map(message.references?.map((ref) => [JSON.stringify(ref), ref])),
                      ).map(([key, reference]) => (
                        <Text key={key} variant="muted">
                          근거: {referenceText(reference, value)}
                        </Text>
                      ))}
                      {message.citations?.map((citation) => (
                        <Button
                          key={citation.id}
                          label={`출처 열기: ${citation.title}`}
                          onPress={() => onCitation(citation.url)}
                        />
                      ))}
                      {message.status === "pending" ? (
                        <Text accessibilityLiveRegion="polite">
                          처리 중 · 화면을 보고 있는 동안 갱신돼요.
                        </Text>
                      ) : null}
                      {message.status === "failed" ? (
                        <Text>처리에 실패했어요. 저장된 사실과 원본을 확인해 주세요.</Text>
                      ) : null}
                      {message.status === "failed" && message.retryable ? (
                        <Button
                          label="이 응답 다시 시도"
                          disabled={blocked}
                          onPress={() => {
                            void actions.retry(message.id);
                          }}
                        />
                      ) : null}
                    </Card>
                  ))}
                  {more("messages")}
                  <TextField
                    label="추가로 정리할 내용"
                    value={state.text}
                    multiline
                    maxLength={10000}
                    editable={!blocked}
                    onChangeText={actions.setText}
                  />
                  <Button
                    variant="primary"
                    label="내용 보내기"
                    disabled={
                      blocked ||
                      !state.text.trim() ||
                      value.case.stage !== "active" ||
                      value.case.summaryNeedsConfirmation ||
                      value.messages.some((message) => message.status === "pending")
                    }
                    onPress={() => {
                      void actions.send();
                    }}
                  />
                </>
              ) : null}
              {section === "facts" ? (
                <>
                  <Text variant="heading">현재 요약</Text>
                  <Text>{value.case.summary || "아직 저장된 요약이 없어요."}</Text>
                  {value.people?.map((person) => (
                    <Text key={person.id}>
                      {person.label} · {person.role}
                    </Text>
                  ))}
                  {value.facts?.map((fact) => (
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
                      <Text>{fact.text}</Text>
                      {fact.conflictingFactIds.map((id) => (
                        <Text key={id}>
                          엇갈리는 사실:{" "}
                          {value.facts?.find((other) => other.id === id)?.text ??
                            "이전 요약에서 확인"}
                        </Text>
                      ))}
                      {Array.from(
                        new Map(fact.references.map((ref) => [JSON.stringify(ref), ref])),
                      ).map(([key, reference]) => (
                        <Text key={key} variant="muted">
                          근거: {referenceText(reference, value)}
                        </Text>
                      ))}
                    </Card>
                  ))}
                  <Text variant="heading">아직 모르는 내용</Text>
                  {value.unknowns?.length ? (
                    [...new Set(value.unknowns)].map((unknown) => (
                      <Text key={unknown}>{unknown}</Text>
                    ))
                  ) : (
                    <Text>별도 기록된 항목이 없어요.</Text>
                  )}
                  {[...new Set(value.notices)].map((notice) => (
                    <Text key={notice} variant="muted">
                      {notice}
                    </Text>
                  ))}
                  <Text>사실 교정은 요약 검토에서 제공하는 편집 또는 대화로 남겨 주세요.</Text>
                </>
              ) : null}
              {section === "actions" ? (
                <>
                  {value.actions.length === 0 ? <Text>아직 준비할 행동이 없어요.</Text> : null}
                  {value.actions.map((action) => (
                    <Card key={action.id}>
                      <Choice
                        label={action.title}
                        checked={action.done}
                        disabled={blocked || action.revision === undefined}
                        onPress={() => {
                          void actions.setAction(action);
                        }}
                      />
                      <Text>{action.detail}</Text>
                    </Card>
                  ))}
                  {more("actions")}
                </>
              ) : null}
              {section === "timeline" ? (
                <>
                  {value.timeline.map((entry) => (
                    <Card key={entry.id}>
                      <Text>
                        {entry.date
                          ? `${entry.date} · ${{ day: "일", month: "월", year: "연도", unknown: "모름" }[entry.datePrecision ?? "day"]} 단위`
                          : "날짜 모름"}
                      </Text>
                      <Text variant="heading">{entry.title}</Text>
                      <Text>{entry.detail}</Text>
                      <Button
                        label={`기록 수정: ${entry.title}`}
                        disabled={
                          blocked || Boolean(state.timeline) || entry.revision === undefined
                        }
                        onPress={() => actions.editTimeline(entry)}
                      />
                    </Card>
                  ))}
                  {more("timeline")}
                  {!state.timeline ? (
                    <Button
                      label="타임라인 기록 추가"
                      disabled={blocked}
                      onPress={() => actions.editTimeline()}
                    />
                  ) : (
                    <Card>
                      <TextField
                        label="기록 제목"
                        value={state.timeline.title}
                        maxLength={2000}
                        editable={!blocked}
                        onChangeText={(title) => actions.changeTimeline({ title })}
                      />
                      <TextField
                        label="기록 내용"
                        value={state.timeline.detail}
                        multiline
                        maxLength={2000}
                        editable={!blocked}
                        onChangeText={(detail) => actions.changeTimeline({ detail })}
                      />
                      {(["day", "month", "year", "unknown"] as const).map((precision) => (
                        <Choice
                          key={precision}
                          kind="radio"
                          label={
                            {
                              day: "날짜까지 앎",
                              month: "월까지 앎",
                              year: "연도만 앎",
                              unknown: "날짜 모름",
                            }[precision]
                          }
                          checked={state.timeline?.datePrecision === precision}
                          disabled={blocked}
                          onPress={() =>
                            actions.changeTimeline({
                              datePrecision: precision,
                              ...(precision === "unknown" ? { date: "" } : {}),
                            })
                          }
                        />
                      ))}
                      {state.timeline.datePrecision !== "unknown" ? (
                        <TextField
                          label="날짜 (YYYY-MM-DD, 월은 01일·연도는 01월 01일)"
                          value={state.timeline.date}
                          editable={!blocked}
                          onChangeText={(date) => actions.changeTimeline({ date })}
                        />
                      ) : null}
                      <Button
                        variant="primary"
                        label="타임라인 저장"
                        disabled={blocked}
                        onPress={() => {
                          void actions.saveTimeline();
                        }}
                      />
                      <Button
                        label="기록 편집 닫기 (입력 버림)"
                        disabled={blocked}
                        onPress={actions.closeTimeline}
                      />
                    </Card>
                  )}
                </>
              ) : null}
              {section === "files" ? (
                <>
                  {onReports ? <Button label="상담 준비 리포트" onPress={onReports} /> : null}
                  {onFiles ? <Button label="자료 추가·검토·원본 저장" onPress={onFiles} /> : null}
                  <Text>
                    저장된 자료의 이름과 처리 상태를 확인하고 대화에 사용할 자료를 선택해 주세요.
                    자료 추가·검토·원본 저장 화면에서 파일을 관리할 수 있어요.
                  </Text>
                  {value.files.length === 0 ? <Text>저장된 자료가 없어요.</Text> : null}
                  {value.files.map((file) => (
                    <Card key={file.id}>
                      <Choice
                        label={`대화에 선택: ${file.name}`}
                        checked={state.selectedFileIds.includes(file.id)}
                        disabled={blocked || file.status !== "ready"}
                        onPress={() => actions.selectFile(file.id)}
                      />
                      <Text>
                        {
                          {
                            ready: "처리 완료",
                            failed: "처리 실패",
                            processing: "처리 중",
                            uploading: "업로드 중",
                            waiting: "처리 대기",
                          }[file.status]
                        }{" "}
                        · {file.sizeBytes} bytes
                      </Text>
                      <Text>{file.coverage}</Text>
                    </Card>
                  ))}
                </>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
