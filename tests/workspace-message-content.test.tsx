import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageContent } from "../src/components/workspace/MessageContent";

test("chat prose groups spaced lists and preserves numbered steps and inline emphasis", () => {
  const html = renderToStaticMarkup(
    <MessageContent
      text={
        "## 확인한 내용\n\n**계약서**를 확인했어요.\n날짜는 `2026-11-08`입니다.\n\n3. 송금 확인\n\n4. 연락 기록\n\n- 계약서\n\n- 메시지"
      }
    />,
  );
  expect(html).toContain("<h3>확인한 내용</h3>");
  expect(html).toContain("<strong>계약서</strong>");
  expect(html).toContain("<code>2026-11-08</code>");
  expect(html).toContain('<ol start="3"><li>송금 확인</li><li>연락 기록</li></ol>');
  expect(html).toContain("<ul><li>계약서</li><li>메시지</li></ul>");
});

test("published model text cannot create HTML, remote images or executable links", () => {
  const html = renderToStaticMarkup(
    <MessageContent
      text={
        '<img src="https://example.invalid/a" onerror="alert(1)">\n\n[열기](javascript:alert(1))\n\n![사진](https://example.invalid/photo)'
      }
    />,
  );
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<a");
  expect(html).toContain("![사진](https://example.invalid/photo)");
});

test("progressive reveal preserves incomplete text and ordinary source labels", () => {
  const html = renderToStaticMarkup(
    <MessageContent text={"자료의 기재 내용\n출처: 확인한 계약서\n\n**확인 중"} revealing />,
  );
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("출처: 확인한 계약서");
  expect(html).toContain("**확인 중");
  expect(html).not.toContain("<strong>");
});
