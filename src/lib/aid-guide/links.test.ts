import { describe, expect, it } from "vitest";
import { guideTextSegments, isLinkableSite } from "./links";

const sources = [
  { url: "https://www.consumerfinance.gov/paying-for-college/" },
  { url: "https://cssprofile.collegeboard.org/" },
  { url: "https://www.careeronestop.org/toolkit/training/find-scholarships.aspx" },
];
const linked = (text: string) => guideTextSegments(text, sources).flatMap((s) => (s.type === "link" ? [s.href] : []));

describe("links in guide text", () => {
  it("go to any .gov or .edu site", () => {
    expect(linked("Apply at https://studentaid.gov or https://www.csac.ca.gov/cal-grants and ask https://finaid.ucla.edu.")).toEqual([
      "https://studentaid.gov/",
      "https://www.csac.ca.gov/cal-grants",
      "https://finaid.ucla.edu/",
    ]);
  });

  it("go to the sites of the section's sources, any page, with or without www", () => {
    expect(linked("See https://careeronestop.org/ and https://cssprofile.collegeboard.org/fee-waivers.")).toEqual([
      "https://careeronestop.org/",
      "https://cssprofile.collegeboard.org/fee-waivers",
    ]);
  });

  it("never go to a scam look-alike or any site that isn't official or a source", () => {
    for (const text of [
      'Scam sites copy real names, like "https://studentaid-gov.help".',
      "Never pay https://fafsa-help.com to file for you.",
      "https://studentaid.gov.help/login",
      "https://collegeboard.org is a different site from its CSS Profile site.",
      "https://www.fastweb.com",
      "https://gov",
    ]) {
      expect(linked(text), text).toEqual([]);
      expect(guideTextSegments(text, sources), text).toEqual([{ type: "text", text }]);
    }
  });

  it("need https, even to an official site", () => {
    expect(linked("http://studentaid.gov")).toEqual([]);
    expect(isLinkableSite("http://studentaid.gov/", [])).toBe(false);
  });

  it("keep all the text, with the rest joined into plain text", () => {
    const text = "Use https://studentaid.gov, not https://fafsa-help.com or https://evil.example, and https://studentaid.gov/es.";
    const segments = guideTextSegments(text, sources);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.map((s) => s.type)).toEqual(["text", "link", "text", "link", "text"]);
  });
});
