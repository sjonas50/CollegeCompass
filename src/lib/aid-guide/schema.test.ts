import { describe, expect, it } from "vitest";
import { guideFixture, sectionFixture } from "./fixtures";
import { AID_GUIDE_SECTION_IDS, parseGuide } from "./schema";

const good = guideFixture();
const [first, second] = good.sections;

/** The guide with its first section patched. */
const withSection = (patch: object) => ({ ...good, sections: [{ ...first, ...patch }, second] });
/** The guide whose first section has just this one block. */
const withBlock = (block: object) => withSection({ blocks: [block] });

function issuesFor(raw: unknown): string[] {
  const result = parseGuide(raw, "en.json");
  return result.ok ? [] : result.issues;
}

describe("aid guide content format", () => {
  it("accepts a well-formed guide with every kind of block", () => {
    const result = parseGuide(good, "en.json");
    expect(result.ok).toBe(true);
    expect(new Set(first.blocks.map((b) => b.kind))).toEqual(new Set(["paragraph", "list", "steps", "tip", "warning"]));
  });

  it("accepts any subset of the planned sections, in order, while the guide is being written", () => {
    expect(parseGuide(guideFixture("en", ["fafsa-step-by-step"]), "en.json").ok).toBe(true);
    expect(parseGuide(guideFixture("en", [...AID_GUIDE_SECTION_IDS]), "en.json").ok).toBe(true);
  });

  it("accepts a counselor-reviewed guide that says who reviewed it and when", () => {
    const reviewed = { ...good, review: { status: "counselor-reviewed", reviewedBy: "A. Counselor", reviewedOn: "2026-10-01" } };
    expect(parseGuide(reviewed, "en.json").ok).toBe(true);
  });

  it("trims text", () => {
    const result = parseGuide(withSection({ title: "  How aid works  " }), "en.json");
    expect(result.ok && result.guide.sections[0].title).toBe("How aid works");
  });

  const { language: _language, ...noLanguage } = good;
  const bad: [string, unknown, string][] = [
    ["a missing language", noLanguage, "en.json language:"],
    ["an unknown language", { ...good, language: "fr" }, "en.json language:"],
    ["an impossible date", { ...good, updated: "2026-13-40" }, "en.json updated: Use a real date"],
    ["a date in another format", { ...good, updated: "Sept 1, 2026" }, "en.json updated: Use a real date"],
    ["an unknown review status", { ...good, review: { status: "approved" } }, "review.status"],
    ["a reviewed guide with no reviewer", { ...good, review: { status: "counselor-reviewed", reviewedOn: "2026-10-01" } }, "review.reviewedBy: Say who"],
    ["a reviewed guide with no date", { ...good, review: { status: "counselor-reviewed", reviewedBy: "A. Counselor" } }, "review.reviewedOn: Say when"],
    ["no sections", { ...good, sections: [] }, "en.json sections: The guide needs at least one section."],
    ["an unknown section id", withSection({ id: "win-the-lottery" }), 'sections.0.id: Unknown section id "win-the-lottery"'],
    ["a section id that isn't kebab-case", withSection({ id: "How-Aid-Works" }), "sections.0.id: Unknown section id"],
    ["a repeated section", { ...good, sections: [first, first] }, 'sections.1.id: Section "how-aid-works" appears more than once.'],
    ["sections out of order", { ...good, sections: [second, first] }, 'sections.1.id: Section "how-aid-works" is out of order.'],
    ["an empty title", withSection({ title: "   " }), "sections.0.title: Can't be empty."],
    ["a missing summary", withSection({ summary: undefined }), "sections.0.summary"],
    ["a very long summary", withSection({ summary: "word ".repeat(100) }), "sections.0.summary: Keep this under 240 characters."],
    ["a section with no blocks", withSection({ blocks: [] }), "sections.0.blocks: A section needs at least one block."],
    ["an unknown block kind", withBlock({ kind: "video", text: "Watch this." }), "sections.0.blocks.0"],
    ["a paragraph without text", withBlock({ kind: "paragraph" }), "sections.0.blocks.0.text"],
    ["a paragraph with items", withBlock({ kind: "paragraph", text: "Hi.", items: ["x"] }), "sections.0.blocks.0"],
    ["a list without items", withBlock({ kind: "list", heading: "Things" }), "sections.0.blocks.0.items"],
    ["an empty list", withBlock({ kind: "steps", items: [] }), "sections.0.blocks.0.items: A list needs at least one item."],
    ["a list item that is empty", withBlock({ kind: "list", items: ["ok", ""] }), "sections.0.blocks.0.items.1: Can't be empty."],
    ["steps written as text", withBlock({ kind: "steps", text: "1. Do this" }), "sections.0.blocks.0"],
    ["a tip with items", withBlock({ kind: "tip", items: ["x"] }), "sections.0.blocks.0"],
    ["HTML in text", withBlock({ kind: "paragraph", text: 'Go to <a href="https://evil.example">FAFSA</a>.' }), "Plain text only"],
    ["a script tag", withBlock({ kind: "warning", text: "<script>alert(1)</script>" }), "Plain text only"],
    ["a Markdown link", withBlock({ kind: "paragraph", text: "Go to [FAFSA](https://studentaid.gov)." }), "Plain text only"],
    ["an unknown block field", withBlock({ kind: "tip", text: "Hi.", html: "<b>Hi</b>" }), "sections.0.blocks.0"],
    ["no sources", withSection({ sources: [] }), "sections.0.sources: Every section lists where its information comes from."],
    ["an http source", withSection({ sources: [{ title: "FSA", url: "http://studentaid.gov" }] }), "sections.0.sources.0.url: Use a full https://"],
    ["a javascript: source", withSection({ sources: [{ title: "FSA", url: "javascript:alert(1)" }] }), "sections.0.sources.0.url"],
    ["a data: source", withSection({ sources: [{ title: "FSA", url: "data:text/html,hi" }] }), "sections.0.sources.0.url"],
    ["a source without https://", withSection({ sources: [{ title: "FSA", url: "studentaid.gov" }] }), "sections.0.sources.0.url"],
    ["a source with no title", withSection({ sources: [{ url: "https://studentaid.gov" }] }), "sections.0.sources.0.title"],
    ["an unknown top-level field", { ...good, author: "someone" }, "en.json"],
  ];

  it.each(bad)("rejects %s", (_name, raw, expected) => {
    const issues = issuesFor(raw);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).toContain(expected);
  });

  it("reports every problem at once, each with the file and the path to fix", () => {
    const raw = { ...good, updated: "soon", sections: [{ ...first, title: "", sources: [] }, sectionFixture("fafsa-step-by-step")] };
    const issues = issuesFor(raw);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^en\.json updated: /),
        expect.stringMatching(/^en\.json sections\.0\.title: /),
        expect.stringMatching(/^en\.json sections\.0\.sources: /),
      ]),
    );
  });
});
