import { profileReady } from "@baro/contracts/v2/self-profile";
import { Image } from "react-native";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Choice } from "../../../ui/Choice";
import { Screen } from "../../../ui/Screen";
import { Text } from "../../../ui/Text";
import { TextField } from "../../../ui/TextField";
import { fieldLabels, regionLabels } from "../../directory/labels";
import { DirectoryFilter } from "../../directory/ui/Filter";
import {
  assetReferenced,
  type ProfileField,
  type ProfileModel,
  type ProfileState,
  profileDirty,
} from "../model";

const fields: { key: ProfileField; label: string; max: number; multiline?: boolean }[] = [
  { key: "name", label: "이름", max: 100 },
  { key: "introduction", label: "소개", max: 5000, multiline: true },
  { key: "officeName", label: "사무소 이름", max: 200 },
  { key: "address", label: "사무소 주소", max: 500 },
  { key: "phone", label: "전화번호", max: 30 },
  { key: "email", label: "이메일", max: 254 },
  { key: "website", label: "상담 웹 주소", max: 2000 },
];
export function ProfileScreen({
  state,
  actions,
  onSession,
  onPublic,
}: {
  state: ProfileState;
  actions: ProfileModel;
  onSession(): void;
  onPublic(id: string): void;
}) {
  const busy = !!state.busy,
    draft = state.draft,
    profile = state.profile;
  const editable = state.canWrite && !busy && !state.uncertain;
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        내 변호사 프로필
      </Text>
      {state.gate !== "ready" ? (
        <Card>
          <Text>
            {state.gate === "checking"
              ? "이용 상태를 확인하고 있어요."
              : state.gate === "role"
                ? "변호사 계정으로 이용해 주세요."
                : "로그인·이용 상태를 확인해 주세요."}
          </Text>
          <Button label="로그인·내 계정 확인" onPress={onSession} />
        </Card>
      ) : (
        <>
          {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
          {state.notice ? <Text accessibilityLiveRegion="polite">{state.notice}</Text> : null}
          {state.busy ? (
            <Text accessibilityLiveRegion="polite">
              {
                {
                  load: "프로필과 자료 상태 확인 중",
                  save: "프로필 저장 확인 중",
                  publish: "공개 상태 확인 중",
                  select: "기기에서 자료 선택 중",
                  upload: "자료 업로드 확인 중",
                  preview: "비공개 자료 준비 중",
                  present: "기기에서 자료 열기 중",
                  remove: "자료 삭제 확인 중",
                }[state.busy]
              }
            </Text>
          ) : null}
          {!state.canWrite ? (
            <Card>
              <Text>
                필수 동의를 갱신하면 프로필을 수정할 수 있어요. 기존 저장 내용과 처리 완료된 자료는
                확인할 수 있어요.
              </Text>
              <Button label="필수 동의 확인" onPress={onSession} />
            </Card>
          ) : null}
          {state.uncertain ? (
            <Card>
              <Text variant="heading">이전 요청의 저장 상태를 확인해 주세요</Text>
              <Text>
                서버에서 처리됐을 수 있어요. 자동으로 다시 보내지 않아요. 현재 상태를 읽거나, 같은
                내용과 기준으로 직접 다시 확인할 수 있어요.
              </Text>
              <Button
                label="이전 요청 직접 다시 확인"
                disabled={busy || !state.canWrite || state.conflict}
                onPress={() => {
                  void actions.retryUnconfirmed();
                }}
              />
            </Card>
          ) : null}
          {state.conflict ? (
            <Text accessibilityRole="alert">
              다른 화면에서 프로필이 바뀌었어요. 입력은 남겨 뒀어요. 최신 저장 내용을 확인한 뒤 다시
              작성해 주세요.
            </Text>
          ) : null}
          <Button
            label="현재 저장·자료 상태 새로 확인"
            disabled={busy}
            onPress={() => {
              void actions.refresh();
            }}
          />
          <Button
            label="입력을 버리고 최신 프로필 사용"
            disabled={busy}
            onPress={actions.requestReload}
          />
          {profile && draft ? (
            <>
              <Card>
                <Text variant="heading" accessibilityRole="header">
                  소개·사무소·연락처
                </Text>
                <Text>
                  {profile.published
                    ? "현재 저장된 프로필은 공개 중이에요."
                    : "현재 저장된 프로필은 비공개예요."}
                </Text>
                <Text variant="muted">
                  {profile.verificationStatus === "verified"
                    ? "서버에서 확인된 자격 상태예요."
                    : "본인이 작성한 프로필이에요. 역할 선택이나 공개는 변호사 자격 확인을 뜻하지 않아요."}
                </Text>
                {fields.map((field) => (
                  <TextField
                    key={field.key}
                    label={field.label}
                    value={draft[field.key]}
                    editable={editable}
                    maxLength={field.max}
                    multiline={field.multiline ?? false}
                    autoCapitalize={
                      field.key === "email" || field.key === "website" ? "none" : "sentences"
                    }
                    keyboardType={
                      field.key === "phone"
                        ? "phone-pad"
                        : field.key === "email"
                          ? "email-address"
                          : field.key === "website"
                            ? "url"
                            : "default"
                    }
                    onChangeText={(value) => actions.field(field.key, value)}
                  />
                ))}
                <DirectoryFilter
                  label="사무소 지역"
                  labels={regionLabels}
                  value={draft.region}
                  emptyLabel="선택 안 함"
                  disabled={!editable}
                  onChange={actions.region}
                />
                <Text variant="heading">주요 분야</Text>
                {Object.entries(fieldLabels).map(([key, label]) => (
                  <Choice
                    key={key}
                    label={label}
                    checked={draft.practiceAreas.includes(
                      key as (typeof draft.practiceAreas)[number],
                    )}
                    disabled={!editable}
                    onPress={() => actions.practice(key)}
                  />
                ))}
              </Card>
              <Card>
                <Text variant="heading" accessibilityRole="header">
                  프로필 사진
                </Text>
                {draft.photoUrl?.startsWith("data:image/jpeg;base64,") ? (
                  <Image
                    accessibilityLabel="기존 저장 사진"
                    source={{ uri: draft.photoUrl }}
                    style={{ width: 120, height: 120 }}
                    resizeMode="contain"
                  />
                ) : null}
                <Text>
                  {draft.photoUrl ? "선택된 프로필 사진이 있어요." : "선택된 프로필 사진이 없어요."}
                </Text>
                <Button
                  label="프로필 사진 파일 선택"
                  disabled={!editable}
                  onPress={() => {
                    void actions.select("profile_photo");
                  }}
                />
                <Button
                  label="프로필 사진 연결 해제"
                  disabled={!editable || !draft.photoUrl}
                  onPress={actions.removePhoto}
                />
                <Text variant="muted">
                  JPEG·PNG·WebP 100MB 이하. 업로드·처리 완료 후 아래 자료 목록에서 선택하고 프로필을
                  저장해 주세요.
                </Text>
              </Card>
              <Card>
                <Text variant="heading" accessibilityRole="header">
                  포트폴리오
                </Text>
                {draft.portfolio.map((item, index) => (
                  <Card key={item.id}>
                    <TextField
                      label={`소개 자료 ${index + 1} 제목`}
                      value={item.title}
                      editable={editable}
                      maxLength={300}
                      onChangeText={(value) => actions.portfolio(item.id, "title", value)}
                    />
                    <TextField
                      label={`소개 자료 ${index + 1} 본문`}
                      value={item.text ?? ""}
                      editable={editable}
                      maxLength={5000}
                      multiline
                      onChangeText={(value) => actions.portfolio(item.id, "text", value)}
                    />
                    {!item.assetId ? (
                      <TextField
                        label={`소개 자료 ${index + 1} 웹 주소`}
                        value={item.url ?? ""}
                        editable={editable}
                        keyboardType="url"
                        autoCapitalize="none"
                        onChangeText={(value) => actions.portfolio(item.id, "url", value)}
                      />
                    ) : (
                      <Text>업로드한 자료가 연결되어 있어요.</Text>
                    )}
                    <Button
                      label={`소개 자료 ${index + 1} 연결 해제`}
                      disabled={!editable}
                      onPress={() => actions.removePortfolio(item.id)}
                    />
                  </Card>
                ))}
                <Button
                  label="글·링크 소개 자료 추가"
                  disabled={!editable || draft.portfolio.length >= 30}
                  onPress={actions.addPortfolio}
                />
                <Button
                  label="포트폴리오 파일 선택"
                  disabled={!editable}
                  onPress={() => {
                    void actions.select("portfolio");
                  }}
                />
                <Text variant="muted">최대 30개. 파일은 JPEG·PNG·WebP·PDF 100MB 이하예요.</Text>
              </Card>
              {state.selected ? (
                <Card>
                  <Text>
                    {state.selected.name} · {Math.ceil(state.selected.size / 1_000_000)}MB
                  </Text>
                  <Button
                    label="선택한 자료 업로드·저장 상태 확인"
                    disabled={!editable}
                    onPress={() => {
                      void actions.upload();
                    }}
                  />
                  <Button label="파일 선택 취소" disabled={busy} onPress={actions.clearSelection} />
                </Card>
              ) : null}
              <Card>
                <Text variant="heading" accessibilityRole="header">
                  업로드 자료
                </Text>
                {!state.assets.length ? <Text>업로드 자료가 없어요.</Text> : null}
                {state.assets.map((asset, index) => {
                  const referenced =
                    assetReferenced(profile, asset.id) || assetReferenced(draft, asset.id);
                  const label = `${asset.purpose === "profile_photo" ? "프로필 사진" : "포트폴리오 자료"} ${index + 1}`;
                  return (
                    <Card key={asset.id}>
                      <Text>
                        {label} ·{" "}
                        {(
                          {
                            ready: "처리 완료",
                            reserved: "전송 준비",
                            uploaded: "처리 중",
                            queued: "처리 대기",
                            processing: "처리 중",
                            failed: "처리 실패",
                            deleting: "삭제 중",
                            waiting: "처리 대기",
                          } as Record<string, string>
                        )[asset.status] ?? "상태 확인 필요"}
                      </Text>
                      {referenced ? (
                        <Text>
                          프로필에 연결되어 있어요. 연결을 해제하고 저장한 뒤 자료를 삭제할 수
                          있어요.
                        </Text>
                      ) : null}
                      <Button
                        label={`${label} 프로필에 연결`}
                        disabled={!editable || asset.status !== "ready"}
                        onPress={() => actions.attach(asset.id)}
                      />
                      <Button
                        label={`${label} 비공개 미리보기 준비`}
                        disabled={busy || asset.status !== "ready"}
                        onPress={() => {
                          void actions.preview(asset.id);
                        }}
                      />
                      <Button
                        label={`${label} 삭제`}
                        disabled={!editable || referenced}
                        onPress={() => actions.requestRemove(asset.id)}
                      />
                    </Card>
                  );
                })}
                <Text variant="muted">
                  처리 중인 자료는 상태를 새로 확인해 주세요. 완료되기 전에는 프로필에 붙이거나
                  공개하지 않아요.
                </Text>
              </Card>
              {state.download ? (
                <Card>
                  <Text>이 계정의 처리 완료 자료를 준비했어요.</Text>
                  <Button
                    label="준비한 자료 열기"
                    disabled={busy}
                    onPress={() => {
                      void actions.present("open");
                    }}
                  />
                  <Button
                    label="준비한 자료 공유"
                    disabled={busy}
                    onPress={() => {
                      void actions.present("share");
                    }}
                  />
                  <Text variant="muted">
                    외부 앱에 전달한 복사본은 BARO에서 삭제해도 회수할 수 없어요.
                  </Text>
                </Card>
              ) : null}
              <Button
                label="프로필 저장"
                disabled={!editable || state.conflict || !profileDirty(state)}
                onPress={() => {
                  void actions.save();
                }}
              />
              <Button
                label={profile.published ? "프로필 공개 철회" : "프로필 공개 준비"}
                disabled={
                  !editable ||
                  profileDirty(state) ||
                  state.conflict ||
                  (!profile.published && !profileReady(profile))
                }
                onPress={() => actions.requestPublication(!profile.published)}
              />
              {profile.published ? (
                <Button
                  label="저장된 공개 프로필 보기"
                  disabled={busy}
                  onPress={() => onPublic(profile.id)}
                />
              ) : null}
            </>
          ) : null}
          {state.confirm ? (
            <Card>
              <Text variant="heading" accessibilityRole="header">
                {state.confirm.kind === "reload"
                  ? "현재 입력을 버릴까요?"
                  : state.confirm.kind === "remove"
                    ? "업로드 자료를 삭제할까요?"
                    : state.confirm.published
                      ? "프로필을 공개할까요?"
                      : "프로필 공개를 철회할까요?"}
              </Text>
              {state.confirm.kind === "reload" ? (
                <Text>
                  저장하지 않은 입력은 사라져요. 이전 요청은 이미 처리됐을 수 있으므로 서버의 현재
                  내용을 새로 읽어요.
                </Text>
              ) : state.confirm.kind === "remove" ? (
                <>
                  <Text>자료 삭제는 되돌릴 수 없어요. 원격 정리는 별도로 진행돼요.</Text>
                  <TextField
                    label="자료 삭제 확인 (DELETE)"
                    value={state.confirmation}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={6}
                    onChangeText={actions.confirmation}
                  />
                </>
              ) : state.confirm.published ? (
                <Choice
                  label="사진·소개·분야·사무소·연락처·포트폴리오를 비로그인 이용자에게 공개하는 데 동의합니다"
                  checked={state.publicationConsent}
                  onPress={() => actions.publicationConsent(!state.publicationConsent)}
                />
              ) : (
                <Text>
                  목록과 공개 프로필에서 조회할 수 없게 해요. 이미 외부로 전달된 복사본은 회수하지
                  못해요.
                </Text>
              )}
              <Button
                label="확인하고 진행"
                disabled={
                  busy ||
                  (state.confirm.kind === "remove" && state.confirmation !== "DELETE") ||
                  (state.confirm.kind === "publish" &&
                    state.confirm.published &&
                    !state.publicationConsent)
                }
                onPress={() => {
                  void actions.confirmAction();
                }}
              />
              <Button label="취소" disabled={busy} onPress={actions.cancelConfirm} />
            </Card>
          ) : null}
          {busy ? <Button label="현재 요청 확인 중단" onPress={actions.cancel} /> : null}
        </>
      )}
    </Screen>
  );
}
