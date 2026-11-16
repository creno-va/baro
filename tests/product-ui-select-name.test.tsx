import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { SelectField } from "../src/product-ui/Select";

const options = [
  { value: "0.5", label: "0.5배" },
  { value: "1", label: "1배" },
  { value: "1.5", label: "1.5배" },
  { value: "2", label: "2배" },
];
function button(html: string, id: string) {
  const tag = [...html.matchAll(/<button\b[^>]*>/g)].find((match) =>
    match[0].includes(`id="${id}"`),
  )?.[0];
  if (!tag) throw new Error(`MISSING_SYNTHETIC_SELECT:${id}`);
  return tag;
}

describe("explicit native select names before hydration", () => {
  test("a playback name stays exact for every displayed rate without including selected text", () => {
    let changes = 0;
    for (const option of options) {
      const html = renderToString(
        <SelectField
          id="playback-rate"
          label="재생 속도"
          aria-label="재생 속도"
          value={option.value}
          options={options}
          onValueChange={() => changes++}
        />,
      );
      const control = button(html, "playback-rate");
      expect(control).toContain('aria-label="재생 속도"');
      expect(control).not.toContain("aria-labelledby=");
      expect(control).toContain(`data-value="${option.value}"`);
      expect(control).toContain('disabled=""');
      expect(html).toContain(`>${option.label}</span>`);
      expect(html).toContain('for="playback-rate"');
    }
    expect(changes).toBe(0);
  });

  test("callers without an explicit name retain the visible-label association and selected value", () => {
    const html = renderToString(
      <SelectField
        id="case-kind"
        label="사건 유형"
        value="civil"
        options={[{ value: "civil", label: "민사" }]}
        onValueChange={() => {}}
      />,
    );
    const control = button(html, "case-kind");
    expect(control).toContain('aria-labelledby="case-kind-label"');
    expect(control).not.toContain("aria-label=");
    expect(control).toContain('data-value="civil"');
    expect(html).toContain('id="case-kind-label"');
    expect(html).toContain('for="case-kind"');
    expect(html).toContain(">사건 유형</label>");
    expect(html).toContain(">민사</span>");
  });

  test("an explicit name preserves description/error associations and does not change a neighboring control", () => {
    const html = renderToString(
      <>
        <p id="audio-note">합성 음원 안내</p>
        <SelectField
          id="named-rate"
          label="속도 선택"
          aria-label="재생 속도"
          aria-describedby="audio-note"
          description="배속을 선택하세요."
          error="음원을 다시 확인해 주세요."
          value="1"
          options={options}
          onValueChange={() => {}}
        />
        <SelectField
          id="other-select"
          label="다른 선택"
          value="1.5"
          options={options}
          onValueChange={() => {}}
        />
      </>,
    );
    const named = button(html, "named-rate");
    const other = button(html, "other-select");
    expect(named).toContain('aria-label="재생 속도"');
    expect(named).not.toContain("aria-labelledby=");
    expect(named).toContain(
      'aria-describedby="audio-note named-rate-description named-rate-error"',
    );
    expect(named).toContain('aria-invalid="true"');
    expect(other).toContain('aria-labelledby="other-select-label"');
    expect(other).not.toContain("aria-label=");
    expect(other).not.toContain("named-rate");
    expect(html).toContain('id="named-rate-description"');
    expect(html).toContain('id="named-rate-error"');
    expect(html).not.toMatch(/\sstyle=|\son(?:click|change|focus)=/i);
  });
});
