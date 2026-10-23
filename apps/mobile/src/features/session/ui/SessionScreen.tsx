import type { AccountType, Provider } from "@baro/client-core";
import { useState } from "react";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Choice } from "../../../ui/Choice";
import { Screen } from "../../../ui/Screen";
import { StatePanel } from "../../../ui/StatePanel";
import { Text } from "../../../ui/Text";
import type { SessionState } from "../model";

export type Policy = "terms" | "privacy" | "ai";
export function SessionScreen({
  state,
  onRole,
  onSignIn,
  onCancel,
  onRetry,
  onConsent,
  onSignOut,
  onBrowse,
  onPolicy,
  onReauthenticate,
  onReadReauthentication,
  onSettings,
  onProfile,
}: {
  state: SessionState;
  onRole: (role: AccountType) => void;
  onSignIn: (provider: Provider) => void;
  onCancel: () => void;
  onRetry: () => void;
  onConsent: (input: { policies: boolean; over14: boolean }) => void;
  onSignOut: () => void;
  onBrowse: () => void;
  onPolicy: (policy: Policy) => void;
  onReauthenticate?: (provider: Provider) => void;
  onReadReauthentication?: () => void;
  onSettings?: () => void;
  onProfile?: () => void;
}) {
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        {state.phase === "consent"
          ? "시작 전에 확인해 주세요"
          : state.phase === "ready"
            ? "내 계정"
            : "BARO 로그인"}
      </Text>
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {state.phase === "checking" || state.phase === "authorizing" ? (
        <>
          <StatePanel
            state={{
              kind: "loading",
              title:
                state.phase === "authorizing"
                  ? state.authPurpose === "reauthenticate"
                    ? "현재 계정을 다시 인증하고 있어요"
                    : "로그인을 확인하고 있어요"
                  : "이용 상태를 확인하고 있어요",
              description:
                state.phase === "authorizing"
                  ? "브라우저에서 로그인을 마친 뒤 앱으로 돌아와 주세요."
                  : "잠시만 기다려 주세요.",
            }}
          />
          {state.phase === "authorizing" ? (
            <Button
              label={state.authPurpose === "reauthenticate" ? "재인증 취소" : "로그인 취소"}
              onPress={onCancel}
            />
          ) : null}
        </>
      ) : null}
      {state.phase === "anonymous" || state.phase === "error" ? (
        <>
          {state.phase === "error" ? (
            <Button label="이용 상태 다시 확인" onPress={onRetry} />
          ) : null}
          <Text>이용 유형을 선택해 주세요.</Text>
          <Choice
            kind="radio"
            label="고객으로 이용"
            checked={state.role === "customer"}
            onPress={() => onRole("customer")}
          />
          <Choice
            kind="radio"
            label="변호사로 이용"
            checked={state.role === "lawyer"}
            onPress={() => onRole("lawyer")}
          />
          <Text variant="muted">이용 유형 선택은 변호사 자격 확인을 뜻하지 않아요.</Text>
          <Button label="Google로 로그인" onPress={() => onSignIn("google")} />
          <Button label="네이버로 로그인" onPress={() => onSignIn("naver")} />
          <Button label="카카오로 로그인" onPress={() => onSignIn("kakao")} />
        </>
      ) : null}
      {state.phase === "consent" && state.consent && state.session?.user ? (
        <ConsentChoices
          key={`${state.session.user.id}:${Object.values(state.consent.required).join(":")}`}
          busy={state.busy}
          onConsent={onConsent}
          onPolicy={onPolicy}
        />
      ) : null}
      {state.phase === "ready" && state.session?.user ? (
        <Card>
          <Text variant="heading">{state.session.user.name}님</Text>
          <Text>
            {state.session.user.accountType === "lawyer"
              ? "변호사로 이용 중이에요."
              : "고객으로 이용 중이에요."}
          </Text>
          <Text variant="muted">변호사 목록에서 프로필을 살펴보고 직접 연락할 수 있어요.</Text>
          <Button label="이용 상태 다시 확인" onPress={onRetry} />
        </Card>
      ) : null}
      {state.phase === "ready" || state.phase === "consent" ? (
        <>
          {onReauthenticate && state.session?.user ? (
            <Card>
              <Text variant="heading">현재 계정 다시 인증</Text>
              <Text>
                민감한 계정 작업 전에 같은 계정으로 다시 인증해 주세요. 취소해도 기존 로그인은
                유지돼요.
              </Text>
              {state.reauthentication?.checking ? (
                <Text accessibilityLiveRegion="polite">연결된 로그인 수단을 확인하고 있어요.</Text>
              ) : null}
              {state.reauthentication?.error ? (
                <Text accessibilityRole="alert">{state.reauthentication.error}</Text>
              ) : null}
              {state.reauthentication?.verified ? (
                <Text>이 계정의 최근 재인증을 확인했어요.</Text>
              ) : null}
              {state.reauthentication &&
              !state.reauthentication.checking &&
              !state.reauthentication.error &&
              !state.reauthentication.providers.length ? (
                <Text>연결된 로그인 수단이 없어요.</Text>
              ) : null}
              <Button
                label="재인증 로그인 수단 확인"
                disabled={state.busy || state.reauthentication?.checking === true}
                onPress={() => onReadReauthentication?.()}
              />
              {state.reauthentication?.providers.map((provider) => (
                <Button
                  key={provider}
                  label={`${{ google: "Google", naver: "네이버", kakao: "카카오" }[provider]}로 같은 계정 다시 인증`}
                  disabled={state.busy}
                  onPress={() => onReauthenticate(provider)}
                />
              ))}
            </Card>
          ) : null}
          <Button label="로그아웃" disabled={state.busy} onPress={onSignOut} />
        </>
      ) : null}
      <Button label="변호사 탐색" onPress={onBrowse} />
      {onSettings ? <Button label="사용량·설정" onPress={onSettings} /> : null}
      {onProfile && state.session?.user?.accountType === "lawyer" ? (
        <Button label="내 변호사 프로필 관리" onPress={onProfile} />
      ) : null}
    </Screen>
  );
}
function ConsentChoices({
  busy,
  onConsent,
  onPolicy,
}: {
  busy: boolean;
  onConsent: (input: { policies: boolean; over14: boolean }) => void;
  onPolicy: (policy: Policy) => void;
}) {
  const [policies, setPolicies] = useState(false),
    [over14, setOver14] = useState(false);
  return (
    <Card>
      <Text>이용약관, 개인정보 처리방침과 AI 이용 고지를 확인해 주세요.</Text>
      <Choice
        label="[필수] 서비스 정책에 동의합니다"
        checked={policies}
        disabled={busy}
        onPress={() => setPolicies(!policies)}
      />
      <Choice
        label="[필수] 만 14세 이상입니다"
        checked={over14}
        disabled={busy}
        onPress={() => setOver14(!over14)}
      />
      <Text variant="muted">생년월일은 수집하지 않아요.</Text>
      <Button label="이용약관 읽기" disabled={busy} onPress={() => onPolicy("terms")} />
      <Button label="개인정보 처리방침 읽기" disabled={busy} onPress={() => onPolicy("privacy")} />
      <Button label="AI 이용 고지 읽기" disabled={busy} onPress={() => onPolicy("ai")} />
      <Button
        variant="primary"
        label={busy ? "동의 저장 중" : "동의하고 계속하기"}
        disabled={busy || !policies || !over14}
        onPress={() => onConsent({ policies, over14 })}
      />
    </Card>
  );
}
