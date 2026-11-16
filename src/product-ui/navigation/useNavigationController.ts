import { type FocusEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, apiMode, type CaseView, roleStart, type SessionView } from "../../client/api";
import { setTheme, subscribeTheme, themePreference } from "../../client/theme";
import {
  type AppNavigationProps,
  availableNavigation,
  caseLink,
  type NavigationRole,
} from "./types";

/** Existing API operations and ownership fences remain independent of navigation rendering. */
export function useNavigationController({
  role = "visitor",
  pathname = "/",
  availableRoutes,
  showLogin = false,
  appearance = "default",
}: AppNavigationProps) {
  const [utility, setUtility] = useState<"search" | "attention" | null>(null);
  const [query, setQuery] = useState("");
  const utilityReturn = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigationRoot = useRef<HTMLElement>(null);
  const brandRef = useRef<HTMLAnchorElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const menuReturn = useRef<HTMLElement | null>(null);
  const mobileMenuButton = useRef<HTMLButtonElement>(null);
  const lastNavigationFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("baro-sidebar-collapsed") === "true");
    } catch {
      // A blocked preference store must not block navigation.
    }
    const desktop = window.matchMedia("(min-width: 1200px)");
    const mobile = window.matchMedia("(max-width: 767px)");
    const updateNavigationFocus = () => {
      // CSS can blur a disappearing rail control before the media-query event.
      const focused =
        document.activeElement === document.body
          ? lastNavigationFocus.current
          : document.activeElement;
      if (desktop.matches) {
        menuReturn.current =
          appearance === "workbench" ? (brandRef.current ?? null) : collapseButton.current;
        setOpen(false);
      } else if (menuReturn.current && !menuReturn.current.getClientRects().length) {
        menuReturn.current = mobileMenuButton.current;
      }
      if (
        focused instanceof HTMLElement &&
        navigationRoot.current?.contains(focused) &&
        !focused.getClientRects().length
      )
        (desktop.matches
          ? appearance === "workbench"
            ? brandRef.current
            : collapseButton.current
          : mobileMenuButton.current
        )?.focus();
    };
    const clearPointerFocus = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigationRoot.current?.contains(event.target))
        lastNavigationFocus.current = null;
    };
    document.addEventListener("pointerdown", clearPointerFocus, true);
    desktop.addEventListener("change", updateNavigationFocus);
    mobile.addEventListener("change", updateNavigationFocus);
    return () => {
      document.removeEventListener("pointerdown", clearPointerFocus, true);
      desktop.removeEventListener("change", updateNavigationFocus);
      mobile.removeEventListener("change", updateNavigationFocus);
    };
  }, [appearance]);
  useEffect(() => {
    const frame = navigationRoot.current?.closest<HTMLElement>("[data-app-workspace]");
    if (frame) frame.dataset.sidebarCollapsed = String(collapsed);
  }, [collapsed]);
  function toggleSidebar() {
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem("baro-sidebar-collapsed", String(next));
      } catch {
        // This is a display preference only; keep the control usable without storage.
      }
      return next;
    });
  }
  function openDrawer(opener: HTMLElement) {
    opener.focus();
    menuReturn.current = opener;
    setOpen(true);
  }
  const [session, setSession] = useState<SessionView | null>(null);
  const [recent, setRecent] = useState<CaseView[]>([]);
  const [recentState, setRecentState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [deletion, setDeletion] = useState<{ item: CaseView; ownerId: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<{ item: CaseView; ownerId: string } | null>(null);
  const [caseTitle, setCaseTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const renameLock = useRef(false);
  const deleteLock = useRef(false);
  const sessionRequest = useRef(0);
  const signingOutRef = useRef(false);
  useEffect(() => {
    let active = true;
    let owner: string | undefined;
    setReady(true);
    async function refresh() {
      if (signingOutRef.current) return;
      const ticket = ++sessionRequest.current;
      const current = () => active && ticket === sessionRequest.current;
      try {
        const next = await api.session.get();
        if (!current()) return;
        if (owner !== next.user?.id || next.needsConsent || !next.user) {
          setQuery("");
          setUtility(null);
          setRecent([]);
          setRecentState("loading");
          setDeletion(null);
          setEditing(null);
        }
        owner = next.user?.id;
        setSession(next);
        if (!next.user || next.needsConsent) return;
        try {
          const items = await api.cases.list();
          if (current()) {
            setRecent([...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
            setRecentState("ready");
          }
        } catch {
          if (current()) {
            setRecent([]);
            setRecentState("error");
          }
        }
      } catch {
        if (!current()) return;
        owner = undefined;
        setRecent([]);
        setDeletion(null);
        setEditing(null);
        setSession({ user: null, needsConsent: false });
      }
    }
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const storage = (event: StorageEvent) => {
      if (
        !event.key ||
        ["baro-api-mock-v1:session", "baro-session-changed", "better-auth.message"].includes(
          event.key,
        )
      )
        void refresh();
    };
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", storage);
    window.addEventListener("baro-session-changed", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      ++sessionRequest.current;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener("baro-session-changed", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const resolvedRole: NavigationRole =
    session === null
      ? role
      : session.user
        ? session.user.accountType === "lawyer"
          ? "lawyer"
          : "user"
        : "visitor";
  const items = availableNavigation(resolvedRole, [
    ...availableRoutes,
    "/",
    "/new",
    "/login",
    "/cases",
    "/cases/new",
    "/lawyer",
    "/lawyers",
    "/settings",
  ]);
  async function signOut() {
    signingOutRef.current = true;
    ++sessionRequest.current;
    setRecent([]);
    setDeletion(null);
    setEditing(null);
    setSigningOut(true);
    setError("");
    try {
      await api.session.signOut();
      setRecent([]);
      window.location.assign("/login");
    } catch {
      signingOutRef.current = false;
      setError("로그아웃하지 못했어요. 다시 시도해 주세요.");
      setSigningOut(false);
    }
  }
  async function deleteRecent() {
    if (!deletion || deleteLock.current) return;
    const target = deletion;
    deleteLock.current = true;
    setDeleting(true);
    setError("");
    const sameOwner = async () => {
      const fresh = await api.session.get();
      if (fresh.user?.id !== target.ownerId) {
        setDeletion(null);
        setRecent([]);
        throw new Error("계정이 변경됐어요. 현재 계정의 사건을 다시 확인해 주세요.");
      }
    };
    try {
      await sameOwner();
      await api.account.deleteCase(target.item.id, "DELETE", target.item.schemaVersion ?? "2");
      await sameOwner();
      setRecent((items) => items.filter((item) => item.id !== target.item.id));
      setDeletion(null);
      window.location.assign("/new");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "삭제를 접수하지 못했어요. 다시 확인해 주세요.",
      );
    } finally {
      deleteLock.current = false;
      setDeleting(false);
    }
  }
  async function renameRecent() {
    if (!editing || renameLock.current || !caseTitle.trim()) return;
    const target = editing;
    renameLock.current = true;
    setRenaming(true);
    setRenameError("");
    const sameOwner = async () => {
      const fresh = await api.session.get();
      if (fresh.user?.id !== target.ownerId || fresh.needsConsent) {
        setEditing(null);
        setRecent([]);
        throw new Error("현재 계정의 사건을 다시 확인해 주세요.");
      }
    };
    try {
      await sameOwner();
      const next = await api.cases.rename(target.item.id, {
        title: caseTitle,
        expectedTitle: target.item.title,
      });
      await sameOwner();
      setRecent((items) => items.map((item) => (item.id === next.id ? next : item)));
      setEditing(null);
      window.dispatchEvent(new CustomEvent("baro-case-title-changed", { detail: { id: next.id } }));
    } catch (cause) {
      setRenameError(
        cause instanceof Error ? cause.message : "제목을 저장하지 못했어요. 다시 시도해 주세요.",
      );
      if ((cause as { code?: string })?.code === "CONFLICT") {
        try {
          await sameOwner();
          const next = await api.cases.get(target.item.id);
          await sameOwner();
          setEditing((value) => (value?.item.id === next.id ? { ...value, item: next } : value));
        } catch {
          /* Keep the entered title for an explicit retry. */
        }
      }
    } finally {
      renameLock.current = false;
      setRenaming(false);
    }
  }
  const theme = useSyncExternalStore(subscribeTheme, themePreference, () => "system" as const);
  const matches = recent.filter((item) =>
    utility === "search"
      ? item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      : !["active", "archived"].includes(item.stage),
  );
  function beginRename(item: CaseView, opener: HTMLElement) {
    opener.focus();
    if (!session?.user) return;
    setRenameError("");
    setCaseTitle(item.title);
    setEditing({ item, ownerId: session.user.id });
  }
  function beginDelete(item: CaseView, opener: HTMLElement) {
    opener.focus();
    setError("");
    if (session?.user) setDeletion({ item, ownerId: session.user.id });
  }
  function openUtility(mode: "search" | "attention", opener: HTMLElement) {
    utilityReturn.current = opener;
    setUtility(mode);
  }
  function focusCapture(event: FocusEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement) lastNavigationFocus.current = event.target;
  }
  function blurCapture(event: FocusEvent<HTMLElement>) {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget))
      lastNavigationFocus.current = null;
  }
  return {
    pathname,
    appearance,
    showLogin,
    session,
    resolvedRole,
    items,
    recent,
    recentState,
    ready,
    collapsed,
    open,
    utility,
    query,
    matches,
    error,
    signingOut,
    deletion,
    deleting,
    editing,
    caseTitle,
    renameError,
    renaming,
    theme,
    brandHref: session?.user ? roleStart(session) : "/",
    mock: apiMode === "mock",
    canShowRecent: (resolvedRole === "user" || resolvedRole === "lawyer") && !session?.needsConsent,
    refs: { navigationRoot, brandRef, collapseButton, mobileMenuButton, menuReturn, utilityReturn },
    actions: {
      toggleSidebar,
      openDrawer,
      setDrawerOpen: setOpen,
      openUtility,
      closeUtility: () => setUtility(null),
      setQuery,
      beginRename,
      setCaseTitle,
      renameRecent,
      cancelRename: () => {
        if (!renaming) setEditing(null);
      },
      beginDelete,
      deleteRecent,
      cancelDelete: () => {
        if (!deleting) setDeletion(null);
      },
      signOut,
      setTheme,
      focusCapture,
      blurCapture,
      retryRecent: () => window.dispatchEvent(new Event("focus")),
    },
    caseLink,
  };
}
export type NavigationController = ReturnType<typeof useNavigationController>;
