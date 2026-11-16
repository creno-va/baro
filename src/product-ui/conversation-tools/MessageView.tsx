import { Fragment, useMemo } from "react";

/** Display published text only. React escapes every fragment; model text never
 * becomes HTML, a remote image, or an executable link. */
export function MessageView({ text, revealing = false }: { text: string; revealing?: boolean }) {
  const blocks = useMemo(() => {
    const result: {
      kind: "paragraph" | "heading" | "ordered" | "unordered";
      lines: string[];
      start?: number;
    }[] = [];
    let separated = true;
    for (const line of text.replace(/\r\n?/gu, "\n").split("\n")) {
      if (!line.trim()) {
        separated = true;
        continue;
      }
      const heading = /^#{1,6}\s+(.+)$/u.exec(line);
      const item = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/u.exec(line);
      const kind = heading ? "heading" : item ? (item[1] ? "unordered" : "ordered") : "paragraph";
      const value = heading?.[1] ?? item?.[3] ?? line;
      const start = item?.[2] ? Number(item[2]) : undefined;
      const previous = result.at(-1);
      const continuesList =
        kind === "unordered" ||
        (kind === "ordered" && start === (previous?.start ?? 1) + (previous?.lines.length ?? 0));
      if (previous?.kind === kind && ((!separated && kind === "paragraph") || continuesList))
        previous.lines.push(value);
      else result.push({ kind, lines: [value], ...(start !== undefined ? { start } : {}) });
      separated = false;
    }
    return result;
  }, [text]);
  const inline = (value: string) =>
    value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/u).map((part, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: Ordered text fragments have no independent state.
      <Fragment key={index}>
        {part.startsWith("**") && part.endsWith("**") ? (
          <strong>{part.slice(2, -2)}</strong>
        ) : part.startsWith("`") && part.endsWith("`") ? (
          <code>{part.slice(1, -1)}</code>
        ) : (
          part
        )}
      </Fragment>
    ));
  return (
    <div
      data-product-message-content=""
      className="min-w-0 space-y-3 text-sm leading-7 text-[var(--pui-text)] [overflow-wrap:anywhere] [&_code]:rounded [&_code]:bg-[var(--pui-background)] [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.92em] [&_strong]:font-semibold [&_h3]:pt-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-7 [&_p]:whitespace-pre-line [&_ol]:list-decimal [&_ul]:list-disc [&_ol]:space-y-1 [&_ul]:space-y-1 [&_ol]:pl-6 [&_ul]:pl-6"
      aria-busy={revealing}
      data-reply-revealing={revealing || undefined}
    >
      {blocks.map((block, index) => {
        // Text is append-only during reveal; indices keep existing reading nodes stable.
        const key = `${index}:${block.kind}`;
        if (block.kind === "heading") return <h3 key={key}>{inline(block.lines.join("\n"))}</h3>;
        if (block.kind === "paragraph") return <p key={key}>{inline(block.lines.join("\n"))}</p>;
        const List = block.kind === "ordered" ? "ol" : "ul";
        return (
          <List
            key={key}
            {...(block.start !== undefined && block.start !== 1 ? { start: block.start } : {})}
          >
            {block.lines.map((line, itemIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Published list items may repeat verbatim.
              <li key={itemIndex}>{inline(line)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
