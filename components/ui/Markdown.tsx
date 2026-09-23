import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small Markdown renderer for library documents.
 *
 * It builds React elements directly and never injects HTML, so text a chair
 * types into a library document cannot carry a script or a tag onto the page —
 * safe by construction rather than by sanitising. It supports exactly what the
 * library uses: headings, paragraphs, bullet and numbered lists, block quotes,
 * **bold**, *italic* and `code`. Anything else renders as plain text.
 */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

export function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, text: heading[2] ?? "" });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        quoted.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: quoted.join(" ").replace(/\s+/g, " ").trim() });
      continue;
    }

    const listItem = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;
    if (listItem.test(line)) {
      const ordered = !!listItem.exec(line)?.[2];
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? "";
        const match = listItem.exec(current);
        if (match) {
          items.push(match[3] ?? "");
        } else if (current.trim() && /^\s+/.test(current) && items.length > 0) {
          // A wrapped continuation line belongs to the previous item.
          items[items.length - 1] += ` ${current.trim()}`;
        } else {
          break;
        }
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() && !/^(#{1,3}\s|>|\s*(?:[-*]|\d+[.)])\s)/.test(lines[i] ?? "")) {
      paragraph.push((lines[i] ?? "").trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

/** **bold**, *italic*, `code`. Everything else is literal text. */
export function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|(?<![\w*])\*[^*\s][^*]*?\*(?![\w*]))/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={i} className="bg-surface-sunken px-1 font-mono text-[0.85em]">{part.slice(1, -1)}</code>;
    if (/^\*[^*\s][^*]*\*$/.test(part)) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink">
      {parseMarkdown(source).map((block, i) => {
        switch (block.kind) {
          case "heading": {
            const className =
              block.level === 1
                ? "font-display text-xl font-bold"
                : block.level === 2
                  ? "mt-3 font-display text-lg font-semibold"
                  : "mt-2 font-semibold";
            const Tag = (`h${block.level + 1}` as "h2" | "h3" | "h4");
            return <Tag key={i} className={className}>{renderInline(block.text)}</Tag>;
          }
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-primary bg-surface-sunken/60 py-2 pr-3 pl-3 text-ink">
                {renderInline(block.text)}
              </blockquote>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={`flex flex-col gap-1.5 pl-5 ${block.ordered ? "list-decimal" : "list-disc"} marker:text-muted`}>
                {block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
              </Tag>
            );
          }
          case "paragraph":
            return <p key={i}>{renderInline(block.text)}</p>;
        }
      })}
    </div>
  );
}
