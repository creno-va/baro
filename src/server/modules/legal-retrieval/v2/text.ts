import { RetrievalFailure } from "./contracts";
export function entities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_, value: string) => {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    };
    if (Object.hasOwn(named, value)) return named[value] ?? "";
    if (!value.startsWith("#")) throw new RetrievalFailure("schema_mismatch");
    const code =
      value[1]?.toLowerCase() === "x"
        ? Number.parseInt(value.slice(2), 16)
        : Number(value.slice(1));
    if (
      !Number.isInteger(code) ||
      code <= 0 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      throw new RetrievalFailure("schema_mismatch");
    return String.fromCodePoint(code);
  });
}
type Token =
  | { type: "text"; text: string }
  | {
      type: "tag";
      name: string;
      closing: boolean;
      attributes: Record<string, string>;
      selfClosing: boolean;
    };
export function* htmlTokens(html: string): Generator<Token> {
  let index = 0,
    count = 0;
  while (index < html.length) {
    if (++count > 100000) throw new RetrievalFailure("too_large");
    if (html[index] !== "<") {
      const end = html.indexOf("<", index),
        to = end < 0 ? html.length : end;
      yield { type: "text", text: html.slice(index, to) };
      index = to;
      continue;
    }
    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      if (end < 0) throw new RetrievalFailure("schema_mismatch");
      index = end + 3;
      continue;
    }
    let end = index + 1,
      quote = "";
    for (; end < html.length; end++) {
      const c = html[end];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (end === html.length || end - index > 8192) throw new RetrievalFailure("schema_mismatch");
    const raw = html.slice(index + 1, end);
    index = end + 1;
    if (raw.startsWith("!") || raw.startsWith("?")) continue;
    const match = /^(\/)?\s*([a-z][a-z0-9:-]*)([\s\S]*)$/i.exec(raw);
    if (!match) throw new RetrievalFailure("schema_mismatch");
    const attributes: Record<string, string> = Object.create(null);
    for (const attr of (match[3] ?? "").matchAll(
      /([a-z_:][a-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/]+))/gi,
    )) {
      const key = (attr[1] ?? "").toLowerCase();
      if (key in attributes) throw new RetrievalFailure("schema_mismatch");
      attributes[key] = entities(attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const name = (match[2] ?? "").toLowerCase(),
      closing = !!match[1],
      selfClosing = /\/$/.test(raw);
    yield { type: "tag", name, closing, attributes, selfClosing };
    // Raw-text contents never become metadata, even with fake HTML in JS strings.
    if (!closing && !selfClosing && ["script", "style", "iframe"].includes(name)) {
      const closingTag = new RegExp(`</${name}\\s*>`, "ig");
      closingTag.lastIndex = index;
      const endTag = closingTag.exec(html);
      if (!endTag) throw new RetrievalFailure("schema_mismatch");
      index = endTag.index;
    }
  }
}
export function* visibleTokens(html: string): Generator<Token> {
  const active = new Set(["script", "style", "iframe", "object", "template", "svg", "noscript"]),
    stack: string[] = [];
  for (const token of htmlTokens(html)) {
    if (token.type === "tag") {
      if (token.closing && stack.at(-1) === token.name) {
        stack.pop();
        continue;
      }
      if (
        !token.closing &&
        (active.has(token.name) ||
          (token.name === "label" && token.attributes.class === "labelnone"))
      ) {
        if (!stack.length && ["svg", "object", "iframe", "noscript"].includes(token.name))
          yield {
            type: "tag",
            name: "omitted_visual",
            closing: false,
            attributes: {},
            selfClosing: true,
          };
        if (!token.selfClosing) stack.push(token.name);
        continue;
      }
    }
    if (!stack.length) yield token;
  }
  if (stack.length) throw new RetrievalFailure("schema_mismatch");
}
const normalize = (text: string) =>
  text
    .split("\n")
    .map((v) => v.replace(/[\t\r ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
export function plainText(html: string) {
  let text = "";
  for (const token of visibleTokens(html)) {
    if (token.type === "tag") {
      if (/^(br|div|p|li|tr|h[1-6])$/.test(token.name)) text += "\n";
    } else text += entities(token.text);
  }
  return normalize(text);
}
export function titleText(html: string) {
  let found = false,
    inside = false,
    text = "";
  for (const token of visibleTokens(html)) {
    if (token.type === "tag" && token.name === "title") {
      if (token.closing) inside = false;
      else {
        if (found) throw new RetrievalFailure("schema_mismatch");
        found = true;
        inside = true;
      }
    } else if (inside && token.type === "text") text += entities(token.text);
  }
  if (!found || inside || !text.trim()) throw new RetrievalFailure("schema_mismatch");
  return text.trim();
}
export function containerText(html: string, id: string) {
  let found = false,
    depth = 0,
    text = "",
    images = false;
  for (const token of visibleTokens(html)) {
    if (token.type === "tag" && !token.closing && token.attributes.id === id) {
      if (found || token.name !== "div") throw new RetrievalFailure("schema_mismatch");
      found = true;
      depth = 1;
      continue;
    }
    if (!depth) continue;
    if (token.type === "tag") {
      if (token.name === "div") depth += token.closing ? -1 : token.selfClosing ? 0 : 1;
      if (!depth) continue;
      if (token.name === "omitted_visual") images = true;
      if (token.name === "img" && !token.closing) {
        const src = token.attributes.src ?? "";
        const decorative =
          /^(?:https:\/\/www\.easylaw\.go\.kr)?\/(?:CSP\/images\/icon_arrow\d+\.gif|common\/images\/etc\/btn_(?:copy_address2|bookmark2)\.gif)$/.test(
            src,
          );
        if (!decorative) images = true;
      }
      if (/^(br|div|p|li|tr|h[1-6])$/.test(token.name)) text += "\n";
    } else text += entities(token.text);
  }
  if (!found || depth) throw new RetrievalFailure("schema_mismatch");
  text = normalize(text);
  if (!text) throw new RetrievalFailure("unsupported_format");
  return { text, images };
}
