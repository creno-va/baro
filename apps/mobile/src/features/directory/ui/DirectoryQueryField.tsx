import { memo } from "react";
import { TextField } from "../../../ui/TextField";

/** Native owns edits; only a newly committed query/filter resets the editor. */
export const DirectoryQueryField = memo(function DirectoryQueryField({
  committedQuery,
  committedFilterKey,
  onDraftChange,
  onSubmit,
}: {
  committedQuery: string;
  committedFilterKey: string;
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  return (
    <TextField
      key={JSON.stringify([committedQuery, committedFilterKey])}
      label="이름으로 검색"
      defaultValue={committedQuery}
      onChangeText={onDraftChange}
      maxLength={100}
      returnKeyType="search"
      onSubmitEditing={({ nativeEvent }) => {
        onDraftChange(nativeEvent.text);
        onSubmit(nativeEvent.text);
      }}
      autoCorrect={false}
    />
  );
});
