import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Screen } from "../../../ui/Screen";
import { StatePanel } from "../../../ui/StatePanel";
import { Text } from "../../../ui/Text";

export function GuideScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        상담 준비는 이렇게 진행돼요.
      </Text>
      <Card>
        <Text variant="heading">1. 있었던 일 정리</Text>
        <Text>기억나는 사실을 적고, 모르는 질문은 건너뛸 수 있어요.</Text>
        <Text variant="heading">2. 내용과 자료 확인</Text>
        <Text>요약을 직접 확인하고 필요한 사진과 문서를 함께 살펴봐요.</Text>
        <Text variant="heading">3. 직접 상담 준비</Text>
        <Text>확인한 내용을 리포트로 정리하고 선택한 변호사에게 직접 전달해요.</Text>
      </Card>
      <StatePanel
        state={{
          kind: "empty",
          title: "모바일 연결 준비 중",
          description:
            "아직 앱에서 로그인하거나 사건을 저장할 수 없어요. 서비스 연결 후 이용할 수 있어요.",
        }}
      />
      <Button label="처음으로" onPress={onBack} />
    </Screen>
  );
}
