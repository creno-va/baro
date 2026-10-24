import { memo, useEffect, useState } from "react";
import { TextField } from "../../../ui/TextField";

/** Keep per-key draft updates inside the editor, outside the list/filter header. */
export const DirectoryQueryField = memo(function DirectoryQueryField({
  value,
  committedFilterKey,
  onDraftChange,
  onSubmit,
}: {
  value: string;
  committedFilterKey: string;
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Reset even when a committed filter changes while the committed query stays equal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: committed filters also reset the unsent draft.
  useEffect(() => {
    setDraft(value);
  }, [value, committedFilterKey]);
  return (
    <TextField
      label="이름으로 검색"
      value={draft}
      onChangeText={(text) => {
        onDraftChange(text);
        setDraft(text);
      }}
      maxLength={100}
      returnKeyType="search"
      onSubmitEditing={({ nativeEvent }) => {
        onDraftChange(nativeEvent.text);
        setDraft(nativeEvent.text);
        onSubmit(nativeEvent.text);
      }}
      autoCorrect={false}
    />
  );
});
