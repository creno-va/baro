import { Image } from "react-native";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Screen } from "../../../ui/Screen";
import { StatePanel } from "../../../ui/StatePanel";
import { Text } from "../../../ui/Text";
import { fieldLabels, regionLabels } from "../labels";
import type { ProfileAction, PublicProfileState } from "../profile";

export function PublicProfileScreen({
  state,
  onRefresh,
  onBack,
  onOpen,
}: {
  state: PublicProfileState;
  onRefresh(): void;
  onBack(): void;
  onOpen(action: ProfileAction): void;
}) {
  const profile = state.profile,
    busy = state.opening;
  return (
    <Screen>
      <Button label="변호사 목록으로" onPress={onBack} />
      {!profile ? (
        <StatePanel
          state={
            state.phase === "error"
              ? {
                  kind: "error",
                  title: "프로필을 확인하지 못했어요",
                  description: state.error ?? "다시 확인해 주세요.",
                  retry: { label: "프로필 다시 확인", run: onRefresh },
                }
              : {
                  kind: "loading",
                  title: "공개 프로필을 확인하고 있어요",
                  description: "잠시 기다려 주세요.",
                }
          }
        />
      ) : (
        <>
          <Text variant="heading" accessibilityRole="header">
            {profile.name}
          </Text>
          <Text>
            {profile.verificationStatus === "verified"
              ? "자격 확인 프로필"
              : "본인 작성 프로필 · 자격 확인을 뜻하지 않아요"}
          </Text>
          <Text>{profile.officeName}</Text>
          <Text>
            {regionLabels[profile.region as keyof typeof regionLabels] ?? profile.region} ·{" "}
            {profile.practiceAreas
              .map((key) => fieldLabels[key as keyof typeof fieldLabels] ?? key)
              .join(" · ")}
          </Text>
          <Text>{profile.address}</Text>
          {profile.photoUrl?.startsWith("data:image/jpeg;base64,") ? (
            <Image
              source={{ uri: profile.photoUrl }}
              accessibilityLabel={`${profile.name} 프로필 사진`}
              style={{ width: 160, height: 160 }}
              resizeMode="contain"
            />
          ) : profile.photoUrl ? (
            <Button
              label="공개 프로필 사진 보기"
              disabled={busy}
              onPress={() => onOpen({ kind: "photo" })}
            />
          ) : null}
          <Text>{profile.introduction}</Text>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              직접 연락
            </Text>
            <Text variant="muted">
              연락 앱이나 외부 사이트가 열려요. 연락과 자료 전달은 사용자가 직접 진행하며 사건
              내용은 자동으로 보내지 않아요.
            </Text>
            {profile.phone ? (
              <>
                <Text>{profile.phone}</Text>
                <Button
                  label="전화 앱 열기"
                  disabled={busy}
                  onPress={() => onOpen({ kind: "phone" })}
                />
              </>
            ) : null}
            {profile.email ? (
              <>
                <Text>{profile.email}</Text>
                <Button
                  label="이메일 앱 열기"
                  disabled={busy}
                  onPress={() => onOpen({ kind: "email" })}
                />
              </>
            ) : null}
            {profile.website ? (
              <Button
                label="공개 연락 웹사이트 열기"
                disabled={busy}
                onPress={() => onOpen({ kind: "website" })}
              />
            ) : null}
          </Card>
          {profile.portfolio.length ? (
            <Text variant="heading" accessibilityRole="header">
              공개 포트폴리오
            </Text>
          ) : null}
          {profile.portfolio.map((item) => (
            <Card key={item.id}>
              <Text variant="heading" accessibilityRole="header">
                {item.title}
              </Text>
              {item.text ? <Text>{item.text}</Text> : null}
              {item.url ? (
                <Button
                  label={`${item.title} 공개 자료 열기`}
                  disabled={busy}
                  onPress={() => onOpen({ kind: "portfolio", id: item.id })}
                />
              ) : null}
            </Card>
          ))}
          {state.actionError ? <Text accessibilityRole="alert">{state.actionError}</Text> : null}
          <Button label="프로필 새로 확인" disabled={busy} onPress={onRefresh} />
        </>
      )}
    </Screen>
  );
}
