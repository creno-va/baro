import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Dialog } from "../src/components/ui/dialog";
import { Disclosure, DisclosureSummary } from "../src/components/ui/disclosure";
import { Input, Select } from "../src/components/ui/form";
import { Popover, PopoverButton, PopoverPanel } from "../src/components/ui/popover";
import { Tabs } from "../src/components/ui/tabs";
import { ThemeToggle } from "../src/components/ui/theme-toggle";
import { CaseWorkspaceFrame } from "../src/components/ui/workspace-frame";

test("web controls preserve strict style-attribute CSP during server rendering", () => {
  const markup = renderToString(
    <>
      <Input aria-label="사건 이름" defaultValue="합성 사건" />
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
});
