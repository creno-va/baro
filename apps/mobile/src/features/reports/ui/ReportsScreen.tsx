import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Choice } from "../../../ui/Choice";
import { Screen } from "../../../ui/Screen";
import { Text } from "../../../ui/Text";
import { TextField } from "../../../ui/TextField";
import { type ReportsModel, type ReportsState, reportDirty, reportDownloadAllowed } from "../model";

export function ReportsScreen({
  state,
  actions,
  onSession,
  onWorkspace,
  onFiles,
}: {
  state: ReportsState;
  actions: ReportsModel;
  onSession(): void;
  onWorkspace(): void;
  onFiles(): void;
}) {
  if (state.gate !== "ready")
    return (
      <Screen>
        <Text variant="title">상담 준비 리포트</Text>
        <Text>
          {state.gate === "checking"
            ? "이용 상태를 확인하고 있어요."
            : state.gate === "role"
              ? "고객 계정으로 사건 리포트를 확인할 수 있어요."
              : "로그인·이용 상태를 확인해 주세요."}
        </Text>
        <Button label="로그인·이용 상태 확인" onPress={onSession} />
      </Screen>
    );
  const report = state.report,
    draft = state.draft,
    busy = Boolean(state.busy),
    dirty = reportDirty(state);
  const editable = state.canWrite && !report?.stale && !state.conflict && !busy;
  return (
    <Screen>
      <Text variant="title" accessibilityRole="header">
        상담 준비 리포트
      </Text>
      <Text>
        AI가 정리한 상담 준비 자료예요. 법률 판단·원본의 진정성·법적 효력을 보장하지 않아요. 내용과
        출처를 확인하고 전달할 상대는 직접 선택해 주세요.
      </Text>
      <Text variant="muted">
        화면을 나가거나 앱을 종료하면 미저장 편집과 선택이 사라질 수 있어요. 잠시 다른 앱을 다녀오면
        계정·권한·저장 상태를 확인한 뒤 현재 화면의 편집을 복원합니다.
      </Text>
      {!state.canWrite ? (
        <Card>
          <Text>
            최신 동의 후 새 초안·검토 저장·새 다운로드를 준비할 수 있어요. 저장된 HTML·PDF·ZIP은
            서버에서 접근 가능한 범위로 계속 확인할 수 있어요.
          </Text>
          <Button label="최신 동의 확인" onPress={onSession} />
        </Card>
      ) : null}
      {state.error ? <Text accessibilityRole="alert">{state.error}</Text> : null}
      {state.notice ? <Text accessibilityLiveRegion="polite">{state.notice}</Text> : null}
      {busy ? (
        <Text accessibilityLiveRegion="polite">
          {state.busy === "save"
            ? "검토 내용을 저장하고 있어요."
            : state.busy === "generate"
              ? "새 초안을 준비하고 있어요."
              : state.busy === "load"
                ? "저장 상태를 확인하고 있어요."
                : "파일을 준비하거나 열고 있어요."}
        </Text>
      ) : null}
      <Button
        label="리포트 저장 상태 다시 불러오기"
        disabled={busy}
        onPress={() => {
          void actions.refresh();
        }}
      />
      {state.confirm === "reload" ? (
        <Card>
          <Text variant="heading">저장 내용을 다시 불러올까요?</Text>
          <Text>
            저장하지 않은 본문·사진·마스킹·자료 제외 선택은 사라져요. 현재 편집을 보관하려면 취소해
            주세요.
          </Text>
          <Button label="편집 유지" disabled={busy} onPress={actions.cancelConfirm} />
          <Button
            label="편집을 버리고 저장 내용 불러오기"
            disabled={busy}
            onPress={() => {
              void actions.confirmReload();
            }}
          />
        </Card>
      ) : null}
      {state.initialLimit && !report ? (
        <Card>
          <Text variant="heading">첫 리포트에 포함할 자료 확인</Text>
          <Text>
            기존 처리 한도 안에서 첫 초안을 만들 수 있도록 제외할 자료를 직접 선택해 주세요. 자료
            원본을 삭제하지는 않습니다. 다른 요청이 이미 리포트를 만들었다면 저장 상태를 다시 확인해
            주세요.
          </Text>
          {state.files.map((file) => (
            <Choice
              key={file.id}
              label={`${file.name} 첫 초안에서 제외`}
              checked={state.initialExcluded.includes(file.id)}
              disabled={busy || !state.canWrite}
              onPress={() => actions.excludeInitial(file.id)}
            />
          ))}
          <Button
            label="선택한 자료를 제외하고 첫 초안 생성"
            disabled={busy || !state.canWrite || !state.initialExcluded.length}
            onPress={() => {
              void actions.generateInitial();
            }}
          />
        </Card>
      ) : null}
      {report && draft ? (
        <>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {report.title}
            </Text>
            <Text>
              검토 버전 {report.revision} · {new Date(report.updatedAt).toLocaleString("ko-KR")}
            </Text>
            {report.basis ? (
              <Text>
                사건 버전 {report.basis.workspaceRevision} · 확인 요약 버전{" "}
                {report.basis.summaryRevision} 기준
              </Text>
            ) : (
              <Text>이전 저장 리포트예요. 기준 정보는 새 초안에서 확인할 수 있어요.</Text>
            )}
            {report.stale ? (
              <Text>
                리포트 작성 뒤 사건이나 자료가 바뀌었어요. 기존 저장 내용을 확인하거나 최신 사건으로
                새 초안을 만들어 주세요.
              </Text>
            ) : null}
            {state.conflict ? (
              <Text>
                저장 버전이 바뀌었어요. 현재 입력은 보존했어요. 내용을 확인한 뒤 저장 상태를 다시
                불러와 주세요.
              </Text>
            ) : null}
            <Text>출처·자료 처리 범위·확인하지 못한 항목을 본문과 함께 검토해 주세요.</Text>
            <TextField
              label="리포트 본문"
              value={draft.content}
              multiline
              maxLength={30000}
              editable={editable}
              autoCorrect={false}
              autoCapitalize="none"
              onChangeText={(content) => actions.change({ content })}
            />
            <Text>{draft.content.length.toLocaleString()} / 30,000자</Text>
          </Card>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              식별정보와 근거 사진
            </Text>
            <Choice
              label="식별정보 자동 가림"
              checked={draft.maskIdentifiers}
              disabled={!editable}
              onPress={() => actions.change({ maskIdentifiers: !draft.maskIdentifiers })}
            />
            <Text>
              자동 가림은 모든 개인정보를 찾아내지 못할 수 있어요. 가림을 켜면 선택을 보존하면서
              근거 사진 전체를 출력에서 제외합니다. 가림을 꺼서 사진을 넣을 때는 사진 속 식별정보도
              직접 확인해 주세요.
            </Text>
            <Text>
              출력 근거 사진 {draft.maskIdentifiers ? 0 : (draft.includedPhotoIds?.length ?? 0)}개 ·
              최대 12개. 실제 크기·처리 한도는 서버에서 확인합니다.
            </Text>
            {(report.photoCandidates ?? []).map((photo) => (
              <Card key={photo.id}>
                <Text>
                  {photo.name} · 자료 버전 {photo.revision}
                </Text>
                <Button
                  label={`${photo.name} 사진 원본 열어 확인`}
                  disabled={busy}
                  onPress={() => {
                    void actions.openPhoto(photo.id);
                  }}
                />
                <Choice
                  label={`${photo.name} 리포트 사진으로 포함`}
                  checked={draft.includedPhotoIds?.includes(photo.id) ?? false}
                  disabled={
                    !editable ||
                    draft.maskIdentifiers ||
                    draft.excludedFileIds.includes(photo.id) ||
                    (!draft.includedPhotoIds?.includes(photo.id) &&
                      (draft.includedPhotoIds?.length ?? 0) >= 12)
                  }
                  onPress={() => actions.photo(photo.id)}
                />
              </Card>
            ))}
            {!report.photoCandidates?.length ? (
              <Text>
                현재 버전에 포함할 수 있는 사진이 없어요. 자료 처리와 최신 버전을 확인해 주세요.
              </Text>
            ) : null}
          </Card>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              리포트 자료 제외
            </Text>
            <Text>
              자료 제외를 저장하면 본문이 출처 기준으로 다시 구성됩니다. 본문 편집과 제외를 함께
              바꿨다면 본문을 먼저 저장한 뒤 제외를 다시 저장해 주세요. 이전 검토 버전은 서버에
              보존돼요.
            </Text>
            {state.files.map((file) => (
              <Choice
                key={file.id}
                label={`${file.name} 리포트에서 제외`}
                checked={draft.excludedFileIds.includes(file.id)}
                disabled={!editable}
                onPress={() => actions.exclude(file.id)}
              />
            ))}
            <Button
              label={
                state.exportExhausted && !dirty
                  ? "검토 내용을 보존하고 새 버전 저장"
                  : "검토 내용 저장"
              }
              disabled={!editable || (!dirty && !state.exportExhausted) || !draft.content.trim()}
              onPress={() => {
                void actions.save();
              }}
            />
            <Button
              label="최신 사건으로 새 초안 만들기"
              disabled={busy || !state.canWrite}
              onPress={actions.askGenerate}
            />
          </Card>
          {state.confirm === "generate" ? (
            <Card>
              <Text variant="heading">새 초안을 만들까요?</Text>
              <Text>
                최신 사건과 자료로 구성하고 현재 제외 선택을 적용해요. 마스킹과 사진 선택을 다시
                확인해야 해요. 저장하지 않은 편집은 새 초안으로 교체됩니다.
              </Text>
              <Button label="현재 편집 유지" disabled={busy} onPress={actions.cancelConfirm} />
              <Button
                label="새 초안 생성 확인"
                disabled={busy || !state.canWrite}
                onPress={() => {
                  void actions.generate();
                }}
              />
            </Card>
          ) : null}
          <Card>
            <Text variant="heading" accessibilityRole="header">
              검토한 내용 저장·전달
            </Text>
            <Text>
              {dirty
                ? "저장하지 않은 변경이 있어요. 먼저 검토 내용을 저장해 주세요."
                : "표시된 저장 버전을 확인한 뒤 파일로 저장할 수 있어요."}
            </Text>
            <Choice
              label="본문·출처·식별정보·선택한 사진을 확인했어요"
              checked={state.reviewed}
              disabled={busy || dirty}
              onPress={() => actions.reviewed(!state.reviewed)}
            />
            <Button
              label="PDF를 기기에 저장"
              disabled={!reportDownloadAllowed(state, "pdf")}
              onPress={() => {
                void actions.download("pdf");
              }}
            />
            <Button
              label="저장된 HTML을 기기에 저장"
              disabled={!reportDownloadAllowed(state, "html")}
              onPress={() => {
                void actions.download("html");
              }}
            />
            <Text>HTML은 저장된 검토 내용이에요. 열거나 공유할 앱은 직접 선택해 주세요.</Text>
            <Text variant="heading">선택 원본 ZIP</Text>
            <Text>
              자동 가림과 리포트 제외는 원본 파일의 내용을 가리지 않습니다. 원본에는 개인정보가
              그대로 포함될 수 있어요. 필요한 자료만 직접 선택해 주세요.
            </Text>
            {state.files
              .filter(
                (file) => file.status === "ready" && !report.excludedFileIds.includes(file.id),
              )
              .map((file) => (
                <Choice
                  key={file.id}
                  label={`${file.name} 원본 ZIP에 포함`}
                  checked={state.originals.includes(file.id)}
                  disabled={busy || !state.canWrite || report.stale}
                  onPress={() => actions.originalSelection(file.id)}
                />
              ))}
            <Choice
              label="선택한 원본은 가림 없이 전달됨을 확인했어요"
              checked={state.originalsAcknowledged}
              disabled={busy || !state.canWrite || report.stale}
              onPress={() => actions.acknowledgeOriginals(!state.originalsAcknowledged)}
            />
            <Button
              label="선택 원본 ZIP을 기기에 저장"
              disabled={!reportDownloadAllowed(state, "zip")}
              onPress={() => {
                void actions.download("zip");
              }}
            />
            {report.savedZip ? (
              <>
                <Text>
                  서버 보관 ZIP · 원본 {report.savedZip.fileCount}개 ·{" "}
                  {new Date(report.savedZip.createdAt).toLocaleString("ko-KR")}
                </Text>
                <Button
                  label="보관된 ZIP을 기기에 저장"
                  disabled={!reportDownloadAllowed(state, "savedZip")}
                  onPress={() => {
                    void actions.download("savedZip");
                  }}
                />
              </>
            ) : null}
          </Card>
        </>
      ) : !busy && !state.initialLimit ? (
        <Text>
          리포트를 불러오지 못했다면 사건의 요약 확인·자료 처리·이용 상태를 확인해 주세요.
        </Text>
      ) : null}
      {state.download ? (
        <Card>
          <Text variant="heading">{state.download.label}</Text>
          <Text>
            {state.download.value.size.toLocaleString()} bytes · {state.download.mimeType}
          </Text>
          <Button
            label="저장한 파일 열기"
            disabled={busy}
            onPress={() => {
              void actions.present("open");
            }}
          />
          <Button
            label="저장한 파일 공유·다른 앱에 저장"
            disabled={busy}
            onPress={() => {
              void actions.present("share");
            }}
          />
          <Text>외부 앱으로 전달한 복사본은 BARO에서 회수하거나 삭제할 수 없어요.</Text>
        </Card>
      ) : null}
      {busy || state.download ? (
        <Button label="기기 요청 중단·임시 파일 정리" onPress={actions.cancel} />
      ) : null}
      <Button label="사건 자료로 이동" onPress={onFiles} />
      <Button label="사건 작업공간으로 이동" onPress={onWorkspace} />
    </Screen>
  );
}
