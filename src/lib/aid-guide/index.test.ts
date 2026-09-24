import { describe, expect, it } from "vitest";
import {
  AID_GUIDE_LANGUAGES,
  AID_GUIDE_SECTION_IDS,
  aidGuidePageParams,
  getNeighbors,
  getSection,
  isAidLanguage,
  listSections,
  loadGuide,
} from ".";

// These run against the real content files, so a malformed or mismatched file fails here.

describe("aid guide loader", () => {
  it("plans these sections, in this order", () => {
    expect(AID_GUIDE_SECTION_IDS).toEqual([
      "how-aid-works",
      "fafsa-step-by-step",
      "special-situations",
      "pell-and-workforce-pell",
      "state-aid-and-promise-programs",
      "css-profile-and-fee-waivers",
      "scholarships-and-scams",
      "loans-wisely",
      "comparing-aid-offers",
      "training-programs-and-apprenticeships",
    ]);
  });

  it("loads each language's guide", () => {
    for (const lang of AID_GUIDE_LANGUAGES) {
      const guide = loadGuide(lang);
      expect(guide.language).toBe(lang);
      expect(guide.sections.length).toBeGreaterThan(0);
    }
  });

  it("has the same sections, in the same order, in English and Spanish", () => {
    expect(loadGuide("es").sections.map((s) => s.id)).toEqual(loadGuide("en").sections.map((s) => s.id));
  });

  it("finds a section by id in either language", () => {
    const [firstId] = loadGuide("en").sections.map((s) => s.id);
    expect(getSection("en", firstId)?.id).toBe(firstId);
    expect(getSection("es", firstId)?.title).not.toBe(getSection("en", firstId)?.title);
    expect(getSection("en", "not-a-section")).toBeUndefined();
    expect(getSection("en", "__proto__")).toBeUndefined();
  });

  it("lists every section with its title, summary and address", () => {
    const sections = listSections("es");
    expect(sections.map((s) => s.id)).toEqual(loadGuide("es").sections.map((s) => s.id));
    for (const s of sections) {
      expect(s.href).toBe(`/aid/es/${s.id}`);
      expect(s.title).toBe(getSection("es", s.id)?.title);
      expect(s.summary).toBe(getSection("es", s.id)?.summary);
    }
  });

  it("links each section to the ones before and after it", () => {
    const sections = listSections("en");
    const first = getNeighbors("en", sections[0].id);
    expect(first?.prev).toBeNull();
    expect(first?.next?.id).toBe(sections[1]?.id);
    const last = getNeighbors("en", sections.at(-1)!.id);
    expect(last?.next).toBeNull();
    expect(last?.prev?.id).toBe(sections.at(-2)?.id);
    expect(getNeighbors("en", "not-a-section")).toBeNull();
  });

  it("lists every page for static generation", () => {
    const params = aidGuidePageParams();
    expect(params).toHaveLength(AID_GUIDE_LANGUAGES.length * loadGuide("en").sections.length);
    for (const lang of AID_GUIDE_LANGUAGES) {
      for (const s of loadGuide(lang).sections) expect(params).toContainEqual({ lang, section: s.id });
    }
  });

  it("knows which languages it has", () => {
    expect(isAidLanguage("en")).toBe(true);
    expect(isAidLanguage("es")).toBe(true);
    expect(isAidLanguage("fr")).toBe(false);
    expect(isAidLanguage("EN")).toBe(false);
  });
});
