import { Fragment, useMemo } from "react";

/** Display published text only. React escapes every fragment; model text never
 * becomes HTML, a remote image, or an executable link. */
export function MessageContent({ text, revealing = false }: { text: string; revealing?: boolean }) {
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
      className="workspace-message-content"
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
