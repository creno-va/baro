import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { CaseWorkspaceFrame } from "../src/components/ui/workspace-frame";
import { CaseNavigation } from "../src/components/workspace/CaseNavigation";
import { ComposerAddMenu } from "../src/product-ui/conversation/ComposerAddMenu";
import { ConversationComposer } from "../src/product-ui/conversation/ConversationComposer";

function elementTags(markup: string) {
  return [...markup.matchAll(/<[a-z][^<>]*>/gi)]
    .map(([tag]) => tag.replace(/"[^"]*"|'[^']*'/g, '""'))
    .join("");
}

describe("conversation view native contracts", () => {
  test("the composer has a native labelled textarea and submit without running supplied actions", () => {
    let actions = 0;
    const markup = renderToString(
      <ConversationComposer
        formProps={{
          onSubmit: () => {
            actions++;
          },
        }}
        textareaProps={{
          id: "workspace-message",
          name: "message",
          rows: 1,
          maxLength: 20000,
          value: "<script>synthetic()</script>",
          onChange: () => {
            actions++;
          },
          onCompositionStart: () => {
            actions++;
          },
          onCompositionEnd: () => {
            actions++;
          },
          onKeyDown: () => {
            actions++;
          },
        }}
        addMenu={<button type="button">자료 추가 및 멘션</button>}
        sendDisabled={false}
        sending={false}
      />,
    );
    expect(actions).toBe(0);
    expect(markup).toContain("<form");
    expect(markup).toContain('noValidate=""');
    expect(markup).toContain('for="workspace-message"');
    expect(markup).toContain("추가 사실 또는 질문</label>");
    expect(markup).toContain('id="workspace-message"');
    expect(markup).toContain('name="message"');
    expect(markup).toContain('maxLength="20000"');
    expect(markup).toContain("&lt;script&gt;synthetic()&lt;/script&gt;</textarea>");
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('aria-label="보내기"');
    expect(markup).toContain('data-product-composer-send=""');
    expect(elementTags(markup)).not.toMatch(/<script\b|\s(?:style|on\w+)\s*=/i);
  });

  test("the owner can block submission while preserving an editable draft", () => {
    const markup = renderToString(
      <ConversationComposer
        formProps={{}}
        textareaProps={{ defaultValue: "보존할 합성 초안", "aria-invalid": true }}
        addMenu={null}
        sendDisabled
        sending={false}
      />,
    );
    const textarea = markup.match(/<textarea\b[^>]*>/)?.[0] ?? "";
    const submit = markup.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0] ?? "";
    expect(textarea).not.toContain('disabled=""');
    expect(textarea).toContain('aria-invalid="true"');
    expect(submit).toContain('disabled=""');
    expect(markup).toContain("보존할 합성 초안</textarea>");
  });

  test("busy state keeps attachment feedback and an explicitly named disabled submit", () => {
    const markup = renderToString(
      <ConversationComposer
        formProps={{}}
        textareaProps={{ disabled: true, defaultValue: "처리 중인 입력" }}
        attachments={
          <ul aria-label="이번 메시지의 첨부 파일">
            <li>합성 자료.txt</li>
          </ul>
        }
        uploadFeedback={<p role="status">첨부 파일을 처리하고 있어요.</p>}
        addMenu={null}
        sendDisabled
        sending
      />,
    );
    expect(markup).toContain('aria-label="이번 메시지의 첨부 파일"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="저장 중"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('disabled=""');
  });

  test("the add menu prehydration trigger is inert and no hidden styled portal is emitted", () => {
    let rendered = 0;
    const markup = renderToString(
      <ComposerAddMenu triggerRef={createRef<HTMLButtonElement>()}>
        {() => {
          rendered++;
          return <button type="button">자료 추가</button>;
        }}
      </ComposerAddMenu>,
    );
    expect(rendered).toBe(0);
    expect(markup).toContain('aria-label="자료 추가 및 멘션"');
    expect(markup).toContain('data-disclosure-button=""');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain("data-product-composer-menu-panel");
    expect(elementTags(markup)).not.toMatch(/\sstyle\s*=/i);
  });
});

describe("case chrome server boundary", () => {
  test("the frame keeps the caller's panel controls and omits portal content until hydration", () => {
    const markup = renderToString(
      <CaseWorkspaceFrame
        header={<h1>합성 사건</h1>}
        panel={<p>비공개 자료</p>}
        panelOpen
        panelId="synthetic-materials"
        onPanelOpenChange={() => {}}
      >
        <p>대화 본문</p>
      </CaseWorkspaceFrame>,
    );
    expect(markup).toContain("합성 사건</h1>");
    expect(markup).toContain("대화 본문</p>");
    expect(markup).toContain('aria-controls="synthetic-materials"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="자료 닫기"');
    expect(markup).not.toContain("비공개 자료");
    expect(markup).not.toContain('role="dialog"');
    expect(elementTags(markup)).not.toMatch(/\sstyle\s*=/i);
  });

  test("document mode preserves content and exposes no panel action without a panel", () => {
    const markup = renderToString(
      <CaseWorkspaceFrame kind="document" header={<h1>리포트</h1>}>
        <article>문서 본문</article>
      </CaseWorkspaceFrame>,
    );
    expect(markup).toContain("case-workspace--document");
    expect(markup).toContain("문서 본문</article>");
    expect(markup).not.toContain("aria-controls");
    expect(markup).not.toContain('aria-label="자료 열기"');
  });

  test("case navigation preserves encoded real destinations and treats titles as text", () => {
    const title = '<img src=x onerror="synthetic()">';
    const chat = renderToString(<CaseNavigation caseId="case /?#" title={title} active="chat" />);
    expect(chat).toContain('href="/cases/case%20%2F%3F%23/reports?mode=conversation"');
    expect(chat).not.toContain('aria-label="대화로 돌아가기"');
    expect(chat).toContain("&lt;img");
    expect(elementTags(chat)).not.toMatch(/\s(?:style|onerror|onclick)\s*=/i);
    const report = renderToString(
      <CaseNavigation caseId="synthetic-case" title="합성 리포트" active="reports" />,
    );
    expect(report).toContain('href="/cases/synthetic-case"');
    expect(report).toContain('aria-label="대화로 돌아가기"');
    expect(report).not.toContain("/reports?mode=conversation");
    expect(report).toContain('aria-label="사건 도구"');
  });
});
