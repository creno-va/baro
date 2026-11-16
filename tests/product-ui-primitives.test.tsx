import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { Button, ButtonLink } from "../src/product-ui/Button";
import { Dialog } from "../src/product-ui/Dialog";
import { InputField, TextareaField } from "../src/product-ui/Field";
import { cn } from "../src/product-ui/utils";

describe("product UI form primitives", () => {
  test("buttons preserve native submit, reset, disabled and accessible-name semantics", () => {
    const markup = renderToString(
      <form id="fixture-form">
        <Button type="submit" name="intent" value="save" disabled aria-describedby="save-note">
          저장 중
        </Button>
        <Button type="reset" variant="secondary">
          입력 초기화
        </Button>
        <Button variant="ghost">미리보기</Button>
        <Button variant="danger" size="sm">
          삭제
        </Button>
        <Button size="icon" aria-label="자료 닫기">
          ×
        </Button>
      </form>,
    );
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('type="reset"');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('name="intent"');
    expect(markup).toContain('value="save"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-describedby="save-note"');
    expect(markup).toContain('aria-label="자료 닫기"');
    expect(markup).not.toMatch(/\sstyle=|\son(?:click|submit|load)=/i);
  });

  test("field labels and descriptions have native associations before hydration", () => {
    const markup = renderToString(
      <>
        <p id="outside-note">공통 안내</p>
        <InputField
          id="case-name"
          name="caseName"
          label="사건 이름"
          description="알아보기 쉬운 이름을 적어주세요."
          error="이름을 입력해 주세요."
          aria-describedby="outside-note case-name-description"
          defaultValue="합성 사건"
          required
          form="fixture-form"
        />
      </>,
    );
    expect(markup).toContain('for="case-name"');
    expect(markup).toContain('id="case-name"');
    expect(markup).toContain('name="caseName"');
    expect(markup).toContain('form="fixture-form"');
    expect(markup).toContain('required=""');
    expect(markup).toContain('value="합성 사건"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(
      'aria-describedby="outside-note case-name-description case-name-error"',
    );
    expect(markup).toContain('id="case-name-description"');
    expect(markup).toContain('id="case-name-error"');
    expect(markup).toContain('role="alert"');
    expect(markup).not.toMatch(/\sstyle=|\son(?:change|input|load)=/i);
  });

  test("generated IDs connect multiple labels without a required caller ID", () => {
    const markup = renderToString(
      <>
        <InputField label="첫 번째 입력" />
        <InputField label="두 번째 입력" />
      </>,
    );
    const controls = [...markup.matchAll(/<input\b[^>]*\bid="([^"]+)"/g)].map((item) => item[1]);
    const labels = [...markup.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((item) => item[1]);
    expect(controls).toHaveLength(2);
    expect(new Set(controls).size).toBe(2);
    expect(labels).toEqual(controls);
  });

  test("textarea attributes, caller naming and invalid state remain native", () => {
    const markup = renderToString(
      <>
        <p id="alternate-label">외부 입력 이름</p>
        <TextareaField
          id="story"
          label="이야기"
          name="narrative"
          description="사실을 적어주세요."
          aria-labelledby="alternate-label"
          aria-invalid="grammar"
          rows={4}
          maxLength={5000}
          minLength={5}
          defaultValue="기억나는 이야기를 적습니다."
          disabled
          required
        />
        <InputField
          id="confirmed"
          type="checkbox"
          label="내용 확인"
          name="confirmed"
          checked
          readOnly
        />
      </>,
    );
    expect(markup).toContain('aria-labelledby="alternate-label"');
    expect(markup).toContain('aria-invalid="grammar"');
    expect(markup).toContain('aria-describedby="story-description"');
    expect(markup).toContain('rows="4"');
    expect(markup).toContain('maxLength="5000"');
    expect(markup).toContain('minLength="5"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('required=""');
    expect(markup).toContain('name="narrative"');
    expect(markup).toContain("기억나는 이야기를 적습니다.</textarea>");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('checked=""');
    expect(markup).not.toMatch(/\sstyle=/i);
  });

  test("button labels, descriptions and errors render untrusted text as text", () => {
    const text = '<img src=x onerror="synthetic()">';
    const markup = renderToString(
      <>
        <Button>{text}</Button>
        <InputField label={text} description={text} error={text} />
        <TextareaField label="메모" defaultValue={text} />
      </>,
    );
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img");
    expect(markup).not.toMatch(
      /<(?:script|iframe)\b|<[^>]+\s(?:style|onerror|onload|onclick)\s*=/i,
    );
  });
});

describe("product UI navigation and overlay boundaries", () => {
  test("links keep actual URLs and protect a newly opened tab", () => {
    const markup = renderToString(
      <>
        <ButtonLink href="/new">새 사건</ButtonLink>
        <ButtonLink href="#help" variant="ghost">
          도움말
        </ButtonLink>
        <ButtonLink href="https://example.test/guide" target="_blank" rel="external opener">
          외부 안내
        </ButtonLink>
        <ButtonLink href="mailto:help@example.test" size="sm">
          문의
        </ButtonLink>
      </>,
    );
    expect(markup).toContain('href="/new"');
    expect(markup).toContain('href="#help"');
    expect(markup).toContain('href="https://example.test/guide"');
    expect(markup).toContain('href="mailto:help@example.test"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="external noopener noreferrer"');
    expect(markup).not.toMatch(/\sstyle=/i);
  });

  test("disabled and executable URL links have no navigation destination", () => {
    for (const href of [
      "javascript:synthetic()",
      " JAVASCRIPT:synthetic()",
      "java\tscript:synthetic()",
      "data:text/html,synthetic",
      "",
      "https://[",
    ]) {
      const markup = renderToString(<ButtonLink href={href}>닫힌 링크</ButtonLink>);
      expect(markup).not.toMatch(/\shref=/i);
      expect(markup).toContain('aria-disabled="true"');
      expect(markup).toContain('tabindex="-1"');
    }
    const disabled = renderToString(
      <ButtonLink href="/new" disabled>
        새 사건
      </ButtonLink>,
    );
    expect(disabled).not.toMatch(/\shref=/i);
    expect(disabled).toContain('aria-disabled="true"');
  });

  test("dialog SSR never emits the styled pre-mount portal sentinel", () => {
    for (const open of [true, false]) {
      const markup = renderToString(
        <Dialog
          open={open}
          onClose={() => {}}
          title="검토 확인"
          description="확인 후 진행해 주세요."
          footer={<Button>확인</Button>}
        >
          <p>검토할 내용</p>
        </Dialog>,
      );
      expect(markup).toBe("");
      expect(markup).not.toMatch(/\sstyle=|\son(?:click|load)=/i);
    }
  });

  test("class composition keeps the caller's intended Tailwind overrides", () => {
    expect(cn("px-2", { hidden: false }, ["text-sm", null], "px-4")).toBe("text-sm px-4");
  });
});
