import { describe, expect, it } from "vitest";
import { AID_TEXT, type AidTextKey, LANGUAGE_NAMES, aidText, formatGuideDate, otherLanguages, placeholders } from "./dictionary";
import { AID_GUIDE_LANGUAGES } from "./schema";

const keys = Object.keys(AID_TEXT.en) as AidTextKey[];

describe("aid guide page text", () => {
  it("has every string in every language", () => {
    for (const lang of AID_GUIDE_LANGUAGES) {
      expect(Object.keys(AID_TEXT[lang]).sort(), lang).toEqual([...keys].sort());
      for (const key of keys) expect(AID_TEXT[lang][key].trim(), `${lang}.${key}`).not.toBe("");
    }
  });

  it("has no Spanish string left in English", () => {
    for (const key of keys) expect(AID_TEXT.es[key], key).not.toBe(AID_TEXT.en[key]);
  });

  it("uses the same {placeholders} in every language", () => {
    for (const key of keys) {
      for (const lang of AID_GUIDE_LANGUAGES) expect(placeholders(AID_TEXT[lang][key]), `${lang}.${key}`).toEqual(placeholders(AID_TEXT.en[key]));
    }
  });

  it("has the labels the pages need, in both languages", () => {
    const expected: Partial<Record<AidTextKey, [string, string]>> = {
      sources: ["Sources", "Fuentes"],
      next: ["Next", "Siguiente"],
      previous: ["Previous", "Anterior"],
      lastUpdated: ["Last updated", "Última actualización"],
      onThisPage: ["On this page", "En esta página"],
      print: ["Print", "Imprimir"],
      sourcesHeading: ["Where this information comes from", "De dónde viene esta información"],
      draftBanner: [
        "An experienced counselor is reviewing this guide. Double-check dates with official sites.",
        "Un consejero con experiencia está revisando esta guía. Confirme las fechas en los sitios oficiales.",
      ],
    };
    for (const [key, [en, es]] of Object.entries(expected) as [AidTextKey, [string, string]][]) {
      expect(aidText("en", key)).toBe(en);
      expect(aidText("es", key)).toBe(es);
    }
  });

  it("fills in placeholders and leaves unknown ones as written", () => {
    expect(aidText("en", "partOf", { n: 2, total: 10 })).toBe("Part 2 of 10");
    expect(aidText("es", "partOf", { n: 2, total: 10 })).toBe("Parte 2 de 10");
    expect(aidText("en", "partOf", { n: 2 })).toBe("Part 2 of {total}");
    expect(placeholders("Reviewed by {name} on {date}.")).toEqual(["date", "name"]);
  });
});

describe("formatGuideDate", () => {
  it("writes dates the way each language does", () => {
    expect(formatGuideDate("2026-09-23", "en")).toBe("September 23, 2026");
    expect(formatGuideDate("2026-09-23", "es")).toBe("23 de septiembre de 2026");
  });

  it("never moves a date to the day before because of time zones", () => {
    expect(formatGuideDate("2027-01-01", "en")).toBe("January 1, 2027");
  });
});

describe("languages", () => {
  it("names each language in itself and offers the other one", () => {
    expect(LANGUAGE_NAMES).toEqual({ en: "English", es: "Español" });
    expect(otherLanguages("en")).toEqual(["es"]);
    expect(otherLanguages("es")).toEqual(["en"]);
  });
});
