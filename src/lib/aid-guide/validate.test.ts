import { describe, expect, it } from "vitest";
import enContent from "@/content/aid-guide/en.json";
import esContent from "@/content/aid-guide/es.json";
import { contentFingerprint } from "./fingerprint";
import { finishedSectionFixture, guideFixture, reviewedFixture, sectionFixture } from "./fixtures";
import { AID_GUIDE_SECTION_IDS, type AidGuide } from "./schema";
import { AidGuideContentError, checkInlineLinks, checkParity, checkReview, latestToday, validateGuides } from "./validate";

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

  it("lets text talk about the https:// prefix", () => {
    for (const text of [
      "Check that the address starts with https:// and ends in .gov.",
      'A real site\'s address starts with "https://".',
      "Look for https://… in the address bar.",
    ]) {
      expect(checkInlineLinks(withText(text)), text).toEqual([]);
      expect(checkInlineLinks(withText(text, "item")), text).toEqual([]);
    }
    const guide = en();
    guide.sections[0].blocks = [{ kind: "tip", heading: "Look for https:// first", text: "Hi." }];
    expect(checkInlineLinks(guide)).toEqual([]);
  });

  it("won't let a scam look-alike become a link, and says how to show it as plain text", () => {
    expect(checkInlineLinks(withText('Scam sites copy real names, like "https://studentaid-gov.help".'))).toEqual([
      "en.json sections.0.blocks.0.text: https://studentaid-gov.help won't become a link: it isn't a .gov or .edu site or one of this section's sources. " +
        'If readers should go there, add the site to the section\'s "sources". If it\'s an example of a fake site, leave off the "https://" ' +
        "(write studentaid-gov.help) so it shows as plain text.",
    ]);
    expect(checkInlineLinks(withText("Scam sites copy real names, like studentaid-gov.help or www.fafsa-help.com."))).toEqual([]);
  });

  it("links to a site other than .gov or .edu only when it's one of the section's sources", () => {
    const text = "Search for scholarships at https://www.careeronestop.org/toolkit/training/find-scholarships.aspx.";
    expect(checkInlineLinks(withText(text))[0]).toContain("won't become a link: it isn't a .gov or .edu site or one of this section's sources.");
    const guide = withText(text);
    guide.sections[0].sources.push({ title: "CareerOneStop", url: "https://www.careeronestop.org/" });
    expect(checkInlineLinks(guide)).toEqual([]);
  });

  it("flags an address that would only become a link in part", () => {
    expect(checkInlineLinks(withText("Read https://www.example.gov/parent's-guide first."))).toEqual([
      'en.json sections.0.blocks.0.text: Only "https://www.example.gov/parent" of "https://www.example.gov/parent\'s-guide" would become a link, ' +
        "because a web address ends at a quote or apostrophe. Put a space after the address, or write an apostrophe inside it as %27.",
    ]);
    expect(checkInlineLinks(withText('See https://studentaid.gov"onmouseover="alert(1)'))[0]).toContain('Only "https://studentaid.gov" of');
    expect(checkInlineLinks(withText("Read https://www.example.gov/parent%27s-guide first."))).toEqual([]);
    expect(checkInlineLinks(withText("Go to 'https://studentaid.gov', then \"https://studentaid.gov/es\".", "item"))).toEqual([]);
  });

  it("lists each address that won't link", () => {
    expect(checkInlineLinks(withText("Visit:https://studentaid.gov and:https://fafsa.gov"))).toEqual([
      'en.json sections.0.blocks.0.text: "https://studentaid.gov" won\'t become a link. Put a space before it and use a real https:// address.',
      'en.json sections.0.blocks.0.text: "https://fafsa.gov" won\'t become a link. Put a space before it and use a real https:// address.',
    ]);
  });
});

describe("review status and dates", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const reviewed = (patch: Partial<AidGuide> = {}, reviewedOn = "2026-10-15") => reviewedFixture({ ...en(), ...patch }, reviewedOn);

  it("accepts a draft, and a reviewed guide that is still the one the counselor read", () => {
    expect(checkReview(en(), "en.json", now)).toEqual([]);
    expect(checkReview(reviewed(), "en.json", now)).toEqual([]);
    expect(checkReview(reviewed({ updated: "2026-10-15" }), "en.json", now)).toEqual([]);
  });

  it("flags a guide updated after its review", () => {
    expect(checkReview(reviewed({ updated: "2026-11-02" }), "en.json", now)).toEqual([
      'en.json updated: The guide changed on 2026-11-02, after the counselor reviewed it on 2026-10-15. Set "status" to "draft" until a counselor reviews the changes. Then set "reviewedOn" to the new review date.',
    ]);
  });

  it("flags sections that changed after the review, even if the date wasn't changed", () => {
    const guide = reviewed();
    guide.sections[0].blocks = [{ kind: "paragraph", text: "The FAFSA deadline is June 30, 2028." }];
    const [issue] = checkReview(guide, "en.json", now);
    expect(issue).toMatch(
      /^en\.json review\.contentFingerprint: The sections changed after the counselor reviewed them\. Set "status" to "draft" until a counselor reviews the changes\. Once they have, set "reviewedOn" to that date and "contentFingerprint" to "[0-9a-f]{16}"\.$/,
    );
    expect(issue).toContain(contentFingerprint(guide));
  });

  it("asks a reviewed guide to record which version was reviewed, and gives the value to use", () => {
    const guide = reviewed();
    delete guide.review.contentFingerprint;
    expect(checkReview(guide, "en.json", now)).toEqual([
      `en.json review.contentFingerprint: Record which version the counselor reviewed. If they reviewed the sections exactly as they are now, add "contentFingerprint": "${contentFingerprint(guide)}".`,
    ]);
  });

  it("rejects dates in the future, allowing for every time zone", () => {
    expect(checkReview(reviewed({}, "2027-05-01"), "es.json", now)).toContain(
      "es.json review.reviewedOn: 2027-05-01 is in the future. Use the date the counselor reviewed the guide.",
    );
    expect(checkReview({ ...en(), updated: "2026-11-05" }, "en.json", now)).toEqual([
      "en.json updated: 2026-11-05 is in the future. Use the date the guide last changed.",
    ]);
    // At noon UTC on November 3 it's already November 4 in some places, but not November 5.
    expect(checkReview({ ...en(), updated: "2026-11-04" }, "en.json", now)).toEqual([]);
    expect(checkReview({ ...en(), updated: "2026-11-04" }, "en.json", new Date("2026-11-03T09:59:00Z"))).toHaveLength(1);
    expect(latestToday(new Date("2026-11-03T10:00:00Z"))).toBe("2026-11-04");
  });

  it("fingerprints the words, not the file's spacing or key order", () => {
    const guide = en();
    const reordered = JSON.parse(JSON.stringify(guide), (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value,
    );
    reordered.sections[0].title = `  ${reordered.sections[0].title}  `;
    const parsed = validateGuides({ en: reordered, es: es() }, { now });
    expect(contentFingerprint(parsed.en)).toBe(contentFingerprint(guide));
    expect(contentFingerprint({ sections: [sectionFixture("how-aid-works")] })).not.toBe(contentFingerprint(guide));
  });

  it("fails validation for a reviewed guide edited later or dated in the future", () => {
    const edited = { ...reviewed(), updated: "2026-11-02" };
    const future = reviewedFixture(es(), "2027-05-01");
    expect(() => validateGuides({ en: edited, es: future }, { now })).toThrow(
      /en\.json updated: The guide changed on 2026-11-02[\s\S]*es\.json review\.reviewedOn: 2027-05-01 is in the future/,
    );
    expect(validateGuides({ en: reviewed(), es: reviewedFixture(es(), "2026-10-15") }, { now }).en.review.status).toBe("counselor-reviewed");
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

  it("accepts a finished, reviewed guide the size of the real one in both languages", () => {
    const finished = (lang: "en" | "es") =>
      reviewedFixture({ ...guideFixture(lang), sections: AID_GUIDE_SECTION_IDS.map((id) => finishedSectionFixture(id, lang)) });
    const guides = validateGuides({ en: finished("en"), es: finished("es") }, { now: new Date("2026-10-01T00:00:00Z") });
    expect(guides.es.sections).toHaveLength(10);
    expect(guides.es.sections[0].blocks).toHaveLength(12);
    expect(guides.es.sections[0].sources).toHaveLength(8);
  });

  it("accepts the content files in src/content/aid-guide", () => {
    expect(() => validateGuides({ en: enContent, es: esContent })).not.toThrow();
  });
});
