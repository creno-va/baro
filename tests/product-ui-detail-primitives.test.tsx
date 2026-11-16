import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { Dialog } from "../src/product-ui/Dialog";
import { Disclosure, DisclosureSummary } from "../src/product-ui/Disclosure";
import { SelectField } from "../src/product-ui/Select";
import { definedProps } from "../src/product-ui/utils";

describe("detail form server boundaries", () => {
  test("select names, descriptions and errors identify the selected value before hydration", () => {
    const changes: string[] = [];
    const markup = renderToString(
      <SelectField
        id="purpose"
        label="사건의 목적"
        description="원하는 도움을 골라주세요."
        error="목적을 다시 확인해 주세요."
        aria-describedby="outside-note"
        value="claim"
        options={[
          { value: "claim", label: "청구 준비" },
          { value: "review", label: "검토", disabled: true },
        ]}
        onValueChange={(value) => changes.push(value)}
      />,
    );
    expect(markup).toContain('for="purpose"');
    expect(markup).toContain('id="purpose"');
    expect(markup).toContain('aria-labelledby="purpose-label"');
    expect(markup).toContain('aria-describedby="outside-note purpose-description purpose-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-value="claim"');
    expect(markup).toContain("청구 준비");
    expect(markup).toMatch(/<button\b[^>]*\bdisabled=""/);
    expect(markup).not.toContain('role="option"');
    expect(markup).not.toMatch(/\sstyle=|\son(?:change|click|load)=/i);
    expect(changes).toEqual([]);
  });

  test("multiple unnamed selects have independent labels and unknown values stay explicit", () => {
    const markup = renderToString(
      <>
        <SelectField label="첫 목적" value="missing" options={[]} onValueChange={() => {}} />
        <SelectField label="둘째 목적" value="a" options={[]} onValueChange={() => {}} />
      </>,
    );
    const buttons = [...markup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    const labels = [...markup.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
    expect(buttons).toHaveLength(2);
    expect(new Set(buttons).size).toBe(2);
    expect(labels).toEqual(buttons);
    expect(markup.match(/선택해 주세요/g)).toHaveLength(2);
    expect(markup).not.toMatch(/\saria-invalid=/);
  });

  test("select content treats saved values, labels and diagnostics as text", () => {
    const text = '<img src=x onerror="synthetic()">';
    const markup = renderToString(
      <SelectField
        label={text}
        value={text}
        options={[{ value: text, label: text }]}
        description={text}
        error={text}
        onValueChange={() => {}}
      />,
    );
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img");
    expect(markup).not.toMatch(/\s(?:style|onerror|onload|onclick)="/i);
  });

  test("disclosures preserve a closed draft while exposing native heading controls", () => {
    for (const open of [false, true]) {
      const markup = renderToString(
        <Disclosure open={open}>
          <DisclosureSummary>
            <h3>자료 검토</h3>
          </DisclosureSummary>
          <textarea aria-label="저장 전 설명" defaultValue="보존할 합성 초안" />
        </Disclosure>,
      );
      expect(markup).toContain(`<h3><button`);
      expect(markup).toContain('type="button"');
      expect(markup).toContain(`aria-expanded="${open}"`);
      expect(markup).toContain('aria-label="저장 전 설명"');
      expect(markup).toContain("보존할 합성 초안</textarea>");
      expect(markup.includes('hidden=""')).toBe(!open);
      expect(markup).not.toMatch(/\sstyle=|\son(?:click|toggle)=/i);
    }
  });

  test("dialog portal options do not serialize hidden editors or focus side effects", () => {
    const focus = createRef<HTMLElement>();
    let closed = 0;
    for (const open of [false, true]) {
      const markup = renderToString(
        <Dialog
          open={open}
          onClose={() => closed++}
          title="설명 변경"
          returnFocusRef={focus}
          preserveMounted
          showCloseButton={false}
          panelProps={{ "aria-busy": true }}
        >
          <textarea aria-label="합성 설명" defaultValue="local draft" />
        </Dialog>,
      );
      expect(markup).toBe("");
    }
    expect(focus.current).toBeNull();
    expect(closed).toBe(0);
  });

  test("defined optional props retain native callback identity and falsy values", () => {
    const callback = () => "same callback";
    const input = { empty: "", disabled: false, count: 0, onClick: callback, absent: undefined };
    const result = definedProps(input);
    expect(result).toEqual({ empty: "", disabled: false, count: 0, onClick: callback });
    expect(result.onClick).toBe(callback);
    expect(Object.hasOwn(result, "absent")).toBe(false);
    expect(Object.hasOwn(input, "absent")).toBe(true);
  });
});
