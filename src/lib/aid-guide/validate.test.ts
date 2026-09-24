import { describe, expect, it } from "vitest";
import enContent from "@/content/aid-guide/en.json";
import esContent from "@/content/aid-guide/es.json";
import { guideFixture, sectionFixture } from "./fixtures";
import type { AidGuide } from "./schema";
import { AidGuideContentError, checkInlineLinks, checkParity, validateGuides } from "./validate";

const en = () => guideFixture("en");
const es = () => guideFixture("es");

describe("language parity", () => {
  it("passes when both languages have the same sections in the same order", () => {
    expect(checkParity({ en: en(), es: es() })).toEqual([]);
  });

  it("flags a section that only one language has", () => {
    const shorter = guideFixture("es", ["how-aid-works"]);
    const [issue] = checkParity({ en: en(), es: shorter });
    expect(issue).toContain("es.json: sections must match en.json (same ids, same order)");
    expect(issue).toContain("[how-aid-works, comparing-aid-offers]");
    expect(issue).toContain("es.json has [how-aid-works]");
  });

  it("flags sections in a different order", () => {
    const flipped: AidGuide = { ...es(), sections: [...es().sections].reverse() };
    expect(checkParity({ en: en(), es: flipped })).toHaveLength(1);
  });

  it("flags a file whose language doesn't match its name", () => {
    expect(checkParity({ en: en(), es: { ...es(), language: "en" } })).toEqual([
      'es.json: "language" is "en", but this is the "es" file.',
    ]);
  });

  it("flags any source that isn't an https address", () => {
    const guide = es();
    guide.sections[1].sources = [
      { title: "Plain http", url: "http://studentaid.gov" },
      { title: "Script", url: "javascript:alert(1)" },
      { title: "Fine", url: "https://studentaid.gov/es" },
    ];
    expect(checkParity({ en: en(), es: guide })).toEqual([
      "es.json sections.1.sources.0.url: Use a full https:// address.",
      "es.json sections.1.sources.1.url: Use a full https:// address.",
    ]);
  });
});

describe("addresses written in guide text", () => {
  const withText = (text: string, where: "paragraph" | "item" = "paragraph"): AidGuide => {
    const guide = en();
    guide.sections[0].blocks = [where === "paragraph" ? { kind: "paragraph", text } : { kind: "list", items: ["ok", text] }];
    return guide;
  };

  it("accepts https addresses that will become links", () => {
    expect(checkInlineLinks(withText("Apply at https://studentaid.gov. It's free (https://fafsa.gov)."))).toEqual([]);
    expect(checkInlineLinks(withText("Start at https://studentaid.gov/es", "item"))).toEqual([]);
  });

  it("flags an address that won't become a link", () => {
    expect(checkInlineLinks(withText("Visit:https://studentaid.gov"))).toEqual([
      'en.json sections.0.blocks.0.text: "https://studentaid.gov" won\'t become a link. Put a space before it and use a real https:// address.',
    ]);
    expect(checkInlineLinks(withText("Go to https://studentaid.gov@evil.example", "item"))[0]).toContain("sections.0.blocks.0.items.1");
  });

  it("flags plain http addresses", () => {
    expect(checkInlineLinks(withText("Go to http://studentaid.gov now."))).toEqual([
      "en.json sections.0.blocks.0.text: Use https:// for http://studentaid.gov.",
    ]);
  });

  it("keeps addresses out of titles, summaries and headings, which show up inside other links", () => {
    const guide = en();
    guide.sections[0].title = "Go to https://studentaid.gov";
    guide.sections[0].summary = "See https://studentaid.gov.";
    guide.sections[0].blocks = [{ kind: "tip", heading: "https://fafsa.gov", text: "Hi." }];
    expect(checkInlineLinks(guide)).toEqual([
      "en.json sections.0.title: Titles, summaries and headings can't hold web addresses.",
      "en.json sections.0.summary: Titles, summaries and headings can't hold web addresses.",
      "en.json sections.0.blocks.0.heading: Titles, summaries and headings can't hold web addresses.",
    ]);
  });
});

describe("validateGuides", () => {
  it("returns both guides when they are valid and match", () => {
    const guides = validateGuides({ en: en(), es: es() });
    expect(guides.en.language).toBe("en");
    expect(guides.es.sections.map((s) => s.id)).toEqual(["how-aid-works", "comparing-aid-offers"]);
  });

  it("throws one error listing every problem in every file", () => {
    const badEn = { ...en(), updated: "someday" };
    const badEs = { ...es(), sections: [{ ...sectionFixture("how-aid-works", "es"), blocks: [] }] };
    let error: unknown;
    try {
      validateGuides({ en: badEn, es: badEs });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AidGuideContentError);
    const { issues, message } = error as AidGuideContentError;
    expect(issues).toEqual([expect.stringMatching(/^en\.json updated: /), expect.stringMatching(/^es\.json sections\.0\.blocks: /)]);
    expect(message).toContain("2 problem(s)");
  });

  it("checks parity and inline links once each file is valid", () => {
    const badEs = guideFixture("es", ["how-aid-works"]);
    badEs.sections[0].blocks = [{ kind: "paragraph", text: "Vea:https://studentaid.gov" }];
    expect(() => validateGuides({ en: en(), es: badEs })).toThrow(/same ids, same order[\s\S]*won't become a link/);
  });

  it("accepts the content files in src/content/aid-guide", () => {
    expect(() => validateGuides({ en: enContent, es: esContent })).not.toThrow();
  });
});
