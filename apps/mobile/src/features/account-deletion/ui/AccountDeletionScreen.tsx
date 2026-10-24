import type { MobileProvider } from "@baro/client-core";
import { AppleSignInButton } from "../../../ui/AppleSignInButton";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Choice } from "../../../ui/Choice";
import { Screen } from "../../../ui/Screen";
import { Text } from "../../../ui/Text";
import { TextField } from "../../../ui/TextField";
import type { AccountDeletionModel, AccountDeletionState } from "../model";

const labels: Record<MobileProvider, string> = {
  google: "Google",
  naver: "네이버",
  kakao: "카카오",
  apple: "Apple",
};
export function AccountDeletionScreen({
  state,
  actions,
  onSession,
  onLegacy,
}: {
  state: AccountDeletionState;
  actions: Pick<
    AccountDeletionModel,
    | "refresh"
    | "select"
    | "confirm"
    | "startDeletion"
    | "checkResult"
    | "cancelAttempt"
    | "clearAnonymous"
    | "acknowledge"
    | "openAppleHelp"
  >;
  onSession(): void;
  onLegacy(): void;
}) {
  const busy = state.busy !== null,
    proofBusy = busy && state.busy !== "authorizing";
  const canStart =
    state.gate === "ready" &&
    !busy &&
    !state.loading &&
    !state.storageError &&
    !state.hasOpenRequest &&
    state.history.length < 4 &&
    state.confirmation === "DELETE" &&
    state.provider !== null;
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        계정 삭제·요청 결과
      </Text>
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {state.storageError ? <Text accessibilityRole="alert">{state.storageError}</Text> : null}
      {state.busy === "authorizing" ? (
        <Card>
          <Text accessibilityLiveRegion="polite">계정 삭제를 위한 인증을 진행하고 있어요.</Text>
          <Text>
            브라우저에서 같은 계정으로 인증한 뒤 돌아와 주세요. 인증 창을 닫아도 삭제가 이미
            접수됐을 수 있어요. 아래 저장된 요청으로 결과를 확인해요.
          </Text>
        </Card>
      ) : null}
      {state.gate === "checking" ? (
        <Text accessibilityLiveRegion="polite">
          현재 계정과 사용할 수 있는 로그인 수단을 확인하고 있어요.
        </Text>
      ) : null}
      {state.gate === "login" ? (
        <Text>
          새 계정 삭제 요청은 로그인 후 진행할 수 있어요. 이 기기에 남아 있는 이전 요청의 결과는
          아래에서 확인할 수 있어요.
        </Text>
      ) : null}
      {state.gate === "legacy" ? (
        <Card>
          <Text>
            현재 서버는 이전 계정 삭제 방식을 사용해요. 사용량·설정에서 같은 계정 재인증과 DELETE
            확인을 진행해 주세요.
          </Text>
          <Button label="사용량·설정에서 삭제 진행" onPress={onLegacy} />
        </Card>
      ) : null}
      {state.gate === "ready" ? (
        <Card>
          <Text variant="heading" accessibilityRole="header">
            현재 계정 삭제
          </Text>
          {state.accountName ? <Text>{state.accountName}님의 계정</Text> : null}
          <Text>
            계정과 사건·업로드 자료의 삭제를 요청해요. 되돌릴 수 없으니 필요한 자료를 먼저 저장해
            주세요.
          </Text>
          <Text>
            DELETE를 입력하고 아래 인증을 마치면 삭제를 접수해요. 앱으로 돌아오기 전에 처리될 수
            있으며, 이미 접수된 삭제는 취소할 수 없어요.
          </Text>
          {state.hasOpenRequest ? (
            <Text accessibilityRole="alert">
              이 계정의 이전 삭제 요청을 먼저 확인해 주세요. 미확정 요청을 자동으로 다시 보내지
              않아요.
            </Text>
          ) : null}
          {!state.providers.length ? (
            <Text>
              연결되어 있고 현재 사용할 수 있는 로그인 수단을 확인하지 못했어요. 로그인 상태를 다시
              확인해 주세요.
            </Text>
          ) : null}
          {state.providers.map((provider) => (
            <Choice
              key={provider}
              kind="radio"
              label={`${labels[provider]} 계정으로 인증`}
              checked={state.provider === provider}
              disabled={busy || state.hasOpenRequest}
              onPress={() => actions.select(provider)}
            />
          ))}
          <TextField
            label="계정 삭제 확인 (DELETE)"
            value={state.confirmation}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            editable={!busy && !state.hasOpenRequest}
            onChangeText={actions.confirm}
          />
          {state.provider === "apple" ? (
            <AppleSignInButton
              kind="continue"
              disabled={!canStart}
              accessibilityHint="같은 Apple 계정으로 인증을 마치면 계정과 사건 자료의 삭제를 접수해요. 되돌릴 수 없어요."
              onPress={() => {
                void actions.startDeletion();
              }}
            />
          ) : (
            <Button
              variant="danger"
              label={
                state.provider
                  ? `${labels[state.provider]}로 인증하고 계정 삭제 요청`
                  : "로그인 수단을 선택해 주세요"
              }
              disabled={!canStart}
              accessibilityHint="같은 계정으로 인증을 마치면 삭제를 접수하는 되돌릴 수 없는 요청이에요."
              onPress={() => {
                void actions.startDeletion();
              }}
            />
          )}
        </Card>
      ) : null}
      {state.history.length ? (
        <Text variant="heading" accessibilityRole="header">
          이 기기의 저장된 요청
        </Text>
      ) : null}
      {state.history.map((record, index) => {
        const number = index + 1,
          accepted = record.state === "accepted";
        const mayForget =
          record.state === "cancelled" ||
          (accepted && record.localSaved && ["complete", "skipped"].includes(record.cleanup ?? ""));
        return (
          <Card key={record.attemptId}>
            <Text variant="heading" accessibilityRole="header">
              {number}번 요청 ·{" "}
              {record.relation === "current"
                ? "현재 계정"
                : record.relation === "previous"
                  ? "이전 계정"
                  : "기기에 남아 있는 요청"}
            </Text>
            <Text>
              {accepted
                ? "서버에서 계정 삭제 접수를 확인했어요."
                : record.state === "cancelled"
                  ? "서버에서 이 인증 시도의 취소를 확인했어요."
                  : "삭제 접수나 취소 결과를 아직 확인하지 못했어요."}
            </Text>
            {record.state === "pending" ? (
              <>
                <Text>
                  로그인 상태나 브라우저 취소만으로 결과를 확정하지 않아요. 확인 정보가 만료되면
                  결과를 확인하지 못할 수 있어요. 새 삭제 요청을 자동으로 보내지 않아요.
                </Text>
                <Button
                  label={`${number}번 요청 결과 다시 확인`}
                  disabled={proofBusy}
                  onPress={() => {
                    void actions.checkResult(record.attemptId);
                  }}
                />
                <Button
                  label={`${number}번 인증 시도 취소 확인`}
                  disabled={proofBusy}
                  accessibilityHint="서버에서 삭제가 먼저 접수됐다면 취소 대신 그 결과를 확인해요."
                  onPress={() => {
                    void actions.cancelAttempt(record.attemptId);
                  }}
                />
              </>
            ) : null}
            {accepted && !record.localSaved ? (
              <Text accessibilityRole="alert">
                삭제 접수 응답을 받았지만 기기에 결과를 저장하지 못했어요. 앱을 닫기 전에 결과를
                다시 확인해 주세요.
              </Text>
            ) : null}
            {accepted && record.cleanup === "complete" ? (
              <Text>이 요청의 기기 로그인 정보와 임시 자료 정리를 마쳤어요.</Text>
            ) : null}
            {accepted && record.cleanup === "skipped" ? (
              <Text>현재 다른 계정의 로그인 정보와 자료는 유지했어요.</Text>
            ) : null}
            {accepted && (record.cleanup === "failed" || record.cleanup === "pending") ? (
              <>
                <Text accessibilityRole="alert">
                  기기 정보 정리를 마치지 못했어요. 현재 로그인 상태를 확인하고 정리를 다시 확인해
                  주세요.
                </Text>
                <Button
                  label={`${number}번 기기 정리 다시 확인`}
                  disabled={busy}
                  onPress={() => {
                    void actions.checkResult(record.attemptId);
                  }}
                />
                {state.anonymous ? (
                  <Button
                    variant="danger"
                    label={`${number}번 삭제 후 기기 정보 직접 정리`}
                    disabled={busy}
                    accessibilityHint="현재 비로그인 상태에서 이 기기에 남은 로그인 정보와 임시 자료를 지워요. 저장된 미확정 작업 기록은 유지해요."
                    onPress={() => {
                      void actions.clearAnonymous(record.attemptId);
                    }}
                  />
                ) : null}
              </>
            ) : null}
            {accepted && record.appleRevocation === "confirmed" ? (
              <Text>Apple 연결 해제를 확인했어요.</Text>
            ) : null}
            {accepted && record.appleRevocation === "unconfirmed" ? (
              <>
                <Text>
                  삭제 접수와 별개로 Apple 연결 해제를 확인하지 못했어요. Apple 계정 관리에서 BARO의
                  상태를 확인할 수 있어요.
                </Text>
                <Button
                  label="Apple 공식 계정 관리 안내"
                  onPress={() => {
                    void actions.openAppleHelp();
                  }}
                />
              </>
            ) : null}
            {mayForget ? (
              <Button
                label={`${number}번 결과 확인 정보 기기에서 지우기`}
                disabled={busy}
                accessibilityHint="확인된 결과만 기기에서 지워요. 서버의 삭제 상태를 바꾸거나 새 요청을 보내지 않아요."
                onPress={() => {
                  void actions.acknowledge(record.attemptId);
                }}
              />
            ) : null}
          </Card>
        );
      })}
      <Button
        label="계정·기기 상태 다시 확인"
        disabled={busy || state.loading}
        onPress={() => {
          void actions.refresh();
        }}
      />
      <Button label="로그인·현재 계정 확인" onPress={onSession} />
    </Screen>
  );
}
