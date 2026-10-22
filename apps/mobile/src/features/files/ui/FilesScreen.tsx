import { useState } from "react";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Choice } from "../../../ui/Choice";
import { Screen } from "../../../ui/Screen";
import { Text } from "../../../ui/Text";
import { TextField } from "../../../ui/TextField";
import type { FilesModel, FilesState } from "../model";
import { Coverage, sourcePosition } from "./Coverage";

const status = {
  uploading: "업로드 중",
  processing: "처리 중",
  waiting: "처리 대기",
  ready: "처리 완료",
  failed: "처리 실패",
};
const stages = {
  checking_access: "이용 권한 확인",
  hashing: "파일 바이트 확인",
  preparing: "업로드 준비",
  uploading: "전송",
  checking: "서버 저장 확인",
  confirming: "최신 상태 조회",
};
export function FilesScreen({
  state,
  actions,
  onSession,
  onWorkspace,
  onReports,
}: {
  state: FilesState;
  actions: FilesModel;
  onSession(): void;
  onWorkspace(): void;
  onReports?(): void;
}) {
  const [restart, setRestart] = useState(false);
  if (state.gate !== "ready")
    return (
      <Screen>
        <Text variant="title">사건 자료</Text>
        <Text>
          {state.gate === "checking"
            ? "이용 상태를 확인하고 있어요."
            : state.gate === "role"
              ? "고객 계정으로 자료를 확인할 수 있어요."
              : "로그인·이용 상태를 확인해 주세요."}
        </Text>
        <Button label="로그인·이용 상태 확인" onPress={onSession} />
      </Screen>
    );
  const busy = Boolean(state.busy),
    review = state.review;
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        사건 자료
      </Text>
      <Text>
        문서·사진은 최대 100MB, 음성·영상은 최대 1GB까지 선택할 수 있어요. 실제 형식·처리 가능
        범위는 서버에서 확인해요.
      </Text>
      <Text variant="muted">
        전송은 앱을 나가면 중단될 수 있어요. 같은 파일을 다시 선택하면 저장된 요청으로 확인합니다.
        미저장 교정은 화면 이탈·백그라운드 전환 때 사라질 수 있어요.
      </Text>
      {!state.canWrite ? (
        <Card>
          <Text>
            최신 이용 동의 후 자료 추가·처리·교정을 할 수 있어요. 기존 자료 조회·원본 저장·삭제는
            계속 이용할 수 있어요.
          </Text>
          <Button label="최신 동의 확인" onPress={onSession} />
        </Card>
      ) : null}
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {state.notice ? <Text accessibilityLiveRegion="polite">{state.notice}</Text> : null}
      {state.loading ? (
        <Text accessibilityLiveRegion="polite">서버 자료 목록을 확인하고 있어요.</Text>
      ) : null}
      <Button
        label="자료 목록 새로 확인"
        disabled={busy || state.loading}
        onPress={() => {
          void actions.refresh();
        }}
      />
      <Button
        label="기기에서 파일·사진 선택"
        disabled={busy || !state.canWrite || state.pendingUpload}
        onPress={() => {
          setRestart(false);
          void actions.select();
        }}
      />
      {state.busy === "select" ? <Text>기기의 파일 선택을 마친 뒤 돌아와 주세요.</Text> : null}
      {state.source ? (
        <Card>
          <Text variant="heading">선택: {state.source.name}</Text>
          <Text>
            {state.source.size.toLocaleString()} bytes · 파일 내용을 확인한 후 업로드해 주세요.
          </Text>
          {state.progress ? (
            <Text accessibilityLiveRegion="polite">
              {stages[state.progress.stage]} ·{" "}
              {Math.round((state.progress.completedBytes / state.progress.totalBytes) * 100)}%
            </Text>
          ) : null}
          <Button
            label={state.pendingUpload ? "같은 파일의 업로드 결과 다시 확인" : "선택한 파일 업로드"}
            disabled={busy || !state.canWrite || state.uploadConflict}
            onPress={() => {
              void actions.upload();
            }}
          />
          {state.uploadConflict ? (
            <>
              <Text>
                이전 업로드의 결과가 확정되지 않았거나 기한이 지났어요. 목록에서 저장된 자료를
                확인한 뒤 새 업로드를 시작해 주세요.
              </Text>
              <Choice
                label="최신 상태를 확인했고 새 업로드 시도로 시작합니다"
                checked={restart}
                disabled={busy}
                onPress={() => setRestart(!restart)}
              />
              <Button
                label="최신 버전으로 업로드 다시 시작"
                disabled={busy || !restart || !state.canWrite}
                onPress={() => {
                  setRestart(false);
                  void actions.upload(true);
                }}
              />
            </>
          ) : null}
        </Card>
      ) : null}
      {state.source || busy ? (
        <Button label="기기 전송·선택 중단" onPress={actions.cancelSelection} />
      ) : null}
      {!state.files.length && !state.loading ? <Text>저장된 자료가 없어요.</Text> : null}
      {state.files.map((file) => (
        <Card key={file.id}>
          <Text variant="heading">{file.name}</Text>
          <Text>
            {status[file.status]} · {file.sizeBytes.toLocaleString()} bytes
          </Text>
          <Text>{file.coverage}</Text>
          {file.processing ? (
            <Text>
              서버 처리 상태:{" "}
              {file.processing.status === "queued"
                ? "대기"
                : file.processing.status === "validating"
                  ? "결과 확인 중"
                  : "처리 중"}{" "}
              · {new Date(file.processing.updatedAt).toLocaleString()}
            </Text>
          ) : null}
          {file.uploadRejection ? (
            <Text>
              파일 형식이나 내용을 확인하지 못했어요. 지원하는 형식으로 저장한 뒤 다시 선택해
              주세요.
            </Text>
          ) : null}
          {file.canStartProcessing || file.canRetry ? (
            <Button
              label={
                file.canStartProcessing ? `${file.name} 처리 시작` : `${file.name} 처리 다시 시도`
              }
              disabled={busy || !state.canWrite}
              onPress={() => {
                void actions.retry(file.id);
              }}
            />
          ) : null}
          <Button
            label={`${file.name} 처리 범위·관찰 검토`}
            disabled={busy || Boolean(state.edit) || file.status !== "ready"}
            onPress={() => {
              void actions.review(file.id);
            }}
          />
          <Button
            label={`${file.name} 원본을 기기에 저장`}
            disabled={busy || file.status === "uploading" || Boolean(file.uploadRejection)}
            onPress={() => {
              void actions.original(file.id);
            }}
          />
          <Button
            label={`${file.name} 삭제 확인`}
            disabled={busy}
            onPress={() => actions.askDelete(file.id)}
          />
        </Card>
      ))}
      {state.download ? (
        <Card>
          <Text variant="heading">저장한 원본: {state.download.file.name}</Text>
          <Text>
            앱 전용 임시 파일이에요. 열기·공유는 직접 선택한 외부 앱으로 전달될 수 있으며 전달한
            복사본은 BARO의 삭제로 회수되지 않아요.
          </Text>
          <Button
            label="저장한 원본 열기"
            disabled={busy}
            onPress={() => {
              void actions.present("open");
            }}
          />
          <Button
            label="저장한 원본 공유·다른 앱에 저장"
            disabled={busy}
            onPress={() => {
              void actions.present("share");
            }}
          />
        </Card>
      ) : null}
      {state.deleteTarget ? (
        <Card>
          <Text variant="heading">자료 삭제 확인</Text>
          <Text>원본·처리 자료의 삭제를 요청합니다. 외부로 전달한 복사본은 회수되지 않아요.</Text>
          <TextField
            label="삭제 확인 DELETE"
            value={state.confirmation}
            editable={!busy}
            autoCapitalize="characters"
            onChangeText={actions.confirm}
          />
          <Button
            label="확인한 자료 삭제 요청"
            disabled={busy || state.confirmation !== "DELETE"}
            onPress={() => {
              void actions.remove();
            }}
          />
          <Button label="자료 삭제 취소" disabled={busy} onPress={actions.closeDelete} />
        </Card>
      ) : null}
      {review ? (
        <Card>
          <Text variant="heading">자료 검토: {review.file.name}</Text>
          <Coverage key={`${review.file.id}:${review.file.revision}`} value={review.coverage} />
          <Text>
            관찰·추정과 원본을 함께 확인해 주세요. 사용자 교정은 검증된 사실을 뜻하지 않으며 교정 전
            원문은 보존됩니다.
          </Text>
          {review.recovery ? (
            <Text accessibilityRole="alert">{review.recovery.message}</Text>
          ) : null}
          {review.pendingReview ? (
            <>
              <Text>
                미완료 교정 {review.pendingReview.completed}/{review.pendingReview.total}
              </Text>
              <Button
                label="남은 교정 이어서 저장"
                disabled={busy || !state.canWrite || review.pendingReview.status === "conflict"}
                onPress={() => {
                  void actions.pendingReview(false);
                }}
              />
              <Button
                label="남은 교정 중단"
                disabled={busy || !state.canWrite}
                onPress={() => {
                  void actions.pendingReview(true);
                }}
              />
            </>
          ) : null}
          {state.reviewConflict ? (
            <>
              <Text>
                자료 버전이 바뀌었어요. 미저장 입력을 확인한 뒤 최신 내용으로 다시 시작해 주세요.
              </Text>
              <Button
                label="미저장 교정을 버리고 최신 검토 읽기"
                disabled={busy}
                onPress={() => {
                  void actions.review(review.file.id);
                }}
              />
            </>
          ) : null}
          {review.observations.map((row) => (
            <Card key={row.value.id}>
              <Text>
                {sourcePosition(row.value.position)} ·{" "}
                {row.value.certainty === "observed" ? "관찰" : "미확인·불확실"} ·{" "}
                {row.value.included ? "정리에 포함" : "정리에서 제외"}
              </Text>
              <Text>{row.value.text}</Text>
              {row.value.userEdited ? (
                <>
                  <Text>사용자가 교정한 내용이에요.</Text>
                  <Text>교정 전 원문: {row.original.text}</Text>
                </>
              ) : null}
              <Button
                label={`${row.ordinal + 1}번째 관찰 교정·제외`}
                disabled={
                  busy ||
                  !state.canWrite ||
                  Boolean(review.pendingReview) ||
                  Boolean(state.edit) ||
                  state.reviewConflict
                }
                onPress={() => actions.edit(row.value.id)}
              />
            </Card>
          ))}
          {state.edit ? (
            <Card>
              <TextField
                label="관찰 교정 내용"
                multiline
                maxLength={5000}
                editable={!busy && !state.reviewConflict}
                value={state.edit.text}
                onChangeText={(text) => actions.changeEdit({ text })}
              />
              <Choice
                label="이 관찰을 정리에 포함"
                checked={state.edit.included}
                disabled={busy || state.reviewConflict}
                onPress={() => actions.changeEdit({ included: !state.edit?.included })}
              />
              <Button
                label="원래 버전으로 교정 저장"
                disabled={busy || state.reviewConflict || !state.canWrite}
                onPress={() => {
                  void actions.saveEdit();
                }}
              />
              <Button label="미저장 교정 버리기" disabled={busy} onPress={actions.cancelEdit} />
            </Card>
          ) : null}
          {state.reviewHistory.length ? (
            <Button
              label="앞 관찰 페이지 읽기"
              disabled={busy || Boolean(state.edit)}
              onPress={() => {
                void actions.review(review.file.id, false, true);
              }}
            />
          ) : null}
          {review.nextAfterOrdinal !== null ? (
            <Button
              label="다음 관찰 페이지 읽기"
              disabled={busy || Boolean(state.edit)}
              onPress={() => {
                void actions.review(review.file.id, true);
              }}
            />
          ) : null}
          <Button
            label="자료 검토 닫기 (미저장 교정 버림)"
            disabled={busy}
            onPress={actions.closeReview}
          />
        </Card>
      ) : null}
      {onReports ? (
        <Button label="상담 준비 리포트로 이동" disabled={busy} onPress={onReports} />
      ) : null}
      <Button label="사건 작업공간으로" disabled={busy} onPress={onWorkspace} />
    </Screen>
  );
}
