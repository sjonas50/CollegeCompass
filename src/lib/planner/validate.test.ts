import { describe, expect, it } from "vitest";
import {
  fixtureCipRouting,
  fixtureFacts,
  fixtureFamiliesFile,
  fixtureGenericCatalog,
  fixtureGraduationFile,
  fixtureOptionsFile,
} from "./fixtures";
import { contentFingerprint } from "./review";
import type { CreditsReq, Req, RuleFile } from "./rules";
import {
  contentForState,
  countAlternatives,
  loadContent,
  MAX_ALTERNATIVES_PER_VARIANT,
  PlannerContentError,
  type RawContent,
  validateContent,
} from "./validate";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function raw(overrides: Partial<{ graduation: unknown; options: unknown; catalog: unknown; facts: unknown; families: unknown; routing: unknown }> = {}): RawContent {
  return {
    rules: [
      { label: "tx/graduation.json", raw: overrides.graduation ?? fixtureGraduationFile() },
      { label: "tx/options.json", raw: overrides.options ?? fixtureOptionsFile() },
    ],
    genericCatalogs: [{ label: "tx/generic-catalog.json", raw: overrides.catalog ?? fixtureGenericCatalog() }],
    facts: [{ label: "tx/facts.json", raw: overrides.facts ?? fixtureFacts() }],
    families: { label: "major-prep/families.json", raw: overrides.families ?? fixtureFamiliesFile() },
    cipRouting: { label: "major-prep/cip-routing.json", raw: overrides.routing ?? fixtureCipRouting() },
  };
}

function issues(content: RawContent): string {
  const result = validateContent(content);
  return result.ok ? "" : result.issues.join("\n");
}

const credits = (id: string): CreditsReq => ({ id, label: id, kind: "credits", units: 4, select: [{ subjects: ["math"] }], cite: ["fx-math"] });

describe("validateContent", () => {
  it("accepts the fixture content with no warnings", () => {
    const result = validateContent(raw());
    expect(result).toMatchObject({ ok: true, warnings: [] });
  });

  it("reports parse problems with the file and path", () => {
    const grad = copy(fixtureGraduationFile());
    (grad.ruleSets[0] as { strength: string }).strength = "mandatory";
    expect(issues(raw({ graduation: grad }))).toMatch(/^tx\/graduation\.json ruleSets\.0\.strength: /m);
  });

  it("finds citations and sources that don't resolve", () => {
    const grad = copy(fixtureGraduationFile());
    (grad.ruleSets[0].variants[1].requirements[1] as CreditsReq).cite = ["fx-nope"];
    grad.citations[0].source = "FX-9";
    const found = issues(raw({ graduation: grad }));
    expect(found).toMatch(/cites "fx-nope"/);
    expect(found).toMatch(/citation "fx-grad" names source "FX-9"/);
  });

  it("finds duplicate ids across files", () => {
    const options = copy(fixtureOptionsFile());
    options.ruleSets[0].id = "fx.tx.grad";
    options.citations[0].id = "fx-grad";
    const found = issues(raw({ options }));
    expect(found).toMatch(/rule set id "fx\.tx\.grad" is used twice/);
  });

  it("puts rule sets only in their own kind of file, with the gates they need", () => {
    const grad = copy(fixtureGraduationFile());
    grad.ruleSets[0].kind = "college_admission";
    const found = issues(raw({ graduation: grad }));
    expect(found).toMatch(/a college_admission rule set doesn't belong in a graduation file/);
    expect(found).toMatch(/admission rule sets list their colleges/);
  });

  it("catches overlapping variants and uncovered classes", () => {
    const overlap = copy(fixtureGraduationFile());
    overlap.ruleSets[0].variants[0].cohort = { to: 2026 };
    expect(issues(raw({ graduation: overlap }))).toMatch(/variants fx\.tx\.grad\.pre2026 and fx\.tx\.grad\.2026 overlap/);

    const gap = copy(fixtureGraduationFile());
    gap.ruleSets[0].variants[0].cohort = { to: 2023 };
    gap.ruleSets[0].variants[1].cohort = { from: 2025 };
    expect(issues(raw({ graduation: gap }))).toMatch(/no variant covers the class of 2028 \(grade9_entry_year 2024\)/);

    // Cohorts past projectedBeyond may go uncovered: they use the latest variant, labeled Projected.
    const projected = copy(fixtureGraduationFile());
    projected.ruleSets[0].variants[1].cohort = { from: 2026, to: 2026 };
    expect(issues(raw({ graduation: projected }))).toBe("");
  });

  it("resolves extends, on_schedule_by and requires_rule_set across files", () => {
    const options = copy(fixtureOptionsFile());
    options.ruleSets[1].variants[0].extends = "fx.tx.grad.2099";
    const checks = options.ruleSets[1].variants[0].checks!;
    checks[0] = { ...checks[0], kind: "on_schedule_by", req: "dla.nope", grade: 11 } as (typeof checks)[number];
    checks[1] = { id: "dla.endorsement", kind: "requires_rule_set", anyOf: ["fx.tx.arts"], cite: ["fx-dla"] };
    const found = issues(raw({ options }));
    expect(found).toMatch(/extends unknown variant "fx\.tx\.grad\.2099"/);
    expect(found).toMatch(/on_schedule_by names unknown requirement "dla\.nope"/);
    expect(found).toMatch(/requires unknown rule set "fx\.tx\.arts"/);
  });

  it("checks requirement ids, choose counts and quoted strength overrides", () => {
    const grad = copy(fixtureGraduationFile());
    const reqs = grad.ruleSets[0].variants[1].requirements;
    reqs.push({ ...credits("sci"), strength: "recommended" });
    reqs.push({ id: "pick", label: "pick", kind: "choose", n: 3, of: [credits("a"), credits("b")] });
    const found = issues(raw({ graduation: grad }));
    expect(found).toMatch(/requirement id "sci" is used twice/);
    expect(found).toMatch(/sci: a requirement that sets its own strength must quote it/);
    expect(found).toMatch(/pick: chooses 3 of only 2/);
  });

  it("caps each variant at 256 alternatives", () => {
    const grad = copy(fixtureGraduationFile());
    const pair = (i: number): Req => ({ id: `alt${i}`, label: "x", kind: "any", of: [credits(`alt${i}.a`), credits(`alt${i}.b`)] });
    // The fixture's language requirement is already 2 alternatives; 7 more pairs make 256: allowed.
    grad.ruleSets[0].variants[1].requirements.push(...Array.from({ length: 7 }, (_, i) => pair(i)));
    expect(issues(raw({ graduation: grad }))).toBe("");
    grad.ruleSets[0].variants[1].requirements.push(pair(7));
    expect(issues(raw({ graduation: grad }))).toMatch(new RegExp(`expands to 512 alternatives; the most is ${MAX_ALTERNATIVES_PER_VARIANT}`));
  });

  it("keeps counselor-reviewed files tied to what the counselor saw", () => {
    const grad = copy(fixtureGraduationFile());
    const reviewed: RuleFile = {
      ...grad,
      review: { status: "counselor-reviewed", reviewedBy: "A counselor", reviewedOn: "2026-10-01", contentFingerprint: contentFingerprint(grad) },
    };
    expect(issues(raw({ graduation: reviewed }))).toBe("");
    reviewed.ruleSets[0].title = "Edited after review";
    expect(issues(raw({ graduation: reviewed }))).toMatch(/content changed after the counselor's review/);
  });

  it("checks the generic catalog, families and CIP routing", () => {
    const catalog = copy(fixtureGenericCatalog());
    catalog.courses.push({ typeId: "math.alg1", levels: ["ap"] });
    const families = copy(fixtureFamiliesFile());
    families.families.pop();
    const routing = copy(fixtureCipRouting());
    routing.rules.unshift({ match: ["11"], family: "it_cybersecurity" });
    const found = issues(raw({ catalog, families, routing }));
    expect(found).toMatch(/course type "math\.alg1" is listed twice/);
    expect(found).toMatch(/math\.alg1: level "ap" isn't one of the type's levels/);
    expect(found).toMatch(/family "cosmetology" is missing/);
    expect(found).toMatch(/prefix 11\.01 can never match; rule for 11 comes first/);
  });

  it("warns about unused citations without failing", () => {
    const facts = copy(fixtureFacts());
    facts.citations.push({ id: "fx-spare", source: "FX-1", quote: "Unused." });
    const result = validateContent(raw({ facts }));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(['tx/facts.json: citation "fx-spare" isn\'t used.']);
  });
});

describe("countAlternatives", () => {
  it("multiplies all, adds any, counts choose combinations, both option branches and substitutions", () => {
    const a = credits("a");
    const any2: Req = { id: "any", label: "x", kind: "any", of: [credits("b"), credits("c")] };
    expect(countAlternatives({ id: "all", label: "x", kind: "all", of: [any2, any2] })).toBe(4);
    // Choose 2 of [1, 2, 1]: 1*2 + 1*1 + 2*1 = 5.
    expect(countAlternatives({ id: "ch", label: "x", kind: "choose", n: 2, of: [a, any2, credits("d")] })).toBe(5);
    expect(countAlternatives({ id: "op", label: "x", kind: "option", pref: "utMath3OptOut", on: any2, off: a, cite: ["c"] })).toBe(3);
    // Tennessee's CS credit may stand in for one of three requirements: 4 ways.
    expect(countAlternatives({ ...a, substitutesForOneOf: ["m4", "s3", "ef"] })).toBe(4);
  });
});

describe("loadContent and contentForState", () => {
  it("throws a PlannerContentError listing every problem", () => {
    const grad = copy(fixtureGraduationFile());
    grad.review = { status: "counselor-reviewed" };
    expect(() => loadContent(raw({ graduation: grad }))).toThrow(PlannerContentError);
  });

  it("hands the engine one state's files", () => {
    const content = loadContent(raw());
    const tx = contentForState(content, "TX");
    expect(tx?.rules.map((f) => f.id)).toEqual(["fixture.tx.graduation", "fixture.tx.options"]);
    expect(tx?.genericCatalog.state).toBe("TX");
    expect(contentForState(content, "UT")).toBeNull();
  });
});
