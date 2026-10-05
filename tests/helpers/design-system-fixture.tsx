import { useState } from "react";
import { AppNavigation, type NavigationRole } from "../../src/components/ui/app-navigation";
import { Badge, Separator, Skeleton } from "../../src/components/ui/badge";
import { Button } from "../../src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../src/components/ui/card";
import { Dialog } from "../../src/components/ui/dialog";
import { FieldDescription, Input, Label, Textarea } from "../../src/components/ui/form";
import { PageHeader } from "../../src/components/ui/page-header";
import { StatePanel, type StateVariant } from "../../src/components/ui/state-panel";
import { Tabs } from "../../src/components/ui/tabs";

const states: Array<{ variant: StateVariant; title: string; description: string }> = [
  {
    variant: "loading",
    title: "자료를 확인하고 있어요",
    description: "진행률을 확인할 수 없으면 단계만 안내해요.",
  },
  {
    variant: "empty",
    title: "아직 정리한 자료가 없어요",
    description: "합성 구성 요소 예시입니다.",
  },
  {
    variant: "error",
    title: "잠시 연결이 끊겼어요",
    description: "입력한 내용은 그대로 두고 다시 시도할 수 있어요.",
  },
  {
    variant: "limit",
    title: "사용 한도에 도달했어요",
    description: "다음 이용 가능 시점은 서버가 알려주는 경우에만 표시해요.",
  },
  {
    variant: "permission",
    title: "이 화면을 열 권한이 없어요",
    description: "다른 계정의 사건 내용은 표시하지 않아요.",
  },
  {
    variant: "pending",
    title: "공개 심사를 기다리고 있어요",
    description: "심사가 완료되기 전에는 공개 완료로 표시하지 않아요.",
  },
];
export function DesignSystemFixture() {
  const [role, setRole] = useState<NavigationRole>("user");
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const [nestedMounted, setNestedMounted] = useState(true);
  const [disableSelected, setDisableSelected] = useState(false);
  return (
    <>
      <AppNavigation
        role={role}
        pathname="/settings"
        availableRoutes={["/", "/cases", "/settings"]}
      />
      <main id="main-content" tabIndex={-1} className="ui-showcase">
        <PageHeader
          title="공유 UI 구성 요소"
          eyebrow="테스트 전용 · 합성 예시"
          description="역할 선택은 메뉴 구성을 살펴보는 예시이며 로그인이나 권한을 부여하지 않습니다."
        />
        <Card>
          <CardHeader>
            <CardTitle>역할별 메뉴</CardTitle>
            <CardDescription>현재 구현되지 않은 경로는 메뉴에 표시하지 않아요.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="fixture-role">메뉴 예시 역할</Label>
            <select
              id="fixture-role"
              className="ui-input"
              value={role}
              onChange={(event) => setRole(event.target.value as NavigationRole)}
            >
              <option value="user">사용자</option>
              <option value="lawyer">변호사</option>
              <option value="moderator">운영 검토자</option>
              <option value="visitor">방문자</option>
            </select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>입력과 동작</CardTitle>
            <CardDescription>본문과 안내문, 오류와 비활성 상태를 구분해요.</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="fixture-title">사건 이름</Label>
            <Input
              id="fixture-title"
              placeholder="합성 사건 예시"
              aria-describedby="fixture-help"
            />
            <FieldDescription id="fixture-help">
              개인정보 없이 UI 구성만 확인하는 입력란입니다.
            </FieldDescription>
            <Label htmlFor="fixture-note">확인할 내용</Label>
            <Textarea id="fixture-note" defaultValue="합성 자료의 날짜를 다시 확인해요." />
            <div className="actions">
              <Button onClick={() => setOpen(true)}>검토 안내 열기</Button>
              <Button variant="outline">보조 버튼 예시</Button>
              <Button disabled>처리 중 예시</Button>
            </div>
            <Separator />
            <Badge tone="primary">정리 중</Badge> <Badge tone="success">확인됨</Badge>{" "}
            <Badge tone="warning">검토 필요</Badge> <Badge tone="danger">처리 실패</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>키보드 탭</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs
              label="사건 구성 예시"
              items={[
                { value: "overview", label: "개요", content: <p>합성 사건 개요입니다.</p> },
                { value: "files", label: "자료", content: <p>합성 자료 목록입니다.</p> },
                { value: "disabled", label: "준비 중", disabled: true, content: null },
                { value: "actions", label: "다음 행동", content: <p>합성 확인 행동입니다.</p> },
              ]}
            />
          </CardContent>
        </Card>
        <section aria-label="상태 예시" className="ui-showcase-grid">
          {states.map((state) => (
            <StatePanel key={state.variant} {...state} />
          ))}
          <Skeleton />
        </section>
        <Card>
          <CardHeader>
            <CardTitle>변경되는 탭</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setDisableSelected(!disableSelected)}>
              첫 탭 활성 상태 변경
            </Button>
            <Tabs
              label="변경되는 구성 예시"
              defaultValue="missing"
              items={[
                {
                  value: "first",
                  label: "첫 항목",
                  disabled: disableSelected,
                  content: <p>첫 항목 내용</p>,
                },
                { value: "second", label: "둘째 항목", content: <p>둘째 항목 내용</p> },
              ]}
            />
            <Tabs
              label="비활성 기본값 예시"
              defaultValue="unavailable"
              items={[
                { value: "unavailable", label: "선택 불가", disabled: true, content: null },
                { value: "ready", label: "선택 가능", content: <p>활성 기본 항목 내용</p> },
              ]}
            />
          </CardContent>
        </Card>
      </main>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="검토 안내"
        description="합성 UI 동작을 확인하는 예시입니다."
      >
        <p>실제 사건 내용이나 계정 정보를 사용하지 않아요.</p>
        <Button
          variant="outline"
          onClick={() => {
            setNestedMounted(true);
            setNested(true);
          }}
        >
          추가 안내 열기
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          확인했어요
        </Button>
        {nestedMounted && (
          <Dialog open={nested} onOpenChange={setNested} title="추가 안내">
            <p>중첩된 합성 안내입니다.</p>
            <Button
              onClick={() => {
                setNested(false);
                setNestedMounted(false);
              }}
            >
              추가 안내 제거
            </Button>
          </Dialog>
        )}
      </Dialog>
    </>
  );
}
