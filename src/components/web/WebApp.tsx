import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  FileText,
  FolderClosed,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, apiMode, type CaseView, type WorkspaceView } from "../../client/api";
import { ensureCaseEntry, queryKeys } from "../../client/query/resources";
import { useWebSession, WebQueryProvider } from "../../client/query/session";
import { CASE_NARRATIVE_MIN_LENGTH } from "../../contracts/common";
import { Conversation } from "./Conversation";
import { Materials } from "./Materials";
import {
  Brand,
  Button,
  Dialog,
  Empty,
  formatDate,
  Loading,
  Problem,
  useViewGuard,
} from "./Primitives";
import { Report } from "./Report";
import { Summary } from "./Summary";

export type WebTab = "chat" | "files" | "report" | "timeline" | "actions" | "summary";
type LocationState = { caseId: string | undefined; tab: WebTab };
const tabs = [
  { id: "chat", label: "대화", icon: MessageCircle },
  { id: "files", label: "자료", icon: FolderClosed },
  { id: "report", label: "리포트", icon: FileText },
] as const;
const extraTabs: Record<string, WebTab> = {
  files: "files",
  reports: "report",
  timeline: "timeline",
  actions: "actions",
  summary: "summary",
  intake: "summary",
};
function locationState(): LocationState {
  const [, root, id, suffix] = window.location.pathname.split("/");
  return {
    caseId: root === "cases" && id && id !== "new" ? decodeURIComponent(id) : undefined,
    tab: extraTabs[suffix ?? ""] ?? "chat",
  };
}

export function WebApp({
  initialCaseId,
  initialTab = "chat",
}: {
  initialCaseId?: string;
  initialTab?: WebTab;
}) {
  return (
    <WebQueryProvider>
      <WorkspaceApp {...(initialCaseId ? { initialCaseId } : {})} initialTab={initialTab} />
    </WebQueryProvider>
  );
}

function WorkspaceApp({
  initialCaseId,
  initialTab,
}: {
  initialCaseId?: string;
  initialTab: WebTab;
}) {
  const access = useWebSession();
  const [route, setRoute] = useState<LocationState>({ caseId: initialCaseId, tab: initialTab });
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    const pop = () => setRoute(locationState());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  function navigate(caseId?: string, tab: WebTab = "chat") {
    const suffix = tab === "chat" ? "" : `/${tab === "report" ? "reports" : tab}`;
    window.history.pushState(
      null,
      "",
      caseId ? `/cases/${encodeURIComponent(caseId)}${suffix}` : "/new",
    );
    setRoute({ caseId, tab });
    setDrawer(false);
  }
  if (!access.ready)
    return (
      <main id="main-content" className="web-access-state">
        <Loading>로그인 상태를 확인하고 있어요.</Loading>
      </main>
    );
  if (access.error)
    return (
      <main id="main-content" className="web-access-state">
        <Problem error={access.error} retry={() => void access.refresh()} />
      </main>
    );
  if (!access.session?.user || access.session.needsConsent)
    return (
      <main id="main-content" className="web-access-state">
        <Empty
          title={access.session?.user ? "이용 전 확인이 필요해요" : "내 사건을 안전하게 이어가세요"}
          action={
            <a
              className="web-button web-button--primary"
              href={
                access.session?.user
                  ? "/consent"
                  : `/login?returnTo=${encodeURIComponent(window.location.pathname)}`
              }
            >
              계속하기
              <ArrowRight size={17} />
            </a>
          }
        >
          로그인과 필수 확인을 마치면 저장한 이야기를 이어갈 수 있어요.
        </Empty>
      </main>
    );
  return (
    <div className="web-app" key={access.owner}>
      <aside className="web-sidebar">
        <Sidebar activeId={route.caseId} navigate={navigate} />
      </aside>
      {drawer && (
        <Dialog title="내 작업 공간" onClose={() => setDrawer(false)}>
          <Sidebar activeId={route.caseId} navigate={navigate} />
        </Dialog>
      )}
      <div className="web-app__body">
        <header className="web-topbar">
          <div>
            <Button
              variant="ghost"
              className="web-mobile-menu"
              aria-label="사건 목록 열기"
              onClick={() => setDrawer(true)}
            >
              <Menu size={21} />
            </Button>
            <span className="web-topbar__label">나의 작업 공간</span>
            <span className="web-topbar__separator">/</span>
            <span>{route.caseId ? "사건 정리" : "새 이야기"}</span>
          </div>
          <a className="web-help-link" href="/help">
            도움말
            <ArrowRight size={14} />
          </a>
        </header>
        {apiMode === "mock" && (
          <p className="web-fixture-notice">
            로컬 예시 모드 · 합성 데이터로 화면을 확인하고 있어요.
          </p>
        )}
        <main id="main-content" className="web-main" tabIndex={-1}>
          {route.caseId ? (
            <CaseWorkspace
              key={`${access.owner}:${route.caseId}`}
              caseId={route.caseId}
              tab={route.tab}
              setTab={(tab) => navigate(route.caseId, tab)}
              navigate={navigate}
            />
          ) : (
            <NewStory key={access.owner} onCreated={(item) => navigate(item.id, "summary")} />
          )}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  activeId,
  navigate,
}: {
  activeId: string | undefined;
  navigate: (id?: string, tab?: WebTab) => void;
}) {
  const { owner, session } = useWebSession();
  const [search, setSearch] = useState("");
  const cases = useQuery({
    queryKey: queryKeys.cases(owner ?? ""),
    queryFn: () => api.cases.list(),
    enabled: !!owner,
  });
  const list =
    cases.data?.filter((item) =>
      item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <div className="web-sidebar__inner">
      <div className="web-sidebar__brand">
        <Brand />
        <span className="web-beta">BETA</span>
      </div>
      <Button className="web-new-story" onClick={() => navigate()}>
        <Plus size={18} />새 이야기 시작
      </Button>
      <label className="web-search">
        <Search size={17} aria-hidden="true" />
        <input
          aria-label="내 사건 검색"
          placeholder="내 사건 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="web-sidebar__heading">
        <span>내 사건</span>
        <span>{cases.data?.length ?? 0}</span>
      </div>
      <nav className="web-case-list" aria-label="내 사건">
        {cases.isPending ? (
          <Loading>사건을 불러오는 중</Loading>
        ) : cases.error ? (
          <Problem error={cases.error} retry={() => void cases.refetch()} />
        ) : list.length ? (
          list.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-current={activeId === item.id ? "page" : undefined}
              className={`web-case-item ${activeId === item.id ? "is-active" : ""}`}
              onClick={() =>
                navigate(
                  item.id,
                  item.stage === "intake" || item.stage === "summary" ? "summary" : "chat",
                )
              }
            >
              <MessageCircle size={17} aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <small>
                  {formatDate(item.updatedAt)} ·{" "}
                  {item.stage === "active"
                    ? "정리 중"
                    : item.stage === "archived"
                      ? "보관됨"
                      : "내용 확인 중"}
                </small>
              </span>
            </button>
          ))
        ) : (
          <p className="web-sidebar__empty">
            {search
              ? "검색 결과가 없어요."
              : "첫 이야기를 시작해 보세요.\n내 사건이 여기에 모여요."}
          </p>
        )}
      </nav>
      <div className="web-sidebar__footer">
        <div className="web-private-note">
          <ShieldCheck size={16} />
          <p>내 이야기는 나만 볼 수 있어요.</p>
        </div>
        <a className="web-account" href="/settings">
          <span className="web-avatar">{(session?.user?.name ?? "나").slice(0, 1)}</span>
          <span>
            <strong>{session?.user?.name || "내 계정"}</strong>
            <small>설정 및 사용량</small>
          </span>
          <Settings size={18} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

function NewStory({ onCreated }: { onCreated: (item: CaseView) => void }) {
  useEffect(() => {
    document.title = "새 이야기 · BARO";
  }, []);
  const { session, owner } = useWebSession();
  const query = useQueryClient();
  const current = useViewGuard();
  const [narrative, setNarrative] = useState("");
  const [purpose, setPurpose] = useState<"prepare_claim" | "respond_to_claim">("prepare_claim");
  const [subject, setSubject] = useState<"individual" | "company">("individual");
  const [lockedDraft, setLockedDraft] = useState(false);
  const attempt = useRef<{
    narrative: string;
    subjectContext: "individual" | "company";
    casePurpose: "prepare_claim" | "respond_to_claim";
  } | null>(null);
  const lock = useRef(false);
  const create = useMutation({
    mutationFn: () => {
      attempt.current ??= {
        narrative: narrative.trim(),
        subjectContext: subject,
        casePurpose: purpose,
      };
      return api.rework.createCase(attempt.current, { expectedOwner: session?.user?.id ?? "" });
    },
    onSuccess: (item) => {
      if (!current()) return;
      attempt.current = null;
      setLockedDraft(false);
      void query.invalidateQueries({ queryKey: queryKeys.cases(owner) });
      onCreated(item);
    },
    onError: (error) => {
      if (!current()) return;
      if (
        [
          "VALIDATION_ERROR",
          "QUOTA_EXCEEDED",
          "CHALLENGE_REQUIRED",
          "CHALLENGE_FAILED",
          "CONSENT_REQUIRED",
          "FORBIDDEN",
          "IDEMPOTENCY_CONFLICT",
        ].includes((error as { code?: string })?.code ?? "")
      ) {
        attempt.current = null;
        setLockedDraft(false);
      }
    },
  });
  const examples = [
    "빌려준 돈을 돌려받지 못했어요.",
    "계약이 끝났는데 보증금을 아직 못 받았어요.",
    "상대방의 연락에 어떻게 대응할지 정리하고 싶어요.",
  ];
  return (
    <section className="web-start">
      <div className="web-start__intro">
        <span className="web-start__symbol">
          <Sparkles size={28} strokeWidth={1.5} />
        </span>
        <p className="web-eyebrow">막막한 마음이, 명확한 다음 단계로</p>
        <h1>어떤 일이 있었나요?</h1>
        <p>
          잘 정리하지 않아도 괜찮아요.
          <br />
          생각나는 이야기부터 함께 풀어갈게요.
        </p>
      </div>
      <form
        className="web-story-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (lock.current || create.isPending || !current()) return;
          lock.current = true;
          setLockedDraft(true);
          create.mutate(undefined, {
            onSettled: () => {
              lock.current = false;
            },
          });
        }}
      >
        <fieldset className="web-purpose" disabled={create.isPending || lockedDraft}>
          <legend className="web-sr-only">정리 목적</legend>
          <label className={purpose === "prepare_claim" ? "is-selected" : ""}>
            <input
              type="radio"
              name="purpose"
              checked={purpose === "prepare_claim"}
              onChange={() => setPurpose("prepare_claim")}
            />
            내 문제를 해결하고 싶어요
          </label>
          <label className={purpose === "respond_to_claim" ? "is-selected" : ""}>
            <input
              type="radio"
              name="purpose"
              checked={purpose === "respond_to_claim"}
              onChange={() => setPurpose("respond_to_claim")}
            />
            상대방 주장에 대응하고 싶어요
          </label>
        </fieldset>
        <label className="web-sr-only" htmlFor="story">
          어떤 일이 있었는지 이야기해 주세요
        </label>
        <textarea
          id="story"
          placeholder={
            "언제, 누구와, 어떤 일이 있었나요?\n지금 가장 걱정되는 점을 편하게 적어주세요."
          }
          minLength={CASE_NARRATIVE_MIN_LENGTH}
          maxLength={5000}
          required
          value={narrative}
          disabled={create.isPending || lockedDraft}
          onChange={(event) => setNarrative(event.target.value)}
        />
        <div className="web-story-form__bottom">
          <label className="web-story-context">
            사건 유형
            <select
              value={subject}
              disabled={create.isPending || lockedDraft}
              onChange={(event) =>
                setSubject(event.target.value === "company" ? "company" : "individual")
              }
            >
              <option value="individual">개인 사건</option>
              <option value="company">기업 사건</option>
            </select>
          </label>
          <span>{[...narrative].length.toLocaleString()} / 5,000</span>
          <Button
            type="submit"
            disabled={create.isPending || [...narrative.trim()].length < CASE_NARRATIVE_MIN_LENGTH}
          >
            {create.isPending
              ? "이야기 저장 중…"
              : lockedDraft
                ? "같은 저장 다시 확인"
                : "함께 정리하기"}
            <ArrowRight size={18} />
          </Button>
        </div>
      </form>
      {create.error && <Problem error={create.error} />}
      {lockedDraft && !create.isPending && (
        <p className="web-notice">
          저장 결과를 아직 확인하지 못했어요. 입력을 보존했으니 같은 요청의 결과를 다시 확인해
          주세요.
        </p>
      )}
      <div className="web-examples">
        <p>어디서 시작할지 어렵다면</p>
        {examples.map((example) => (
          <button
            type="button"
            key={example}
            disabled={create.isPending || lockedDraft}
            onClick={() => {
              setNarrative(example);
              document.getElementById("story")?.focus();
            }}
          >
            {example}
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
      <p className="web-disclaimer">
        <ShieldCheck size={15} />
        입력한 내용은 내 계정에 안전하게 저장돼요.
        <br />
        BARO의 AI는 사실 정리를 도우며, 법률 자문을 대신하지 않아요.
      </p>
    </section>
  );
}

function CaseWorkspace({
  caseId,
  tab,
  setTab,
  navigate,
}: {
  caseId: string;
  tab: WebTab;
  setTab: (tab: WebTab) => void;
  navigate: (id?: string, tab?: WebTab) => void;
}) {
  const { owner } = useWebSession();
  const query = useQueryClient();
  const current = useViewGuard();
  const [details, setDetails] = useState(false);
  const [manage, setManage] = useState(false);
  const item = useQuery({
    queryKey: [...queryKeys.case(owner, caseId), "entry"],
    queryFn: ({ signal }) =>
      ensureCaseEntry({
        client: query,
        owner,
        caseId,
        signal,
        list: () => api.cases.list(),
        get: (id) => api.cases.get(id),
      }),
    enabled: Boolean(owner),
  });
  const workspace = useQuery({
    queryKey: queryKeys.workspace(owner, caseId),
    queryFn: () => api.workspace.get(caseId),
    enabled: Boolean(owner) && item.isSuccess && item.data.schemaVersion !== "1",
    refetchInterval: (state) =>
      state.state.data?.messages.some((message) => message.status === "pending") ? 2500 : false,
  });
  const pageTitle = workspace.data?.case.title ?? item.data?.title;
  useEffect(() => {
    if (pageTitle) document.title = `${pageTitle} · BARO`;
  }, [pageTitle]);
  const refresh = async () => {
    if (!current()) return;
    await Promise.all([
      query.invalidateQueries({ queryKey: queryKeys.workspace(owner, caseId) }),
      query.invalidateQueries({ queryKey: queryKeys.cases(owner) }),
    ]);
  };
  if (item.isPending) return <Loading>사건 내용을 확인하고 있어요.</Loading>;
  if (item.error)
    return (
      <div className="web-pane">
        <Problem error={item.error} retry={() => void item.refetch()} />
      </div>
    );
  if (item.data.schemaVersion === "1")
    return (
      <div className="web-case-workspace">
        <header className="web-case-header">
          <div>
            <p className="web-eyebrow">이전 사건 기록 · 읽기 전용</p>
            <h1>{item.data.title}</h1>
          </div>
          <Button variant="secondary" onClick={() => setManage(true)}>
            사건 관리·삭제
          </Button>
        </header>
        {manage && (
          <CaseManagement item={item.data} onChanged={refresh} onClose={() => setManage(false)} />
        )}
        <Summary caseId={caseId} onChanged={refresh} onComplete={() => navigate()} />
      </div>
    );
  if (workspace.isPending) return <Loading>저장한 이야기를 불러오고 있어요.</Loading>;
  if (workspace.error)
    return (
      <div className="web-pane">
        <Problem error={workspace.error} retry={() => void workspace.refetch()} />
      </div>
    );
  const view = workspace.data;
  const active = view.case.stage === "active";
  const currentTab = !active && tab === "chat" ? "summary" : tab;
  return (
    <div className="web-case-workspace">
      <header className="web-case-header">
        <div>
          <button type="button" className="web-back-mobile" onClick={() => navigate()}>
            <ChevronLeft size={16} />새 이야기
          </button>
          <p className="web-eyebrow">내 사건 · {formatDate(view.case.updatedAt)}</p>
          <h1>{view.case.title}</h1>
        </div>
        <Button variant="secondary" onClick={() => setDetails(!details)} aria-expanded={details}>
          사건 정보
        </Button>
      </header>
      {details && (
        <div className="web-case-details">
          <p>{view.case.summary || "추가 질문을 통해 사건을 정리하고 있어요."}</p>
          <div className="web-inline-actions">
            <Button variant="ghost" onClick={() => setTab("summary")}>
              요약 확인
            </Button>
            <Button variant="ghost" onClick={() => setTab("timeline")}>
              타임라인
            </Button>
            <Button variant="ghost" onClick={() => setTab("actions")}>
              다음 행동
            </Button>
            <Button variant="ghost" onClick={() => setManage(true)}>
              사건 관리·삭제
            </Button>
          </div>
        </div>
      )}
      {manage && (
        <CaseManagement item={view.case} onChanged={refresh} onClose={() => setManage(false)} />
      )}
      <nav className="web-tabs" aria-label="사건 보기">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-current={currentTab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={17} />
            <span>{label}</span>
            {id === "files" && view.files.length > 0 && (
              <span className="web-count">{view.files.length}</span>
            )}
          </button>
        ))}
        {!["chat", "files", "report"].includes(currentTab) && (
          <button type="button" aria-current="page" onClick={() => setTab(currentTab)}>
            {currentTab === "summary"
              ? "사건 요약"
              : currentTab === "timeline"
                ? "타임라인"
                : "다음 행동"}
            <X
              size={13}
              onClick={(event) => {
                event.stopPropagation();
                setTab("chat");
              }}
            />
          </button>
        )}
      </nav>
      {view.notices?.map((notice) => (
        <p className="web-notice" key={notice}>
          {notice}
        </p>
      ))}
      {currentTab === "chat" ? (
        <Conversation view={view} onChanged={refresh} setTab={setTab} />
      ) : currentTab === "files" ? (
        <Materials caseId={caseId} onChanged={refresh} />
      ) : currentTab === "report" ? (
        <Report caseId={caseId} onChanged={refresh} />
      ) : currentTab === "summary" ? (
        <Summary caseId={caseId} onChanged={refresh} onComplete={() => setTab("chat")} />
      ) : (
        <Collections view={view} kind={currentTab} onChanged={refresh} />
      )}
    </div>
  );
}

function Collections({
  view,
  kind,
  onChanged,
}: {
  view: WorkspaceView;
  kind: "timeline" | "actions";
  onChanged: () => Promise<void>;
}) {
  const { owner } = useWebSession();
  const query = useQueryClient();
  const current = useViewGuard();
  const lock = useRef(false);
  const action = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api.workspace.setAction(view.case.id, id, done),
    onSuccess: async (next) => {
      if (!current()) return;
      query.setQueryData(queryKeys.workspace(owner, view.case.id), next);
      await onChanged();
    },
    onError: () => {
      if (current()) void onChanged();
    },
  });
  const more = useMutation({
    mutationFn: () => api.workspace.loadMore(view.case.id, kind),
    onSuccess: (next) => {
      if (current()) query.setQueryData(queryKeys.workspace(owner, view.case.id), next);
    },
  });
  const busy = action.isPending || more.isPending;
  return (
    <section className="web-pane">
      <header className="web-section-title">
        <div>
          <p className="web-eyebrow">사건의 흐름</p>
          <h2>{kind === "timeline" ? "일어난 일을 시간순으로" : "지금 준비할 수 있는 일"}</h2>
        </div>
      </header>
      {action.error && <Problem error={action.error} />}
      {kind === "timeline"
        ? view.timeline.map((entry) => (
            <article className="web-timeline-item" key={entry.id}>
              <span>{entry.date || "날짜 미확인"}</span>
              <div>
                <h3>{entry.title}</h3>
                <p>{entry.detail}</p>
              </div>
            </article>
          ))
        : view.actions.map((entry) => (
            <label className="web-action-item" key={entry.id}>
              <input
                type="checkbox"
                checked={entry.done}
                disabled={busy}
                onChange={(event) => {
                  if (lock.current || !current()) return;
                  lock.current = true;
                  action.mutate(
                    { id: entry.id, done: event.target.checked },
                    {
                      onSettled: () => {
                        lock.current = false;
                      },
                    },
                  );
                }}
              />
              <span>
                <strong>{entry.title}</strong>
                <span>{entry.detail}</span>
              </span>
              {entry.done && <Check size={18} />}
            </label>
          ))}
      {view[kind].length === 0 && (
        <Empty
          title={kind === "timeline" ? "아직 기록된 일정이 없어요" : "차근차근 준비해 볼까요?"}
        >
          대화에서 사건을 정리하면 여기에 필요한 내용이 모여요.
        </Empty>
      )}
      {more.error && <Problem error={more.error} />}
      {view.pagination?.[kind] && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (lock.current || !current()) return;
            lock.current = true;
            more.mutate(undefined, {
              onSettled: () => {
                lock.current = false;
              },
            });
          }}
        >
          이전 내용 더 보기
        </Button>
      )}
    </section>
  );
}

function CaseManagement({
  item,
  onChanged,
  onClose,
}: {
  item: CaseView;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { owner, session } = useWebSession();
  const query = useQueryClient();
  const current = useViewGuard();
  const [title, setTitle] = useState(item.title);
  const [confirmation, setConfirmation] = useState("");
  const lock = useRef(false);
  const rename = useMutation({
    mutationFn: () => api.cases.rename(item.id, { title: title.trim(), expectedTitle: item.title }),
    onSuccess: async (next) => {
      if (!current()) return;
      query.setQueryData(queryKeys.case(owner, item.id), next);
      await onChanged();
      if (current()) onClose();
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const userId = session?.user?.id;
      if (!userId || confirmation !== "DELETE" || !current())
        throw new Error("삭제할 사건과 계정을 다시 확인해 주세요.");
      await api.account.deleteCase(item.id, confirmation, item.schemaVersion ?? "2");
      // Successful case deletion intentionally invalidates the transport generation.
      // Only a fresh response for the same account may navigate after that revocation.
      const live = await api.session.get();
      if (live.user?.id === userId) window.location.assign("/new");
    },
  });
  const busy = rename.isPending || remove.isPending;
  return (
    <Dialog
      title="사건 관리"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="web-case-management">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (lock.current || busy || !current()) return;
            lock.current = true;
            rename.mutate(undefined, {
              onSettled: () => {
                lock.current = false;
              },
            });
          }}
        >
          <label htmlFor="case-title">사건 이름</label>
          <input
            id="case-title"
            value={title}
            maxLength={40}
            required
            disabled={busy || item.schemaVersion === "1"}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button
            type="submit"
            disabled={
              busy || !title.trim() || title.trim() === item.title || item.schemaVersion === "1"
            }
          >
            이름 저장
          </Button>
        </form>
        {rename.error && <Problem error={rename.error} />}
        <section className="web-case-delete">
          <h3>이 사건 삭제</h3>
          <p>
            이 사건의 자료와 리포트 접근을 차단하고 원격 정리를 진행해요. 삭제 후 복구할 수 없으며
            내려받거나 외부에 전달한 파일은 직접 관리해야 해요.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (lock.current || busy || confirmation !== "DELETE" || !current()) return;
              lock.current = true;
              remove.mutate(undefined, {
                onSettled: () => {
                  lock.current = false;
                },
              });
            }}
          >
            <label htmlFor="case-delete-confirmation">삭제하려면 DELETE를 입력하세요.</label>
            <input
              id="case-delete-confirmation"
              value={confirmation}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <Button variant="danger" type="submit" disabled={busy || confirmation !== "DELETE"}>
              {remove.isPending ? "삭제 요청 중…" : "이 사건과 자료 삭제"}
            </Button>
          </form>
          {remove.error && <Problem error={remove.error} />}
        </section>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          닫기
        </Button>
      </div>
    </Dialog>
  );
}
