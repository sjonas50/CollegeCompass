import { describe, expect, it } from "vitest";
import { checkQuotes, citationCoverageIssues, diffSummary, stalenessWarnings, strengthWordIssues } from "./content-check";
import {
  fixtureCipRouting,
  fixtureFacts,
  fixtureFamiliesFile,
  fixtureGenericCatalog,
  fixtureGraduationFile,
  fixtureOptionsFile,
  fixtureRigorFile,
} from "./fixtures";
import type { CreditsReq, RuleFile } from "./rules";
import { loadContent, type ValidatedContent } from "./validate";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function fixtureContent(graduation: RuleFile = fixtureGraduationFile()): ValidatedContent {
  return loadContent({
    rules: [
      { label: "tx/graduation.json", raw: graduation },
      { label: "tx/options.json", raw: fixtureOptionsFile() },
    ],
    genericCatalogs: [{ label: "tx/generic-catalog.json", raw: fixtureGenericCatalog() }],
    facts: [{ label: "tx/facts.json", raw: fixtureFacts() }],
    families: { label: "major-prep/families.json", raw: fixtureFamiliesFile() },
    cipRouting: { label: "major-prep/cip-routing.json", raw: fixtureCipRouting() },
    rigor: { label: "major-prep/rigor.json", raw: fixtureRigorFile() },
  });
}

describe("citationCoverageIssues", () => {
  it("passes when every statement cites a quote with an https source", () => {
    expect(citationCoverageIssues(fixtureContent()).issues).toEqual([]);
  });

  it("finds a quote with no https link", () => {
    const content = fixtureContent();
    content.rules[0].sources["FX-1"] = { ...content.rules[0].sources["FX-1"], url: "http://example.org/x" };
    expect(citationCoverageIssues(content).issues.join("\n")).toMatch(/has no https source link/);
  });

  it("finds a citation id reused with different words", () => {
    const content = fixtureContent();
    content.rules[1].citations.push({ id: "fx-grad", source: "FX-1", quote: "Different words." });
    expect(citationCoverageIssues(content).issues.join("\n")).toMatch(/"fx-grad" appears in more than one file with different words/);
  });
});

describe("strengthWordIssues", () => {
  it("wants the quote to carry the strength word", () => {
    const grad = copy(fixtureGraduationFile());
    grad.ruleSets[0].strength = "strongly_encouraged";
    expect(strengthWordIssues([grad])).toEqual(['fx.tx.grad: strength "strongly_encouraged" isn\'t supported by the words of "fx-grad".']);
    grad.citations[0].quote = "Fixture: these are strongly encouraged.";
    expect(strengthWordIssues([grad])).toEqual([]);
  });

  it("checks requirement-level strength overrides too", () => {
    const grad = copy(fixtureGraduationFile());
    const sci = grad.ruleSets[0].variants[1].requirements[1] as CreditsReq;
    sci.strength = "recommended";
    sci.strengthCite = "fx-sci";
    expect(strengthWordIssues([grad])).toEqual(['fx.tx.grad.2026 sci: strength "recommended" isn\'t supported by the words of "fx-sci".']);
  });
});

describe("checkQuotes", () => {
  it("checks each quote once against its saved copy and lists sources with no copy", () => {
    const content = fixtureContent();
    const result = checkQuotes(content, (key) => (key === "FX-1" ? "Fixture: a student must earn these credits to graduate." : null));
    expect(result.checked).toBeGreaterThan(1);
    expect(result.notFound.length).toBe(result.checked - 1);
    expect(result.notFound.join("\n")).not.toMatch(/fx-grad /);
    expect(checkQuotes(content, () => null).noCopy.length).toBe(result.checked);
  });
});

describe("stalenessWarnings", () => {
  it("warns 60 days ahead and after the check date, but only warns", () => {
    const content = fixtureContent();
    expect(stalenessWarnings(content, "2026-09-25")).toEqual([]);
    expect(stalenessWarnings(content, "2027-06-15").join("\n")).toMatch(/goes stale in 46 days/);
    expect(stalenessWarnings(content, "2027-08-10").join("\n")).toMatch(/past its check date \(10 days\)/);
  });
});

describe("diffSummary", () => {
  it("names new files and the rule sets and quotes that changed", () => {
    const before = fixtureGraduationFile();
    const after = copy(before);
    after.ruleSets[0].title = "Renamed";
    after.citations.push({ id: "fx-new", source: "FX-1", quote: "New." });
    const lines = diffSummary([
      { label: "tx/graduation.json", before: before as never, after: after as never },
      { label: "tx/options.json", before: fixtureOptionsFile() as never, after: fixtureOptionsFile() as never },
      { label: "ut/graduation.json", before: null, after: fixtureGraduationFile() as never },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^tx\/graduation\.json: fingerprint \w+ -> \w+\. rule set changed: fx\.tx\.grad; citation added: fx-new\.$/);
    expect(lines[1]).toBe("ut/graduation.json: new file.");
  });
});
