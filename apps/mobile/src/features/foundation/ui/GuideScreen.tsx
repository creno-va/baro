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
          title: "지금 이용할 수 있는 기능",
          description:
            "로그인과 필수 동의, 사건 생성·질문·요약 확인, 작업공간 대화·타임라인·다음 행동과 변호사 탐색을 이용할 수 있어요. 자료 업로드·검토와 리포트 저장은 준비 중이에요.",
        }}
      />
      <Button label="처음으로" onPress={onBack} />
    </Screen>
  );
}
