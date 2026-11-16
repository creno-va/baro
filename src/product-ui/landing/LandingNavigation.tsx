import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ArrowRight, ArrowUpRight, Menu, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useClientReady } from "../utils";
import LandingBrand from "./LandingBrand";
import { LandingButton } from "./LandingLink";
import { sceneClasses as s } from "./scene-classes";

const links = [
  { href: "#our-beginning", label: "BARO의 시작" },
  { href: "#blue-app-reveal", label: "앱 둘러보기" },
  { href: "#try-baro", label: "직접 체험하기" },
  { href: "#everyday-future", label: "우리가 바꾸는 일상" },
  { href: "#from-our-ceo", label: "CEO 인사말" },
];
const chapters = [
  links[0],
  links[1],
  { href: "#logo-experience", label: "로고 속 기능" },
  { href: "#try-baro", label: "직접 체험" },
  { href: "#clarity", label: "걱정에서 준비로" },
  { href: "#phone-story", label: "내 손안의 BARO" },
  { href: "#time-experience", label: "당신의 시간" },
  links[4],
  { href: "#everyday-future", label: "달라지는 일상" },
  { href: "#start-with-baro", label: "더 간단한 시작" },
].filter((value): value is { href: string; label: string } => Boolean(value));
function MenuContents({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className={s("landing-menu-content")}>
      <nav className={s("landing-menu-primary")} aria-label="전체 메뉴">
        {links.map((link) => (
          <a key={link.href} href={link.href} onClick={onNavigate}>
            {link.label}
          </a>
        ))}
      </nav>
      <nav className={s("landing-menu-secondary")} aria-label="더 둘러보기">
        {/* biome-ignore lint/a11y/useValidAnchor: Closing the menu retains native in-page anchor navigation. */}
        <a href="#phone-story" onClick={onNavigate}>
          내 손안의 BARO
        </a>
        {/* biome-ignore lint/a11y/useValidAnchor: Closing the menu retains native in-page anchor navigation. */}
        <a href="#time-experience" onClick={onNavigate}>
          당신의 시간
        </a>
        {/* biome-ignore lint/a11y/useValidAnchor: Closing the menu retains native in-page anchor navigation. */}
        <a href="#start-with-baro" onClick={onNavigate}>
          더 간단한 시작
        </a>
        <a href="/new" onClick={onNavigate}>
          내 사건 준비하기 <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      </nav>
      <a className={s("landing-menu-login")} href="/login" onClick={onNavigate}>
        로그인하고 시작하기{" "}
        <span className={s("landing-menu-link-arrow")}>
          <ArrowUpRight size={14} aria-hidden="true" />
        </span>
      </a>
    </div>
  );
}
export default function LandingNavigation() {
  const ready = useClientReady();
  const [open, setOpen] = useState(false),
    [closing, setClosing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null),
    dismiss = useRef<HTMLButtonElement>(null),
    brand = useRef<HTMLDivElement>(null);
  const timer = useRef(0),
    openingScroll = useRef<{ left: number; top: number } | null>(null),
    restore = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const nativeMenu = useRef<HTMLDetailsElement | null>(null);
  const returnNativeFocus = useRef(false);
  const rememberNativeMenu = useCallback((node: HTMLDetailsElement | null) => {
    if (!node && nativeMenu.current?.contains(document.activeElement))
      returnNativeFocus.current = true;
    nativeMenu.current = node;
  }, []);
  useLayoutEffect(() => {
    if (ready && returnNativeFocus.current) {
      returnNativeFocus.current = false;
      trigger.current?.focus({ preventScroll: true });
    }
  }, [ready]);
  const progress = useRef<HTMLDivElement>(null);
  const chapterNav = useRef<HTMLElement>(null);
  useEffect(() => {
    // Start after hydration: this island owns both the rail and header progress.
    const links = [...(chapterNav.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])].map(
      (link) => ({ link, section: document.querySelector<HTMLElement>(link.hash) }),
    );
    let frame = 0;
    const render = () => {
      frame = 0;
      const viewport = window.innerHeight;
      const range = Math.max(1, document.documentElement.scrollHeight - viewport);
      const value = Math.max(0, Math.min(1, window.scrollY / range));
      progress.current?.style.setProperty("--page-progress", String(value));
      let current: HTMLAnchorElement | undefined;
      for (const chapter of links)
        if (chapter.section && chapter.section.getBoundingClientRect().top <= viewport * 0.45)
          current = chapter.link;
      for (const { link } of links) {
        if (link === current) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("pageshow", schedule);
    schedule();
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pageshow", schedule);
    };
  }, []);
  const finishClose = useCallback((restoreFocus = false) => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    restore.current = restoreFocus;
    setClosing(false);
    setOpen(false);
    document.documentElement.classList.remove("landing-menu-is-open");
  }, []);
  const close = () => {
    if (!open || timer.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) finishClose(true);
    else {
      setClosing(true);
      timer.current = window.setTimeout(() => finishClose(true), 180);
    }
  };
  useEffect(() => {
    if (!open && restore.current) {
      restore.current = false;
      const frame = requestAnimationFrame(() => {
        if (matchMedia("(max-width: 1023px)").matches) {
          trigger.current?.focus({ preventScroll: true });
          if (openingScroll.current)
            window.scrollTo({ ...openingScroll.current, behavior: "instant" });
        }
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);
  useEffect(() => {
    const mobile = matchMedia("(max-width: 1023px)");
    const resize = () => {
      if (!mobile.matches && openRef.current) {
        finishClose();
        brand.current?.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });
      }
    };
    const leave = () => finishClose();
    mobile.addEventListener("change", resize);
    window.addEventListener("pagehide", leave);
    return () => {
      mobile.removeEventListener("change", resize);
      window.removeEventListener("pagehide", leave);
      window.clearTimeout(timer.current);
      document.documentElement.classList.remove("landing-menu-is-open");
    };
  }, [finishClose]);
  return (
    <>
      <header className={s("landing-header")}>
        <div className={s("landing-nav-wrap")}>
          <div ref={brand} className="contents">
            <LandingBrand />
          </div>
          <nav className={s("landing-nav")} aria-label="메인 메뉴">
            {links.map((link) => (
              <a key={link.href} className={s("landing-nav-section")} href={link.href}>
                {link.label}
              </a>
            ))}
            {ready ? (
              <LandingButton
                ref={trigger}
                variant="custom"
                className={s("landing-mobile-menu-trigger")}
                data-landing-menu-trigger=""
                aria-label="페이지 메뉴"
                aria-haspopup="dialog"
                aria-controls="landing-menu-dialog"
                aria-expanded={open}
                onPointerDown={(event) => {
                  if (event.button === 0) {
                    event.preventDefault();
                    event.currentTarget.focus({ preventScroll: true });
                  }
                }}
                onClick={() => {
                  if (!matchMedia("(max-width: 1023px)").matches) return;
                  openingScroll.current = { left: scrollX, top: scrollY };
                  document.documentElement.classList.add("landing-menu-is-open");
                  setOpen(true);
                }}
              >
                <Menu size={22} aria-hidden="true" />
              </LandingButton>
            ) : (
              // A visitor may toggle the native menu before hydration; its open state is browser-owned.
              <details
                ref={rememberNativeMenu}
                className={s("landing-mobile-menu")}
                data-landing-menu=""
                suppressHydrationWarning
              >
                <summary aria-label="페이지 메뉴">
                  <Menu className={s("landing-menu-open-icon")} size={22} aria-hidden="true" />
                  <X className={s("landing-menu-close-icon")} size={22} aria-hidden="true" />
                </summary>
                <div className={s("landing-mobile-menu-panel")} data-landing-menu-panel="">
                  <MenuContents />
                </div>
              </details>
            )}
            <a className={s("landing-login")} href="/login">
              로그인 <ArrowRight size={16} aria-hidden="true" />
            </a>
          </nav>
        </div>
        <div ref={progress} className={s("landing-scroll-progress")} aria-hidden="true" />
      </header>
      {ready && (
        <Dialog
          open={open}
          onClose={close}
          initialFocus={dismiss}
          className={s(`landing-menu-dialog z-[1000] ${closing ? "is-closing" : ""}`)}
          id="landing-menu-dialog"
          data-landing-menu-dialog=""
          data-open={open}
        >
          <DialogPanel className={s("landing-mobile-menu-panel")} data-landing-menu-panel="">
            <DialogTitle className="sr-only">BARO 전체 메뉴</DialogTitle>
            <LandingButton
              ref={dismiss}
              variant="custom"
              className={s("landing-menu-dismiss")}
              data-landing-menu-dismiss=""
              aria-label="메뉴 닫기"
              onClick={close}
            >
              <X size={26} aria-hidden="true" />
            </LandingButton>
            <MenuContents onNavigate={() => finishClose()} />
          </DialogPanel>
        </Dialog>
      )}
      <nav
        ref={chapterNav}
        className={s("landing-chapter-nav")}
        aria-label="페이지 구간"
        data-chapter-nav=""
      >
        {chapters.map((chapter) => (
          <a key={chapter.href} href={chapter.href} aria-label={`${chapter.label} 구간으로 이동`}>
            <i aria-hidden="true" />
            <span>{chapter.label}</span>
          </a>
        ))}
      </nav>
    </>
  );
}
