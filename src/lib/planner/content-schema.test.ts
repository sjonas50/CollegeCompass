import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import {
  CipRoutingFileSchema,
  FactsFileSchema,
  GenericCatalogFileSchema,
  MajorFamiliesFileSchema,
  parseCipRoutingFile,
  parseFactsFile,
  parseGenericCatalogFile,
  parseMajorFamiliesFile,
  parseRuleFile,
  ReqSchema,
  RuleFileSchema,
  SelectorSchema,
} from "./content-schema";
import type { CipRoutingFile, FactsFile, GenericCatalogFile, MajorFamiliesFile } from "./content-types";
import {
  fixtureCipRouting,
  fixtureFacts,
  fixtureFamiliesFile,
  fixtureGenericCatalog,
  fixtureGraduationFile,
  fixtureOptionsFile,
} from "./fixtures";
import type { Req, RuleFile, Selector } from "./rules";

/** A deep copy to break, so fixtures stay intact. */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function issuesFor(raw: unknown) {
  const result = parseRuleFile(raw, "tx/graduation.json");
  return result.ok ? [] : result.issues;
}

describe("schema types match the hand-written contracts", () => {
  // Checked by `tsc` (expectTypeOf has no runtime effect). `.branded` compares structurally, so the
  // files' `ContentHeader & {...}` intersections equal zod's flat objects.
  it("infers exactly the documented types", () => {
    expectTypeOf<z.infer<typeof ReqSchema>>().toEqualTypeOf<Req>();
    expectTypeOf<z.infer<typeof SelectorSchema>>().toEqualTypeOf<Selector>();
    expectTypeOf<z.infer<typeof RuleFileSchema>>().branded.toEqualTypeOf<RuleFile>();
    expectTypeOf<z.infer<typeof GenericCatalogFileSchema>>().branded.toEqualTypeOf<GenericCatalogFile>();
    expectTypeOf<z.infer<typeof FactsFileSchema>>().branded.toEqualTypeOf<FactsFile>();
    expectTypeOf<z.infer<typeof MajorFamiliesFileSchema>>().branded.toEqualTypeOf<MajorFamiliesFile>();
    expectTypeOf<z.infer<typeof CipRoutingFileSchema>>().branded.toEqualTypeOf<CipRoutingFile>();
  });
});

describe("parsing the tiny examples", () => {
  it("parses every fixture file unchanged", () => {
    for (const [file, parse] of [
      [fixtureGraduationFile(), parseRuleFile],
      [fixtureOptionsFile(), parseRuleFile],
      [fixtureGenericCatalog(), parseGenericCatalogFile],
      [fixtureFacts(), parseFactsFile],
      [fixtureFamiliesFile(), parseMajorFamiliesFile],
      [fixtureCipRouting(), parseCipRoutingFile],
    ] as const) {
      const result = (parse as (raw: unknown, label: string) => { ok: boolean; value?: unknown; issues?: string[] })(copy(file), "fixture");
      expect(result.issues ?? []).toEqual([]);
      expect(result.value).toEqual(file);
    }
  });

  it("parses nested requirements: all, any, choose, option", () => {
    const req = {
      id: "sci4",
      label: "4th science",
      kind: "option",
      pref: "txArtsHumanitiesScienceSwap",
      cite: ["fx-sci"],
      on: { id: "sci4.swap", label: "Another course", kind: "credits", units: 4, select: [{ subjects: ["english", "social_studies"] }], cite: ["fx-sci"] },
      off: {
        id: "sci4.sci",
        label: "Science",
        kind: "choose",
        n: 1,
        of: [
          { id: "sci4.a", label: "Chemistry", kind: "credits", units: 4, select: [{ types: ["sci.chem"] }], cite: ["fx-sci"] },
          { id: "sci4.b", label: "Physics", kind: "credits", units: 4, select: [{ types: ["sci.phys"] }], cite: ["fx-sci"] },
        ],
      },
    };
    expect(ReqSchema.safeParse(req).success).toBe(true);
  });
});

describe("rejecting bad content", () => {
  const firstReq = (file: RuleFile) => file.ruleSets[0].variants[1].requirements[1] as Record<string, unknown>;

  it("rejects unknown course types, pointing at the vocabulary", () => {
    const file = copy(fixtureGraduationFile());
    firstReq(file).select = [{ types: ["sci.alchemy"] }];
    expect(issuesFor(file).join("\n")).toMatch(/requirements\.1\.select\.0\.types\.0: Unknown course type "sci\.alchemy".*course-types\.ts/);
  });

  it("rejects credits that aren't whole quarter units", () => {
    const file = copy(fixtureGraduationFile());
    firstReq(file).units = 2.5;
    expect(issuesFor(file).join("\n")).toMatch(/units: Units are quarter credits/);
  });

  it("requires a quote on every requirement, and keeps quotes short", () => {
    const file = copy(fixtureGraduationFile());
    delete firstReq(file).cite;
    file.citations[0].quote = "x".repeat(301);
    const issues = issuesFor(file).join("\n");
    expect(issues).toMatch(/requirements\.1\.cite/);
    expect(issues).toMatch(/citations\.0\.quote: Keep this to 300 characters or fewer/);
  });

  it("rejects empty selectors, http sources, and extra fields", () => {
    const file = copy(fixtureGraduationFile()) as RuleFile & { extra?: boolean };
    firstReq(file).select = [{ exclude: ["sci.bio"] }];
    file.sources["FX-1"].url = "http://example.org/x";
    file.extra = true;
    const issues = issuesFor(file).join("\n");
    expect(issues).toMatch(/select\.0: A selector needs something to match on/);
    expect(issues).toMatch(/sources\.FX-1\.url/);
    expect(issues).toMatch(/Unrecognized key.*extra/);
  });

  it("needs a reviewer, a date and the fingerprint for counselor-reviewed content", () => {
    const file = copy(fixtureGraduationFile());
    file.review = { status: "counselor-reviewed" };
    const issues = issuesFor(file).join("\n");
    expect(issues).toMatch(/review\.reviewedBy/);
    expect(issues).toMatch(/review\.contentFingerprint/);
  });

  it("checks families, CIP prefixes and the rigor-first limit", () => {
    const families = copy(fixtureFamiliesFile());
    families.families[0].rigorFirst = ["math.calc", "sci.phys", "sci.chem", "cs.prog2"];
    (families.families[1] as { id: string }).id = "premed";
    const result = parseMajorFamiliesFile(families, "families.json");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.issues.join("\n")).toMatch(/rigorFirst: Three "rigor first" subjects at most/);

    const routing = copy(fixtureCipRouting());
    routing.rules[0].match = ["51.1"];
    const routed = parseCipRoutingFile(routing, "cip-routing.json");
    expect(routed.ok ? "" : routed.issues.join("\n")).toMatch(/A CIP prefix looks like/);
  });
});
