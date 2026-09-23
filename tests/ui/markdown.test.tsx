import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, parseMarkdown } from "@/components/ui/Markdown";
import { loadLibraryDocs } from "@/lib/content";

describe("parseMarkdown", () => {
  it("parses the block types the library uses", () => {
    const blocks = parseMarkdown(
      ["## Heading", "", "A paragraph", "over two lines.", "", "> A quote", "> continued", "", "1. One", "2. Two", "", "- Bullet", "  wrapped"].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "quote", "list", "list"]);
    expect(blocks[1]).toMatchObject({ text: "A paragraph over two lines." });
    expect(blocks[2]).toMatchObject({ text: "A quote continued" });
    expect(blocks[3]).toMatchObject({ ordered: true, items: ["One", "Two"] });
    expect(blocks[4]).toMatchObject({ ordered: false, items: ["Bullet wrapped"] });
  });

  it("renders every seeded library document without losing text", () => {
    for (const doc of loadLibraryDocs()) {
      const html = renderToStaticMarkup(<Markdown source={doc.body} />);
      expect(html.length, doc.slug).toBeGreaterThan(doc.body.length / 2);
    }
  });
});

describe("safety", () => {
  it("never injects HTML from the source", () => {
    const html = renderToStaticMarkup(
      <Markdown source={'<script>alert(1)</script>\n\n**<img src=x onerror=alert(1)>**\n\n> <iframe src="x">'} />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("inline formatting", () => {
  it("renders bold, italic and code", () => {
    const html = renderToStaticMarkup(<Markdown source="Use **bold**, *italic* and `code`." />);
    expect(html).toContain('<strong class="font-semibold text-ink">bold</strong>');
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain(">code</code>");
  });

  it("leaves a lone asterisk alone", () => {
    const html = renderToStaticMarkup(<Markdown source="5 * 3 is not emphasis" />);
    expect(html).toContain("5 * 3 is not emphasis");
  });
});
