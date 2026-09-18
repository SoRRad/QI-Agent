import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadLibraryDocs, parseFrontmatter } from "@/lib/content";

describe("parseFrontmatter", () => {
  it("reads scalars and lists", () => {
    const { data, body } = parseFrontmatter(
      [
        "---",
        "slug: local-charter",
        "title: GME Quality Improvement Committee Charter",
        "isLocal: true",
        "localFieldsRequired:",
        "  - The committee's formal name",
        "  - Quorum and decision rules",
        "---",
        "",
        "Body starts here.",
      ].join("\n"),
    );

    expect(data["slug"]).toBe("local-charter");
    expect(data["isLocal"]).toBe("true");
    expect(data["localFieldsRequired"]).toEqual([
      "The committee's formal name",
      "Quorum and decision rules",
    ]);
    expect(body).toBe("Body starts here.");
  });

  it("strips matching surrounding quotes but leaves inner punctuation", () => {
    const { data } = parseFrontmatter(
      ['---', 'title: "A quoted: title"', "other: it's fine", '---', "body"].join("\n"),
    );
    expect(data["title"]).toBe("A quoted: title");
    expect(data["other"]).toBe("it's fine");
  });

  it("treats a document with no frontmatter as all body", () => {
    const { data, body } = parseFrontmatter("# Just a heading\n\nText.");
    expect(data).toEqual({});
    expect(body).toBe("# Just a heading\n\nText.");
  });

  it("handles CRLF line endings", () => {
    const { data, body } = parseFrontmatter("---\r\nslug: x\r\n---\r\nbody\r\n");
    expect(data["slug"]).toBe("x");
    expect(body).toBe("body");
  });
});

describe("the seeded library", () => {
  const docs = loadLibraryDocs(join(process.cwd(), "content", "library"));

  it("ships the five standard documents and three local placeholders", () => {
    expect(docs).toHaveLength(8);
    expect(docs.filter((d) => d.isLocal)).toHaveLength(3);

    const slugs = docs.map((d) => d.slug).sort();
    expect(slugs).toEqual([
      "aim-statement-standard",
      "local-charter",
      "local-intake-requirements",
      "local-irb-determination",
      "measure-types",
      "pdsa-discipline",
      "run-charts-special-cause",
      "squire-outline",
    ]);
  });

  it("gives every document a title and a non-trivial body", () => {
    for (const doc of docs) {
      expect(doc.title.length, doc.slug).toBeGreaterThan(3);
      expect(doc.body.length, doc.slug).toBeGreaterThan(200);
    }
  });

  it("states the replacement requirement in the first line of every local placeholder", () => {
    // Q1: the first line must say the document must be replaced with
    // institutional policy. A placeholder that reads like real policy is worse
    // than no document at all.
    for (const doc of docs.filter((d) => d.isLocal)) {
      // The opening paragraph, not the first physical line: the markdown is
      // hard-wrapped, so the statement spans several lines.
      const opening = (doc.body.split(/\n\s*\n/)[0] ?? "").replaceAll("\n", " ");
      expect(opening, doc.slug).toMatch(/placeholder/i);
      expect(opening, doc.slug).toMatch(
        /must be replaced with (institutional policy|the institution's)/i,
      );
    }
  });

  it("lists the fields the institution must supply for every local placeholder", () => {
    for (const doc of docs.filter((d) => d.isLocal)) {
      expect(doc.localFieldsRequired.length, doc.slug).toBeGreaterThanOrEqual(5);
    }
  });

  it("declares no required institutional fields on the standard documents", () => {
    for (const doc of docs.filter((d) => !d.isLocal)) {
      expect(doc.localFieldsRequired, doc.slug).toEqual([]);
    }
  });

  it("encodes the five aim elements the intake validator keys off", () => {
    const aim = docs.find((d) => d.slug === "aim-statement-standard");
    expect(aim).toBeDefined();
    const body = aim?.body ?? "";
    // Wording may be edited by the committee; these five concepts may not
    // silently disappear, because the validator and the rubric depend on them.
    expect(body).toMatch(/direction and magnitude/i);
    expect(body).toMatch(/baseline/i);
    expect(body).toMatch(/population/i);
    expect(body).toMatch(/deadline/i);
    expect(body).toMatch(/numerator and denominator/i);
    // One passing and one failing example, per Q1.
    expect(body).toMatch(/## A passing example/);
    expect(body).toMatch(/## A failing example/);
  });
});
