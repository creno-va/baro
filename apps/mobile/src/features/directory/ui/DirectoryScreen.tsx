import { useState } from "react";
import { FlatList, View } from "react-native";
import { tokens } from "../../../theme/tokens";
import { Button } from "../../../ui/Button";
import { Card } from "../../../ui/Card";
import { Screen } from "../../../ui/Screen";
import { StatePanel } from "../../../ui/StatePanel";
import { Text } from "../../../ui/Text";
import { TextField } from "../../../ui/TextField";
import type { DirectoryState } from "../model";

export interface DirectoryScreenProps {
  state: DirectoryState;
  onSearch: (query: string) => void;
  onMore: () => void;
  onRetry: () => void;
  onRefresh: () => void;
}
export function DirectoryScreen({
  state,
  onSearch,
  onMore,
  onRetry,
  onRefresh,
}: DirectoryScreenProps) {
  const [query, setQuery] = useState(state.query);
  const loading = state.phase === "loading";
  return (
    <Screen scroll={false}>
      <Text variant="heading" accessibilityRole="header">
        변호사 탐색
      </Text>
      <Text variant="muted">공개 프로필을 살펴보고 상담을 준비해 보세요.</Text>
      <TextField
        label="이름으로 검색"
        value={query}
        onChangeText={setQuery}
        maxLength={100}
        returnKeyType="search"
        onSubmitEditing={() => onSearch(query)}
        autoCorrect={false}
      />
      <Button label="검색" onPress={() => onSearch(query)} />
      {state.error ? (
        <StatePanel
          state={{
            kind: "error",
            title: "목록을 불러오지 못했어요",
            description: state.error,
            retry: { label: "다시 시도", run: onRetry },
          }}
        />
      ) : null}
      <FlatList
        style={{ flex: 1 }}
        data={state.items}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: tokens.space.control, paddingBottom: tokens.space.page }}
        refreshing={loading && !state.loadingMore}
        onRefresh={onRefresh}
        renderItem={({ item }) => (
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {item.name}
            </Text>
            <Text>{item.officeName}</Text>
            <Text variant="muted">{item.introduction}</Text>
            <Text variant="muted">
              {item.verificationStatus === "verified" ? "자격 확인 프로필" : "본인 작성 프로필"}
            </Text>
          </Card>
        )}
        ListEmptyComponent={
          !state.error ? (
            <StatePanel
              state={
                loading || state.phase === "idle"
                  ? {
                      kind: "loading",
                      title: "공개 프로필을 확인하고 있어요",
                      description: "잠시 기다려 주세요.",
                    }
                  : {
                      kind: "empty",
                      title: state.query ? "검색 결과가 없어요" : "공개된 프로필을 준비하고 있어요",
                      description: state.query
                        ? "다른 이름으로 검색하거나 검색어를 지워 주세요."
                        : "공개된 변호사 프로필이 생기면 이곳에서 확인할 수 있어요.",
                    }
              }
            />
          ) : undefined
        }
        ListFooterComponent={
          state.nextCursor && !state.error ? (
            <View style={{ paddingTop: tokens.space.control }}>
              <Button
                label={state.loadingMore ? "더 불러오는 중" : "더 보기"}
                onPress={onMore}
                disabled={loading}
              />
            </View>
          ) : undefined
        }
      />
    </Screen>
  );
}
