import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Dialog } from "../src/components/ui/dialog";
import { Disclosure, DisclosureSummary } from "../src/components/ui/disclosure";
import { Input, Select, Textarea } from "../src/components/ui/form";
import { MediaPlayer } from "../src/components/ui/media-player";
import { Popover, PopoverButton, PopoverPanel } from "../src/components/ui/popover";
import { Range } from "../src/components/ui/range";
import { Tabs } from "../src/components/ui/tabs";
import { ThemeToggle } from "../src/components/ui/theme-toggle";
import { CaseWorkspaceFrame } from "../src/components/ui/workspace-frame";

test("web controls preserve strict style-attribute CSP during server rendering", () => {
  const markup = renderToString(
    <>
      <Input aria-label="사건 이름" defaultValue="합성 사건" />
      <Range label="재생 위치" value={0} max={20} onChange={() => {}} />
      <MediaPlayer kind="audio" src="/synthetic.wav" label="합성 녹음" />
      <Input type="checkbox" aria-label="확인" checked={false} onChange={() => {}} />
      <Select aria-label="자료 종류" value="text" onChange={() => {}}>
        <option value="text">텍스트</option>
      </Select>
      <Disclosure>
        <DisclosureSummary>검토 안내</DisclosureSummary>
        <p>자료를 확인하세요.</p>
      </Disclosure>
      <ThemeToggle />
      <Dialog open={false} onOpenChange={() => {}} title="검토">
        내용
      </Dialog>
      <Popover>
        <PopoverButton>도구</PopoverButton>
        <PopoverPanel>목록</PopoverPanel>
      </Popover>
      <Tabs label="사건 자료" items={[{ value: "files", label: "자료", content: "본문" }]} />
      <CaseWorkspaceFrame header={<h1>사건</h1>} panel={<p>자료</p>} panelOpen>
        <p>대화</p>
      </CaseWorkspaceFrame>
    </>,
  );
  expect(markup).not.toMatch(/\sstyle=/i);
  expect(markup).toContain('aria-label="사건 이름"');
  expect(markup).toContain('role="checkbox"');
  expect(markup).toContain('aria-haspopup="listbox"');
  expect(markup).toContain("대화");
  expect(markup).toContain('role="slider"');
  expect(markup).not.toMatch(/<(?:audio|video)[^>]*\bcontrols(?:\s|=|>)/);
});

test("Headless text controls retain caller error and description semantics", () => {
  for (const Control of [Input, Textarea]) {
    for (const invalid of [true, false]) {
      const markup = renderToString(
        <Control
          aria-labelledby="synthetic-label"
          aria-describedby="synthetic-help synthetic-error"
          aria-invalid={invalid}
        />,
      );
      expect(markup).toContain('aria-labelledby="synthetic-label"');
      expect(markup).toContain('aria-describedby="synthetic-help synthetic-error"');
      expect(markup).toContain(`aria-invalid="${invalid}"`);
      expect(markup).not.toMatch(/\sstyle=/i);
    }
  }
});

test("short original clips retain their fractional seek duration", () => {
  const markup = renderToString(
    <Range label="재생 위치" value={0.25} max={0.5} onChange={() => {}} />,
  );
  expect(markup).toContain('aria-valuemax="0.5"');
  expect(markup).toContain('aria-valuenow="0.25"');
});
