import type { Provider } from "@baro/client-core";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Screen } from "../../../ui/Screen";
import { Text } from "../../../ui/Text";
import { TextField } from "../../../ui/TextField";
import type { SettingsModel, SettingsState } from "../model";

const providerLabel: Record<Provider, string> = {
  google: "Google",
  naver: "네이버",
  kakao: "카카오",
};
export function SettingsScreen({
  state,
  actions,
  onSession,
}: {
  state: SettingsState;
  actions: Pick<
    SettingsModel,
    "refresh" | "confirm" | "deleteAccount" | "retryUnconfirmed" | "reauthenticate" | "openPolicy"
  >;
  onSession(): void;
}) {
  const accepted = state.notice === "accepted" || state.notice === "cleanup-failed";
  const busy = state.action !== null || state.deletionBusy;
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        사용량·설정
      </Text>
      {state.notice === "unconfirmed" && state.gate !== "ready" ? (
        <Text accessibilityRole="alert">
          이전 계정 삭제 요청의 결과가 불확실해요. 로그인 상태만으로 삭제 성공을 판단하지 않아요.
          같은 계정의 상태를 확인해 주세요.
        </Text>
      ) : null}
      {accepted ? (
        <Card>
          <Text variant="heading" accessibilityRole="header">
            계정 삭제를 접수했어요
          </Text>
          <Text>서버에서 삭제 접수를 확인했어요. 새 삭제 요청을 보내지 않아요.</Text>
          {state.action === "delete" ? (
            <Text accessibilityLiveRegion="polite">
              이 기기의 로그인 정보와 임시 자료를 정리하고 있어요.
            </Text>
          ) : null}
          {state.notice === "cleanup-failed" ? (
            <Text accessibilityRole="alert">
              기기의 로그인 정보 또는 임시 자료를 모두 정리하지 못했어요. 계정 화면에서 로그아웃
              상태를 확인하고 앱을 다시 열어 주세요.
            </Text>
          ) : null}
          <Button
            label="로그인·기기 저장 상태 확인"
            disabled={state.action !== null}
            onPress={onSession}
          />
        </Card>
      ) : state.gate !== "ready" ? (
        <Card>
          <Text>
            {state.gate === "checking"
              ? "이용 상태를 확인하고 있어요."
              : state.gate === "login"
                ? "로그인 후 내 사용량과 계정 설정을 확인할 수 있어요."
                : "이용 상태를 확인하지 못했어요."}
          </Text>
          <Button label="로그인·내 계정 확인" onPress={onSession} />
        </Card>
      ) : (
        <>
          {state.profile ? (
            <Card>
              <Text variant="heading">{state.profile.name}님</Text>
              <Text>{state.profile.role === "lawyer" ? "변호사" : "고객"} 계정</Text>
            </Card>
          ) : null}
          <Card>
            <Text variant="heading" accessibilityRole="header">
              내 사용량
            </Text>
            {state.needsConsent ? (
              <>
                <Text>
                  사용량 조회 전에 현재 필수 동의를 확인해 주세요. 계정 삭제와 정책 확인은 계속할 수
                  있어요.
                </Text>
                <Button label="필수 동의 확인" onPress={onSession} />
              </>
            ) : null}
            {state.usageBusy ? (
              <Text accessibilityLiveRegion="polite">서버 사용량을 확인하고 있어요.</Text>
            ) : null}
            {state.usageError ? <Text accessibilityRole="alert">{state.usageError}</Text> : null}
            {state.usage ? (
              <>
                <Text>
                  새 사건: {state.usage.newCases.used} / {state.usage.newCases.limit}건
                </Text>
                <Text>
                  AI 응답: {state.usage.aiResponses.used} / {state.usage.aiResponses.limit}회
                </Text>
                <Text>
                  음성·영상 처리: {quantity(state.usage.mediaMinutes.used)} /{" "}
                  {quantity(state.usage.mediaMinutes.limit)}분
                </Text>
                <Text>
                  저장 공간: {bytes(state.usage.storageBytes.used)} /{" "}
                  {bytes(state.usage.storageBytes.limit)}
                </Text>
                <Text variant="muted">
                  진행 중인 작업의 예약 사용량을 포함해요. 저장 공간은 일일 초기화 대상이 아니에요.
                </Text>
                {state.usage.resetAt ? (
                  <Text>일일 사용량 초기화: {kst(state.usage.resetAt)} (한국 시간)</Text>
                ) : null}
                <Text variant="muted">
                  사용량은 조회 시점 기준이에요. 실제 실행 가능 여부는 요청할 때 서버에서 확인해요.
                </Text>
              </>
            ) : null}
          </Card>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              계정 삭제
            </Text>
            <Text>
              계정과 사건, 업로드 자료의 삭제를 요청해요. 되돌릴 수 없으니 필요한 자료를 먼저 저장해
              주세요.
            </Text>
            {state.notice === "unconfirmed" ? (
              <Text accessibilityRole="alert">
                이전 삭제 요청의 결과를 확인하지 못했어요. 이미 처리됐을 수도 있어요. 자동으로 다시
                보내지 않아요. 같은 계정으로 새로 재인증한 뒤 현재 상태를 확인하고, 직접 다시 확인을
                선택해 주세요.
              </Text>
            ) : null}
            {state.deletionBusy ? (
              <Text accessibilityLiveRegion="polite">
                연결된 로그인 수단과 이전 요청을 확인하고 있어요.
              </Text>
            ) : null}
            {state.deletion ? (
              <>
                <Text>
                  {state.deletion.canDelete
                    ? "같은 계정의 최근 재인증을 확인했어요. 삭제 요청 시 다시 검증해요."
                    : "삭제할 계정으로 다시 인증해 주세요."}
                </Text>
                {!state.deletion.providers.length ? (
                  <Text>
                    연결된 로그인 수단을 확인하지 못했어요. 내 계정에서 로그인 상태를 확인해 주세요.
                  </Text>
                ) : null}
                {state.deletion.providers.map((provider) => (
                  <Button
                    key={provider}
                    label={`${providerLabel[provider]}로 같은 계정 다시 인증`}
                    disabled={busy}
                    onPress={() => {
                      void actions.reauthenticate(provider);
                    }}
                  />
                ))}
                <TextField
                  label="계정 삭제 확인 (DELETE)"
                  value={state.confirmation}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={6}
                  editable={!busy}
                  onChangeText={actions.confirm}
                />
                {state.deletionState === "unconfirmed" ? (
                  <Button
                    label="미확정 삭제 요청 직접 다시 확인"
                    disabled={busy || !state.deletion.canDelete || state.confirmation !== "DELETE"}
                    accessibilityHint="새 재인증이 필요하며 이전 요청이 이미 처리됐을 수도 있어요."
                    onPress={() => {
                      void actions.retryUnconfirmed();
                    }}
                  />
                ) : (
                  <Button
                    label="내 계정 삭제 요청"
                    disabled={
                      busy ||
                      state.deletionState !== "none" ||
                      !state.deletion.canDelete ||
                      state.confirmation !== "DELETE"
                    }
                    accessibilityHint="계정과 사건 자료를 삭제하는 되돌릴 수 없는 요청이에요."
                    onPress={() => {
                      void actions.deleteAccount();
                    }}
                  />
                )}
              </>
            ) : null}
            {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
          </Card>
          <Button
            label="사용량·삭제 준비 상태 새로 확인"
            disabled={busy || state.usageBusy}
            onPress={() => {
              void actions.refresh();
            }}
          />
        </>
      )}
      <Card>
        <Text variant="heading" accessibilityRole="header">
          서비스 정책
        </Text>
        {state.policyError ? <Text accessibilityRole="alert">{state.policyError}</Text> : null}
        <Button
          label="이용약관 읽기"
          onPress={() => {
            void actions.openPolicy("terms");
          }}
        />
        <Button
          label="개인정보 처리방침 읽기"
          onPress={() => {
            void actions.openPolicy("privacy");
          }}
        />
        <Button
          label="AI 이용 고지 읽기"
          onPress={() => {
            void actions.openPolicy("ai");
          }}
        />
        <Text variant="muted">BARO는 법률 판단과 사건 수임을 대신하지 않아요.</Text>
      </Card>
    </Screen>
  );
}
function quantity(value: number) {
  return Number(value.toFixed(2));
}
function bytes(value: number) {
  return `${quantity(value / 1_000_000)} MB`;
}
function kst(value: string) {
  const date = new Date(Date.parse(value) + 9 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
}
