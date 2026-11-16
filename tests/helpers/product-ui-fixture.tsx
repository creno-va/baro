import { Files, FileText, Menu, MessageSquare, PanelLeftClose } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button, ButtonLink } from "../../src/product-ui/Button";
import { Dialog } from "../../src/product-ui/Dialog";
import { InputField, TextareaField } from "../../src/product-ui/Field";
import { ProductUIProvider, useProductUI } from "../../src/product-ui/Provider";
import { ProductTheme, useProductTheme } from "../../src/product-ui/Theme";

const panels = [
  { id: "conversation", label: "대화", icon: MessageSquare },
  { id: "materials", label: "자료", icon: Files },
  { id: "report", label: "리포트", icon: FileText },
] as const;

function Catalogue() {
  const theme = useProductUI((state) => state.theme);
  const setTheme = useProductUI((state) => state.setTheme);
  const collapsed = useProductUI((state) => state.sidebarCollapsed);
  const setCollapsed = useProductUI((state) => state.setSidebarCollapsed);
  const activePanel = useProductUI((state) => state.activePanel);
  const setActivePanel = useProductUI((state) => state.setActivePanel);
  const resolvedTheme = useProductTheme();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setConfirmed(false);
    setOpen(true);
  }

  function reset() {
    setTitle("");
    setDescription("");
    setInvalid(false);
    setConfirmed(false);
  }

  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-[var(--pui-border)] pb-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-widest text-[var(--pui-muted)]">
            BARO · UI FOUNDATION
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            공통 UI 기반 검토
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--pui-muted)]">
            버튼, 입력, 대화상자와 화면 상태를 독립적으로 확인합니다. 사건 API를 호출하거나 서버에
            저장하지 않습니다.
          </p>
        </div>
        <ButtonLink href="/" variant="secondary">
          기존 랜딩 보기
        </ButtonLink>
      </header>

      <section
        aria-labelledby="theme-heading"
        className="flex flex-wrap items-center justify-between gap-4 py-6"
      >
        <div>
          <h2 id="theme-heading" className="text-sm font-semibold">
            화면 테마
          </h2>
          <p className="mt-1 text-xs text-[var(--pui-muted)]">
            현재 표시: {resolvedTheme === "dark" ? "다크" : "라이트"}
          </p>
        </div>
        <fieldset aria-label="테마 선택" className="flex flex-wrap gap-2">
          {(
            [
              ["system", "시스템"],
              ["light", "라이트"],
              ["dark", "다크"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={theme === value ? "primary" : "secondary"}
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              {label}
            </Button>
          ))}
        </fieldset>
      </section>

      <div className="grid items-start gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "예시 탐색 펼치기" : "예시 탐색 접기"}
            aria-expanded={!collapsed}
            aria-controls="fixture-navigation"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <Menu size={20} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={20} aria-hidden="true" />
            )}
          </Button>
          <nav
            id="fixture-navigation"
            aria-label="예시 탐색"
            hidden={collapsed}
            className="mt-3 grid gap-2 md:w-40"
          >
            {panels.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={activePanel === id ? "secondary" : "ghost"}
                aria-pressed={activePanel === id}
                className="justify-start"
                onClick={() => setActivePanel(id)}
              >
                <Icon size={18} aria-hidden="true" />
                {label}
              </Button>
            ))}
          </nav>
        </aside>

        <section
          aria-labelledby="form-heading"
          className="min-w-0 rounded-2xl border border-[var(--pui-border)] bg-[var(--pui-surface)] p-5 sm:p-7"
        >
          <h2 id="form-heading" className="text-lg font-semibold">
            입력과 확인
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--pui-muted)]">
            선택한 예시 화면: {panels.find((panel) => panel.id === activePanel)?.label}
          </p>
          <form onSubmit={submit} noValidate className="mt-6 grid gap-5">
            <InputField
              label="검토 제목"
              name="title"
              value={title}
              required
              maxLength={40}
              autoComplete="off"
              description="검토용 예시를 40자 이내로 입력해 주세요."
              error={invalid ? "검토 제목을 입력해 주세요." : undefined}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setInvalid(false);
                setConfirmed(false);
              }}
            />
            <TextareaField
              label="추가 설명"
              name="description"
              value={description}
              maxLength={500}
              description="선택 사항입니다. 실제 사건이나 개인정보를 입력하지 마세요."
              onChange={(event) => {
                setDescription(event.currentTarget.value);
                setConfirmed(false);
              }}
            />
            <div className="flex flex-wrap gap-2 border-t border-[var(--pui-border)] pt-5">
              <Button type="submit">변경 내용 검토</Button>
              <Button variant="secondary" onClick={reset}>
                초기화
              </Button>
              <Button variant="ghost" disabled>
                사용할 수 없는 동작
              </Button>
              <Button variant="danger" onClick={() => setInvalid(true)}>
                오류 표시 예시
              </Button>
            </div>
            {confirmed && (
              <p role="status" className="text-sm text-[var(--pui-muted)]">
                내용을 확인했습니다. 서버에 저장하지 않았습니다.
              </p>
            )}
          </form>
        </section>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="입력 내용 확인"
        description="이 화면에서 입력한 검토용 예시입니다."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              돌아가기
            </Button>
            <Button
              onClick={() => {
                setConfirmed(true);
                setOpen(false);
              }}
            >
              내용 확인
            </Button>
          </>
        }
      >
        <dl className="grid min-w-0 gap-4 text-sm">
          <div className="min-w-0">
            <dt className="font-medium text-[var(--pui-muted)]">제목</dt>
            <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{title}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-medium text-[var(--pui-muted)]">추가 설명</dt>
            <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {description || "입력하지 않음"}
            </dd>
          </div>
        </dl>
      </Dialog>
    </main>
  );
}

export function ProductUIFixture() {
  return (
    <ProductUIProvider>
      <ProductTheme className="min-h-screen bg-[var(--pui-background)] text-[var(--pui-text)]">
        <Catalogue />
      </ProductTheme>
    </ProductUIProvider>
  );
}
