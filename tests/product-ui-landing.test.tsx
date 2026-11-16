import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import { renderToString } from "react-dom/server";
import DemoLab from "../src/product-ui/landing/DemoLab";
import { demoScenarios } from "../src/product-ui/landing/demo-content";
import LandingNavigation from "../src/product-ui/landing/LandingNavigation";
import { sceneUtilities } from "../src/product-ui/landing/scene-classes";
import BlueScene from "../src/product-ui/landing/scenes/BlueScene";
import CeoScene from "../src/product-ui/landing/scenes/CeoScene";
import ClarityScene from "../src/product-ui/landing/scenes/ClarityScene";
import EverydayScene from "../src/product-ui/landing/scenes/EverydayScene";
import FinaleScene from "../src/product-ui/landing/scenes/FinaleScene";
import FutureScene from "../src/product-ui/landing/scenes/FutureScene";
import HeroScene from "../src/product-ui/landing/scenes/HeroScene";
import LogoScene from "../src/product-ui/landing/scenes/LogoScene";
import OriginScene from "../src/product-ui/landing/scenes/OriginScene";
import PhoneScene from "../src/product-ui/landing/scenes/PhoneScene";
import TimeScene from "../src/product-ui/landing/scenes/TimeScene";

function elementTags(markup: string) {
  return markup.match(/<[a-z][^>]*>/gi) ?? [];
}
function expectSafeServerMarkup(markup: string) {
  for (const tag of elementTags(markup)) {
    expect(tag).not.toMatch(/\s(?:style|on\w+)\s*=/i);
    expect(tag).not.toMatch(/\shref=["'](?:javascript|data):/i);
  }
}

describe("landing design port server contracts", () => {
  test("keeps a complete native navigation before Headless widgets mount", () => {
    const markup = renderToString(<LandingNavigation />);
    expect(markup).toContain('<details class="landing-mobile-menu');
    expect(markup).toContain('aria-label="페이지 메뉴"');
    expect(markup).toContain('aria-label="페이지 구간"');
    for (const href of [
      "/",
      "/login",
      "/new",
      "#our-beginning",
      "#blue-app-reveal",
      "#logo-experience",
      "#try-baro",
      "#clarity",
      "#phone-story",
      "#time-experience",
      "#from-our-ceo",
      "#everyday-future",
      "#start-with-baro",
    ])
      expect(markup).toContain(`href="${href}"`);
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("headlessui-focus-sentinel");
    expectSafeServerMarkup(markup);
  });

  test("local demo exposes its four readable steps and a real start link without JavaScript", () => {
    const markup = renderToString(<DemoLab />);
    expect(markup).toContain('id="try-baro"');
    expect(markup).toContain('aria-labelledby="demo-title"');
    for (const step of ["이야기하기", "자료 모으기", "흐름 정리하기", "상담 준비하기"])
      expect(markup).toContain(step);
    expect(markup).toContain('href="/new"');
    expect(markup).toContain("가상의 이용 예시예요.");
    expect(markup).not.toContain("headlessui-focus-sentinel");
    expect(markup).not.toContain("<form");
    expectSafeServerMarkup(markup);
  });

  test("all scenario timelines refer to existing synthetic materials", () => {
    expect(Object.keys(demoScenarios)).toEqual(["loan", "deposit", "wage"]);
    for (const scenario of Object.values(demoScenarios)) {
      expect(scenario.files).toHaveLength(3);
      expect(scenario.timeline).toHaveLength(3);
      expect(scenario.summary.length).toBeLessThanOrEqual(600);
      for (const event of scenario.timeline) {
        expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(scenario.files[event.file]?.title).toBeTruthy();
      }
    }
  });

  test("preserves the photographic clock and actual phone geometry rather than replacing them with screenshots", () => {
    const phone = renderToString(<PhoneScene />);
    expect(phone.match(/\sdata-phone-facet=/g)).toHaveLength(52);
    expect(phone.match(/\sdata-phone-camera-wall=/g)).toHaveLength(52);
    expect(phone.match(/\sdata-phone-lens-wall=/g)).toHaveLength(72);
    expect(phone.match(/\sdata-phone-step=/g)).toHaveLength(4);
    const clock = renderToString(
      <TimeScene imageSrc="/landing/time-watch.webp" imageFocusX={42} imageFocusY={48} />,
    );
    expect(clock).toContain('src="/landing/time-watch.webp"');
    expect(clock).toContain('data-time-focus-x="42"');
    expect(clock).toContain('data-time-focus-y="48"');
    expect(clock).not.toContain("time-clock-drawing");
    expectSafeServerMarkup(phone + clock);
  });

  test("scene content and media remain available before hydration with deferred video URLs", () => {
    const markup = renderToString(
      <>
        <HeroScene />
        <OriginScene />
        <BlueScene />
        <LogoScene />
        <ClarityScene />
        <EverydayScene />
        <CeoScene />
        <FutureScene />
        <FinaleScene />
      </>,
    );
    for (const id of [
      "landing-title",
      "our-beginning",
      "blue-app-reveal",
      "logo-experience",
      "clarity",
      "everyday",
      "from-our-ceo",
      "everyday-future",
      "start-with-baro",
    ])
      expect(markup).toContain(`id="${id}"`);
    for (const video of elementTags(markup).filter((tag) => tag.startsWith("<video"))) {
      expect(video).toContain('preload="none"');
      expect(video).toMatch(/\sdata-video-src="\/landing\//);
      expect(video).not.toMatch(/\ssrc=/);
      expect(video).toContain('muted=""');
      expect(video).toContain('playsInline=""');
    }
    expect(markup).toContain("막막했던 법률 문제,");
    expect(markup).toContain("이제 정리부터 가볍게.");
    expect(markup).toContain("처음 적었던 이름, 그 손글씨 그대로.");
    expectSafeServerMarkup(markup);
  });

  test("every extracted Tailwind declaration compiles in the independent landing entry", async () => {
    const root = resolve(import.meta.dir, "..");
    const entry = resolve(root, "src/product-ui/landing/styles/index.css");
    const compiler = await compile(await Bun.file(entry).text(), {
      base: resolve(root, "src/product-ui/landing/styles"),
      from: entry,
      onDependency: () => {},
    });
    const candidates = [
      ...new Set(Object.values(sceneUtilities).flatMap((value) => value.split(/\s+/))),
    ];
    const css = compiler.build(candidates);
    // A missing utility silently changes the preserved scene when legacy CSS is removed.
    // Building each candidate alone proves its utility rule exists independently.
    for (const candidate of candidates) {
      const isolated = await compile('@import "tailwindcss";', {
        base: root,
        onDependency: () => {},
      });
      const emptyLength = isolated.build([]).length;
      expect(isolated.build([candidate]).length, candidate).toBeGreaterThan(emptyLength);
    }
    expect(css).toContain("@font-face");
    expect(css).toContain("/fonts/PretendardVariable.woff2");
    expect(css).toContain("@keyframes landing-menu-appear");
  });
});
