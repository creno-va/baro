import { Brand } from "../../../ui/Brand";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Screen } from "../../../ui/Screen";
import { StatePanel } from "../../../ui/StatePanel";
import { Text } from "../../../ui/Text";
import type { FoundationModel } from "../model";

export function WelcomeScreen({
  model,
  onContinue,
  onBrowse,
  onSignIn,
  onCases,
}: {
  model: FoundationModel;
  onContinue: () => void;
  onBrowse?: () => void;
  onSignIn?: () => void;
  onCases?: () => void;
}) {
  return (
    <Screen>
      <Brand />
      <Text variant="title" accessibilityRole="header">
        내 상황을 차근차근 정리해요.
      </Text>
      <Text variant="muted">복잡한 일을 정리하고, 변호사와 이야기할 준비를 함께해요.</Text>
      {model.kind === "configuration-error" ? (
        <StatePanel
          state={{ kind: "error", title: "앱을 열 수 없어요", description: model.message }}
        />
      ) : (
        <>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              기억나는 내용부터
            </Text>
            <Text>{model.questionHint}</Text>
          </Card>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              자료와 흐름을 한곳에
            </Text>
            <Text>대화, 사진과 문서, 시간순 기록을 모아 상담을 준비할 수 있어요.</Text>
          </Card>
          <Text variant="muted">
            로그인과 필수 동의 후 사건을 저장하고 질문·요약을 이어 볼 수 있어요.
          </Text>
          <Button label="이용 안내 보기" onPress={onContinue} />
          {onBrowse ? <Button variant="primary" label="변호사 탐색" onPress={onBrowse} /> : null}
          {onSignIn ? <Button label="로그인·내 계정" onPress={onSignIn} /> : null}
          {onCases ? <Button label="내 사건 정리" onPress={onCases} /> : null}
        </>
      )}
      <Text variant="muted">
        BARO는 변호사나 법률사무소가 아니며, 법률 판단과 사건 수임을 대신하지 않아요.
      </Text>
    </Screen>
  );
}
