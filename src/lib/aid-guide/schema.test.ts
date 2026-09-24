import { describe, expect, it } from "vitest";
import { finishedSectionFixture, guideFixture, sectionFixture, wordsOf } from "./fixtures";
import { AID_GUIDE_LANGUAGES, AID_GUIDE_SECTION_IDS, type AidLanguage, LENGTH_LIMITS, parseGuide } from "./schema";

const good = guideFixture();
const [first, second] = good.sections;

/** The guide with its first section patched. */
const withSection = (patch: object) => ({ ...good, sections: [{ ...first, ...patch }, second] });
/** The guide whose first section has just this one block. */
const withBlock = (block: object) => withSection({ blocks: [block] });

function issuesFor(raw: unknown): string[] {
  const result = parseGuide(raw, "en");
  return result.ok ? [] : result.issues;
}

describe("aid guide content format", () => {
  it("accepts a well-formed guide with every kind of block", () => {
    const result = parseGuide(good, "en");
    expect(result.ok).toBe(true);
    expect(new Set(first.blocks.map((b) => b.kind))).toEqual(new Set(["paragraph", "list", "steps", "tip", "warning"]));
  });

  it("accepts any subset of the planned sections, in order, while the guide is being written", () => {
    expect(parseGuide(guideFixture("en", ["fafsa-step-by-step"]), "en").ok).toBe(true);
    expect(parseGuide(guideFixture("en", [...AID_GUIDE_SECTION_IDS]), "en").ok).toBe(true);
  });

  it("accepts a counselor-reviewed guide that says who reviewed it and when", () => {
    const reviewed = { ...good, review: { status: "counselor-reviewed", reviewedBy: "A. Counselor", reviewedOn: "2026-10-01" } };
    expect(parseGuide(reviewed, "en").ok).toBe(true);
  });

  it("trims text", () => {
    const result = parseGuide(withSection({ title: "  How aid works  " }), "en");
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
    [
      "a content fingerprint that was mistyped",
      { ...good, review: { status: "counselor-reviewed", reviewedBy: "A. Counselor", reviewedOn: "2026-09-10", contentFingerprint: "3f9a0c" } },
      "review.contentFingerprint: Copy the fingerprint exactly as the check gives it",
    ],
    ["no sections", { ...good, sections: [] }, "en.json sections: The guide needs at least one section."],
    ["an unknown section id", withSection({ id: "win-the-lottery" }), 'sections.0.id: Unknown section id "win-the-lottery"'],
    ["a section id that isn't kebab-case", withSection({ id: "How-Aid-Works" }), "sections.0.id: Unknown section id"],
    ["a repeated section", { ...good, sections: [first, first] }, 'sections.1.id: Section "how-aid-works" appears more than once.'],
    ["sections out of order", { ...good, sections: [second, first] }, 'sections.1.id: Section "how-aid-works" is out of order.'],
    ["an empty title", withSection({ title: "   " }), "sections.0.title: Can't be empty."],
    ["a missing summary", withSection({ summary: undefined }), "sections.0.summary"],
    ["a very long summary", withSection({ summary: "word ".repeat(100) }), "sections.0.summary: Keep this to 240 characters or fewer. It has 499."],
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

describe("line breaks", () => {
  // A browser shows a line break inside a paragraph as a space, so these would run together.
  const withBreaks = [
    "First paragraph about grants.\n\nSecond paragraph about loans.",
    "Grants are free money.\r\nLoans must be paid back.",
    "What you need:\n- a tax return\n- a Social Security number",
    "One line and another",
  ];
  const everywhere = (value: string) => [
    withBlock({ kind: "paragraph", text: value }),
    withBlock({ kind: "warning", text: value }),
    withBlock({ kind: "steps", items: ["ok", value] }),
    withBlock({ kind: "tip", heading: value, text: "Hi." }),
    withSection({ title: value }),
    withSection({ summary: value }),
    withSection({ sources: [{ title: value, url: "https://studentaid.gov" }] }),
    { ...good, review: { status: "counselor-reviewed", reviewedBy: value, reviewedOn: "2026-09-01" } },
  ];

  it.each(withBreaks)("are rejected in every kind of text: %j", (value) => {
    for (const raw of everywhere(value)) {
      expect(issuesFor(raw).join("\n")).toContain(
        "No line breaks: they don't show on the page, so the words would run together. Put each paragraph in its own block, and each list item in its own item.",
      );
    }
    expect(issuesFor(withBlock({ kind: "paragraph", text: value }))).toHaveLength(1);
  });

  it("are fine before or after the text, which is trimmed", () => {
    const result = parseGuide(withBlock({ kind: "paragraph", text: "\nGrants are free money.\n" }), "en");
    expect(result.ok && result.guide.sections[0].blocks[0]).toEqual({ kind: "paragraph", text: "Grants are free money." });
  });
});

describe("length limits", () => {
  const fields = Object.keys(LENGTH_LIMITS.en) as (keyof (typeof LENGTH_LIMITS)["en"])[];
  /** The guide with a summary of exactly `length` characters. */
  const summaryOf = (length: number, lang: AidLanguage = "en") =>
    ({ ...withSection({ summary: "palabra ".repeat(length).slice(0, length - 1) + "." }), language: lang });

  it("give Spanish at least a third more room than English, and half again for titles and summaries", () => {
    for (const field of fields) expect(LENGTH_LIMITS.es[field], field).toBeGreaterThanOrEqual(LENGTH_LIMITS.en[field] * 1.3);
    expect(LENGTH_LIMITS.es.title).toBeGreaterThanOrEqual(LENGTH_LIMITS.en.title * 1.5);
    expect(LENGTH_LIMITS.es.summary).toBeGreaterThanOrEqual(LENGTH_LIMITS.en.summary * 1.5);
  });

  it("accept a Spanish translation that runs longer than its English original", () => {
    // A 153-character English summary whose faithful Spanish translation has 242 characters.
    expect(parseGuide(summaryOf(153), "en").ok).toBe(true);
    expect(parseGuide(summaryOf(242, "es"), "es").ok).toBe(true);
    // An English summary right at the limit still has room to grow by half in Spanish.
    expect(parseGuide(summaryOf(LENGTH_LIMITS.en.summary), "en").ok).toBe(true);
    expect(parseGuide(summaryOf(LENGTH_LIMITS.en.summary * 1.5, "es"), "es").ok).toBe(true);
  });

  it("are counted per language, and the message says how long the text is", () => {
    expect(parseGuide(summaryOf(300, "es"), "es").ok).toBe(true);
    expect(issuesFor(summaryOf(300))).toEqual(["en.json sections.0.summary: Keep this to 240 characters or fewer. It has 300."]);
    expect(parseGuide(summaryOf(361, "es"), "es")).toEqual({
      ok: false,
      issues: ["es.json sections.0.summary: Keep this to 360 characters or fewer. It has 361."],
    });
  });

  it("fit a finished guide: ten long sections of 12 blocks and 8 sources, with a 400-word paragraph", () => {
    for (const lang of AID_GUIDE_LANGUAGES) {
      const guide = { ...guideFixture(lang), sections: AID_GUIDE_SECTION_IDS.map((id) => finishedSectionFixture(id, lang)) };
      guide.sections[0].blocks[0] = { kind: "paragraph", text: wordsOf(lang, 400) };
      const result = parseGuide(guide, lang);
      expect(result.ok ? [] : result.issues, lang).toEqual([]);
    }
  });
});
