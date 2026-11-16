import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Brand, Button, Dialog, Empty, Loading, Problem } from "../src/components/web/Primitives";

describe("rebuilt web controls under the strict script/style policy", () => {
  test("form controls preserve submit intent, disabled state, and caller ARIA without inline style", () => {
    const markup = renderToString(
      <form>
        <label id="synthetic-save-label" htmlFor="synthetic-save">
          사건 요약 저장
        </label>
        <p id="synthetic-save-description">내용을 확인한 뒤 저장하세요.</p>
        <Button
          id="synthetic-save"
          type="submit"
          disabled
          aria-labelledby="synthetic-save-label"
          aria-describedby="synthetic-save-description"
          variant="primary"
        >
          저장 중
        </Button>
        <Button variant="secondary">수정 취소</Button>
        <Button variant="danger" disabled>
          삭제
        </Button>
      </form>,
    );
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-labelledby="synthetic-save-label"');
    expect(markup).toContain('aria-describedby="synthetic-save-description"');
    expect(markup).not.toMatch(/\sstyle=/i);
  });

  test("loading and recoverable errors announce status while keeping retry controls actionable", () => {
    const markup = renderToString(
      <>
        <Loading>리포트 저장 결과를 확인하고 있어요.</Loading>
        <Problem error={new Error("다시 확인해 주세요.")} retry={() => {}} />
      </>,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("리포트 저장 결과를 확인하고 있어요.");
    expect(markup).toContain("다시 확인하기");
    expect(markup).not.toMatch(/\sstyle=/i);
  });

  test("untrusted titles render as text and navigation keeps usable links before hydration", () => {
    const markup = renderToString(
      <>
        <Brand />
        <Empty title={'<script>alert("synthetic")</script>'} action={<a href="/new">새 이야기</a>}>
          저장한 내용을 확인해 주세요.
        </Empty>
      </>,
    );
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/new"');
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toMatch(/\sstyle=/i);
  });

  test("Headless dialog server output introduces no executable or inline style attributes", () => {
    const markup = renderToString(
      <Dialog title="사건 삭제 확인" onClose={() => {}}>
        <p>명시적인 확인 후 삭제합니다.</p>
      </Dialog>,
    );
    expect(markup).not.toMatch(/\sstyle=/i);
    expect(markup).not.toMatch(/\son(?:click|submit|load)=/i);
  });
});
