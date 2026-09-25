import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLANNER_STATES } from "./common";
import {
  contentFiles,
  familyForCip,
  findRuleSet,
  infoCardsForCollege,
  LOADED_CONTENT_LABELS,
  majorFamiliesContent,
  plannerContent,
  plannerContentFor,
  reviewNoticesFor,
  rigorContent,
  ruleSetsForCollege,
  ruleSetStaleness,
  stateDefaultRuleSets,
} from "./content";
import { citationCoverageIssues, strengthWordIssues } from "./content-check";
import { PLANNER_CONTENT_DIR, PLANNER_CONTENT_FILES } from "./content-files";
import { STRENGTH_PHRASES, TX_ALGEBRA_2_NOTE } from "./copy";
import { type CourseTypeId, type CourseTypeLevel, getCourseType, LANGUAGES, STATE_LEVEL_LABELS } from "./course-types";
import { COLLEGE_LEVEL_SOFT_WARNING_AT, DEFAULT_MAX_COLLEGE_LEVEL_PER_YEAR, RIGOR_TIERS } from "./engine-io";
import { FAMILY_IDS } from "./families";
import type { GenericCatalogFile } from "./content-types";
import type { Req, RuleFile, RuleSet, Selector, Variant } from "./rules";
import { COHORT_COVERAGE, validateContent, walkReqs } from "./validate";

const content = plannerContent();
const ruleSets = content.rules.flatMap((f) => f.ruleSets);
const byId = (id: string) => {
  const rs = ruleSets.find((r) => r.id === id);
  if (!rs) throw new Error(`no rule set ${id}`);
  return rs;
};

/** Every piece of human-readable text in the content (labels, notes, summaries, cards, warnings, family lines). */
function allText(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const push = (where: string, text: string | undefined) => text && out.push({ where, text });
  for (const f of content.rules) {
    for (const rs of f.ruleSets) {
      push(rs.id, rs.title);
      push(rs.id, rs.plainSummary);
      for (const t of rs.testRoutes ?? []) push(`${rs.id} ${t.id}`, t.text);
      for (const v of rs.variants) {
        for (const r of walkReqs(v.requirements)) {
          push(`${v.id} ${r.id}`, r.label);
          push(`${v.id} ${r.id}`, r.note);
        }
        for (const x of v.conditions ?? []) push(`${v.id} ${x.id}`, x.label);
        for (const x of v.warnings ?? []) push(`${v.id} ${x.id}`, x.text);
        for (const x of v.unverified ?? []) push(`${v.id} ${x.id} (unverified)`, x.text);
      }
    }
    for (const c of f.infoCards ?? []) {
      push(c.id, c.title);
      push(c.id, c.text);
    }
  }
  for (const f of content.facts) {
    for (const o of f.options) push(`${f.id} ${o.kind}`, o.note);
    for (const m of f.middleSchoolMath) push(`${f.id} middle school`, m.text);
    for (const t of f.terms ?? []) push(`${f.id} ${t.id}`, `${t.term}: ${t.meaning}`);
  }
  for (const fam of content.families!.families) {
    push(fam.id, fam.summary);
    push(fam.id, fam.math.note);
    for (const g of fam.gates) push(`${fam.id} ${g.id}`, g.text);
    for (const c of fam.cautions) push(`${fam.id} ${c.id}`, c.text);
  }
  for (const t of content.rigor!.tiers) for (const s of [t.label, t.detection, t.expects, t.target]) push(`rigor ${t.id}`, s);
  for (const g of content.rigor!.guardrails) push(`rigor ${g.id}`, g.text);
  for (const r of content.rigor!.raises) push(`rigor ${r.id}`, r.text);
  return out;
}

describe("loading", () => {
  it("validates every file with no warnings", () => {
    const raw = {
      rules: content.rules.map((f) => ({ label: f.id, raw: f })),
      genericCatalogs: content.genericCatalogs.map((f) => ({ label: f.id, raw: f })),
      facts: content.facts.map((f) => ({ label: f.id, raw: f })),
      families: { label: "families", raw: content.families },
      cipRouting: { label: "routing", raw: content.cipRouting },
      rigor: { label: "rigor", raw: content.rigor },
    };
    expect(validateContent(raw)).toMatchObject({ ok: true, warnings: [] });
  });

  it("loads exactly the files in the manifest, which are exactly the files on disk", () => {
    const onDisk = ["ut", "tn", "tx", "major-prep"].flatMap((dir) =>
      readdirSync(path.join(process.cwd(), PLANNER_CONTENT_DIR, dir))
        .filter((f) => f.endsWith(".json"))
        .map((f) => `${dir}/${f}`),
    );
    const manifest = PLANNER_CONTENT_FILES.map((f) => f.label);
    expect([...onDisk].sort()).toEqual([...manifest].sort());
    expect([...LOADED_CONTENT_LABELS].sort()).toEqual([...manifest].sort());
    expect(contentFiles()).toHaveLength(manifest.length);
  });

  it("hands the engine each planner state's files, with rigor and families", () => {
    for (const state of PLANNER_STATES) {
      const c = plannerContentFor(state);
      expect(c.rules.length).toBeGreaterThan(0);
      expect(c.rules.every((f) => f.state === state)).toBe(true);
      expect(c.genericCatalog.state).toBe(state);
      expect(c.facts.state).toBe(state);
      expect(c.families?.families).toHaveLength(32);
      expect(c.rigor?.tiers.map((t) => t.id)).toEqual([...RIGOR_TIERS]);
      expect(c.rules.flatMap((f) => f.ruleSets).filter((r) => r.kind === "state_graduation")).toHaveLength(1);
    }
  });
});

describe("every requirement is cited", () => {
  it("has a quote with an https source for every requirement, check, condition, warning, card and family line", () => {
    const { statements, issues } = citationCoverageIssues(content);
    expect(issues).toEqual([]);
    expect(statements).toBeGreaterThan(500);
  });

  it("backs every strength word with the quote that sets it", () => {
    expect(strengthWordIssues(content.rules)).toEqual([]);
  });

  it("renders the strength from the rule's own word (UT Knoxville's 16 units are strongly encouraged, not required)", () => {
    const utk = byId("utk.core16");
    expect(utk.strength).toBe("strongly_encouraged");
    const file = content.rules.find((f) => f.ruleSets.includes(utk))!;
    expect(file.citations.find((c) => c.id === utk.strengthCite)?.quote).toMatch(/not required for admission but strongly encouraged/);
    expect(`${STRENGTH_PHRASES[utk.strength]} ${utk.issuer.name}`).toBe("Strongly encouraged by UT Knoxville");
    expect(byId("utc.units").strength).toBe("required");
    expect(byId("usu.recommended").strength).toBe("recommended");
  });

  it("uses each citation id for one quote only", () => {
    const seen = new Map<string, string>();
    for (const { file } of contentFiles()) {
      for (const c of file.citations) {
        const body = `${c.source}|${c.quote}|${file.sources[c.source].url}`;
        expect(seen.get(c.id) ?? body).toBe(body);
        seen.set(c.id, body);
      }
    }
  });
});

describe("cohorts", () => {
  const cohortValue = (key: RuleSet["cohortKey"], classYear: number) =>
    key === "class_year" ? classYear : key === "grade9_entry_year" ? classYear - 4 : classYear - 6;
  const variantFor = (rs: RuleSet, classYear: number): { variant: Variant; projected: boolean } | null => {
    const value = cohortValue(rs.cohortKey, classYear);
    const matches = rs.variants.filter((v) => (v.cohort.from ?? -Infinity) <= value && value <= (v.cohort.to ?? Infinity));
    const projected = rs.projectedBeyond !== undefined && value > rs.projectedBeyond;
    if (matches.length === 1) return { variant: matches[0], projected };
    if (matches.length === 0 && projected) {
      const latest = [...rs.variants].sort((a, b) => (b.cohort.from ?? -Infinity) - (a.cohort.from ?? -Infinity))[0];
      return { variant: latest, projected };
    }
    return null;
  };

  it("resolves every current class (2027-2032, and through 2034) to exactly one graduation variant", () => {
    for (const rs of ruleSets.filter((r) => r.kind === "state_graduation")) {
      for (let year = COHORT_COVERAGE.fromClass; year <= COHORT_COVERAGE.toClass; year++) {
        expect(variantFor(rs, year), `${rs.id} class of ${year}`).not.toBeNull();
      }
    }
  });

  it("labels classes the states haven't published for as projected, and current high schoolers as not", () => {
    for (const rs of ruleSets.filter((r) => r.kind === "state_graduation")) {
      for (const year of [2027, 2028, 2029, 2030]) expect(variantFor(rs, year)?.projected, `${rs.id} ${year}`).toBe(false);
      for (const year of [2031, 2032]) expect(variantFor(rs, year)?.projected, `${rs.id} ${year}`).toBe(true);
    }
  });

  it("picks the right Utah, Tennessee and Texas variants", () => {
    const pick = (id: string, year: number) => variantFor(byId(id), year)?.variant.id;
    expect(pick("ut.grad", 2027)).toBe("ut.grad.2027");
    expect(pick("ut.grad", 2028)).toBe("ut.grad.2027");
    expect(pick("ut.grad", 2029)).toBe("ut.grad.2029");
    expect(pick("tn.grad", 2027)).toBe("tn.grad.2023");
    expect(pick("tn.grad", 2028)).toBe("tn.grad.2024");
    expect(pick("tx.fhsp.grad", 2029)).toBe("tx.fhsp.grad.pre2026");
    expect(pick("tx.fhsp.grad", 2030)).toBe("tx.fhsp.grad.2026");
  });

  it("makes every option extend the graduation variant of the same cohort", () => {
    for (const file of content.rules) {
      const grad = plannerContentFor(file.state).rules.flatMap((f) => f.ruleSets).find((r) => r.kind === "state_graduation")!;
      for (const rs of file.ruleSets.filter((r) => r.kind === "graduation_option")) {
        for (let year = 2027; year <= 2032; year++) {
          const option = variantFor(rs, year);
          const base = variantFor(grad, year);
          expect(option, `${rs.id} ${year}`).not.toBeNull();
          if (option?.variant.extends) expect(option.variant.extends, `${rs.id} ${year}`).toBe(base?.variant.id);
        }
      }
    }
  });

  it("has Utah's social studies step up to 3.5 credits with the new government class for the class of 2029", () => {
    const [v2027, v2029] = byId("ut.grad").variants;
    const units = (v: Variant, id: string) => (walkReqs(v.requirements).find((r) => r.id === id) as { units?: number } | undefined)?.units;
    expect(units(v2027, "ss.us_gov")).toBe(2);
    expect(units(v2029, "ss.acgc")).toBe(4);
    expect(units(v2027, "electives")).toBe(22);
    expect(units(v2029, "electives")).toBe(20);
  });

  it("requires Tennessee's computer science credit only from the 2024-25 9th graders on", () => {
    const [before, after] = byId("tn.grad").variants;
    expect(walkReqs(before.requirements).some((r) => r.id === "cs")).toBe(false);
    const cs = walkReqs(after.requirements).find((r) => r.id === "cs");
    expect(cs).toMatchObject({ kind: "credits", substitutesForOneOf: ["math.fourth", "sci.third"] });
  });

  it("switches Texas social studies to personal financial literacy for 2026-27 9th graders", () => {
    const [pre, post] = byId("tx.fhsp.grad").variants;
    expect(walkReqs(pre.requirements).map((r) => r.id)).toContain("ss.econ");
    expect(walkReqs(post.requirements).map((r) => r.id)).toContain("ss.pfl");
  });
});

describe("nothing unverified is stated as fact", () => {
  const text = allText();
  const stated = text.filter((t) => !t.where.endsWith("(unverified)"));

  it("has no research markers left in the text", () => {
    for (const t of text) expect(t.text, t.where).not.toMatch(/UNVERIFIED|⚠|TBD|\?\?|\(\?\)/);
  });

  it("makes conflicting and unverified rule sets say so", () => {
    for (const rs of ruleSets.filter((r) => r.confidence !== "verified")) {
      const flagged = rs.variants.some((v) => (v.unverified ?? []).length > 0 || (v.warnings ?? []).length > 0) || /ask your counselor/i.test(rs.plainSummary);
      expect(flagged, rs.id).toBe(true);
    }
    expect(byId("mtsu.suggested").confidence).toBe("conflicting");
    expect(byId("memphis.units").confidence).toBe("conflicting");
    expect(byId("apsu.prep").confidence).toBe("unverified");
  });

  it("keeps research gaps as ask-your-counselor cards, never facts", () => {
    const cards = content.rules.flatMap((f) => f.infoCards ?? []);
    const card = (id: string) => cards.find((c) => c.id === id)!;
    for (const id of ["ut.card.snow", "ut.card.slcc", "ut.card.first-credential", "tn.card.tsu", "tn.card.apsu", "tn.card.tennessee-tech", "tn.card.ut-southern", "tn.card.gams", "tn.card.utk-guarantee"]) {
      expect(card(id).confidence, id).not.toBe("verified");
      expect(card(id).text, id).toMatch(/ask your counselor|ask the university|check its admissions page/i);
    }
    expect(card("tx.card.uta").confidence).toBe("conflicting");
    for (const c of cards.filter((x) => x.confidence !== "verified")) expect(c.text, c.id).toMatch(/ask|check/i);
  });

  it("doesn't state the Opportunity Scholarship GPA weighting, Tennessee's social studies split, or UT Austin's Fall 2028 percentage", () => {
    for (const t of stated) {
      expect(t.text, t.where).not.toMatch(/3\.3 (un)?weighted|(un)?weighted 3\.3/i);
      expect(t.text, t.where).not.toMatch(/economics.{0,20}(½|half|0\.5) credit/i);
      expect(t.text, t.where).not.toMatch(/fall 2028|2028 applicants/i);
    }
    const tnSocial = walkReqs(byId("tn.grad").variants[1].requirements).filter((r) => r.id.startsWith("ss."));
    expect(tnSocial.every((r) => r.kind === "credits" && r.units <= 4)).toBe(true);
    expect(byId("tn.grad").variants.every((v) => v.unverified?.some((u) => u.id === "tn.grad.ss-split"))).toBe(true);
  });

  it("never hard-codes the changing Texas test-score route numbers", () => {
    for (const rs of [byId("tx.dla")]) {
      for (const t of rs.testRoutes ?? []) expect(t.text).not.toMatch(/\b(480|530|1070)\b/);
      expect(rs.variants.every((v) => v.unverified?.some((u) => u.id === "dla.test-scores"))).toBe(true);
    }
  });

  it("names no Tennessee career and technical programs of study (not verified)", () => {
    for (const fam of majorFamiliesContent().families) expect(fam.ctePathways.filter((p) => p.state === "TN"), fam.id).toEqual([]);
  });

  it("states no minimum ages or hours for nurse aides, EMTs or cosmetology", () => {
    for (const id of ["practical_nursing", "public_safety", "cosmetology"]) {
      const fam = majorFamiliesContent().families.find((f) => f.id === id)!;
      for (const s of [fam.summary, fam.math.note ?? "", ...fam.gates.map((g) => g.text), ...fam.cautions.map((c) => c.text)]) {
        expect(s, id).not.toMatch(/\b\d{2,4}\b\s*(years?|hours?)|at least \d+|age of \d+|\d+ or older/i);
      }
    }
  });

  it("makes no premed requirement claim and never mentions the closed New Century scholarship", () => {
    for (const t of text) {
      expect(t.text, t.where).not.toMatch(/pre-?med(ical)? requirement/i);
      expect(t.text, t.where).not.toMatch(/New Century/i);
    }
    for (const { file } of contentFiles()) {
      for (const c of file.citations) expect(c.quote).not.toMatch(/New Century/i);
      for (const s of Object.values(file.sources)) expect(s.title).not.toMatch(/New Century/i);
    }
  });
});

describe("Texas wording", () => {
  it("calls the DLA the course route to automatic admission, with the test-score route still open", () => {
    const dla = byId("tx.dla");
    expect(dla.title).toMatch(/the course route to automatic admission/);
    expect(dla.plainSummary).toMatch(/the course route to automatic admission/);
    expect(dla.plainSummary).toMatch(/test-score route/);
    expect(dla.testRoutes?.length).toBeGreaterThan(0);
    expect(dla.appliesWhen).toEqual({ choice: { key: "txAimDla", value: true } });
    const card = content.rules.flatMap((f) => f.infoCards ?? []).find((c) => c.id === "tx.card.automatic-admission")!;
    expect(card.text).toMatch(/course route/);
    expect(card.text).toMatch(/test-score route/);
  });

  it("uses the pinned Algebra II wording", () => {
    for (const v of byId("tx.dla").variants) expect(v.warnings?.find((w) => w.id === "dla.algebra-2")?.text).toBe(TX_ALGEBRA_2_NOTE);
  });

  it("never says no Algebra II means no TEXAS Grant or no TEOG", () => {
    for (const t of allText()) {
      expect(t.text, t.where).not.toMatch(/no TEXAS Grant|no TEOG|(not|in)eligible for (the )?(TEXAS Grant|TEOG)|TEXAS Grant requires Algebra II|lose (the )?TEXAS Grant/i);
    }
    const grant = byId("tx.texas-grant.priority");
    expect(grant.strength).toBe("priority");
    expect(grant.plainSummary).toMatch(/lowers your priority/);
    const teog = content.rules.flatMap((f) => f.infoCards ?? []).find((c) => c.id === "tx.card.teog")!;
    expect(teog.text).toMatch(/no high school class requirement/);
  });

  it("allows graduating without an endorsement only after 10th grade with a parent's written permission", () => {
    for (const v of byId("tx.fhsp.grad").variants) {
      expect(v.checks).toContainEqual(expect.objectContaining({ kind: "no_endorsement_after", grade: 10, needs: "parent_written_permission" }));
    }
  });

  it("puts the DLA on schedule by the end of 11th grade and requires an endorsement", () => {
    for (const v of byId("tx.dla").variants) {
      expect(v.checks).toContainEqual(expect.objectContaining({ kind: "on_schedule_by", req: "dla.alg2", grade: 11 }));
      expect(v.checks).toContainEqual(
        expect.objectContaining({ kind: "requires_rule_set", anyOf: ["tx.endorse.stem", "tx.endorse.business", "tx.endorse.public-services", "tx.endorse.arts-humanities", "tx.endorse.multidisciplinary"] }),
      );
    }
  });

  it("keeps Mathematical Models out of the endorsement and DLA 4th math", () => {
    const fourth = (rs: RuleSet, id: string) => walkReqs(rs.variants[1].requirements).find((r) => r.id === id) as Req & { select: Selector[] };
    for (const [rs, id] of [
      [byId("tx.dla"), "dla.math4"],
      [byId("tx.endorse.stem"), "e.math4"],
    ] as const) {
      expect(fourth(rs, id).select.some((s) => s.types?.includes("math.applied.models"))).toBe(false);
    }
    const third = walkReqs(byId("tx.fhsp.grad").variants[1].requirements).find((r) => r.id === "math.third") as Req & { select: Selector[] };
    expect(third.select.some((s) => s.types?.includes("math.applied.models"))).toBe(true);
  });

  it("models AP Computer Science A as counting for both math and a language", () => {
    const lote = byId("tx.fhsp.grad").variants[1].requirements.find((r) => r.id === "lote")!;
    const shared = walkReqs([lote]).find((r) => r.id === "lote.apcsa.shared");
    expect(shared).toMatchObject({ shareable: true, select: [{ types: ["cs.prog2"], levels: ["ap", "ib"] }] });
  });

  it("encodes UT Austin calculus readiness with its course route by 11th grade and its test routes", () => {
    const calc = byId("utaustin.calc-ready");
    expect(calc.appliesWhen.families).toEqual(["engineering", "computer_data_science", "natural_resources"]);
    const req = walkReqs(calc.variants[0].requirements)[0] as Req & { select: Selector[]; deadlineGrade?: number };
    expect(req.select[0].minLetter).toBe("B");
    expect(req.deadlineGrade).toBe(11);
    expect(calc.testRoutes?.[0].text).toMatch(/SAT Math 620.*ACT Math 26.*CLT Math 26.*December 10/);
  });
});

describe("state terms and levels", () => {
  it("labels college credit the way each state does, and warns that Utah's dual enrollment isn't college credit", () => {
    for (const state of PLANNER_STATES) {
      const facts = plannerContentFor(state).facts;
      expect(facts.terms?.map((t) => t.term)).toContain(STATE_LEVEL_LABELS[state].dual_enrollment);
    }
    const ut = plannerContentFor("UT").facts.terms!;
    expect(ut.find((t) => t.term === "Dual enrollment")?.meaning).toMatch(/isn't college credit/);
    expect(plannerContentFor("UT").facts.options.find((o) => o.kind === "college_credit")?.programName).toBe("Concurrent enrollment (CE)");
  });
});

describe("generic catalogs", () => {
  const matches = (sel: Selector, typeId: CourseTypeId, levels: readonly CourseTypeLevel[]) => {
    const type = getCourseType(typeId);
    if (sel.exclude?.includes(typeId)) return false;
    if (sel.types && !sel.types.includes(typeId)) return false;
    if (sel.capabilities && !sel.capabilities.some((c) => type.capabilities.includes(c))) return false;
    if (sel.subjects && !sel.subjects.includes(type.subject)) return false;
    if (sel.levels && !sel.levels.some((l) => levels.includes(l))) return false;
    if (sel.cte && type.cte === "never") return false;
    return true;
  };
  const satisfiable = (req: Req, catalog: GenericCatalogFile): boolean => {
    switch (req.kind) {
      case "credits":
      case "count":
        return req.select.some((sel) => catalog.courses.some((c) => matches(sel, c.typeId, c.levels)));
      case "same_language":
        return LANGUAGES.some((code) => catalog.courses.some((c) => c.typeId === `lang.${code}.${req.levels}`));
      case "all":
        return req.of.every((r) => satisfiable(r, catalog));
      case "any":
        return req.of.some((r) => satisfiable(r, catalog));
      case "choose":
        return req.of.filter((r) => satisfiable(r, catalog)).length >= req.n;
      case "option":
        return satisfiable(req.off, catalog);
      default:
        return true;
    }
  };

  it("offers classes that can meet every graduation requirement in generic mode", () => {
    for (const state of PLANNER_STATES) {
      const c = plannerContentFor(state);
      const grad = c.rules.flatMap((f) => f.ruleSets).find((r) => r.kind === "state_graduation")!;
      for (const v of grad.variants) for (const req of v.requirements) expect(satisfiable(req, c.genericCatalog), `${state} ${v.id} ${req.id}`).toBe(true);
    }
  });

  it("offers Utah's new government class only from 2027-28", () => {
    expect(plannerContentFor("UT").genericCatalog.courses.find((c) => c.typeId === "ss.ut_acgc")?.firstSchoolYear).toBe(2027);
    expect(plannerContentFor("UT").genericCatalog.courses.some((c) => c.typeId === "ss.us_gov")).toBe(false);
  });
});

describe("colleges", () => {
  it("names only colleges the admissions content knows, and gives each state a labeled default", () => {
    const known = new Set(content.rules.flatMap((f) => [...f.ruleSets.flatMap((r) => r.appliesWhen.colleges ?? []), ...(f.infoCards ?? []).flatMap((c) => (c.unitId ? [c.unitId] : []))]));
    for (const fam of majorFamiliesContent().families) for (const g of fam.gates) for (const id of g.colleges ?? []) expect(known.has(id), `${fam.id} ${g.id} ${id}`).toBe(true);
    for (const r of rigorContent().raises) for (const id of r.colleges) expect(known.has(id), r.id).toBe(true);
    expect(stateDefaultRuleSets("UT").map((r) => r.id)).toEqual(["usu.recommended"]);
    expect(stateDefaultRuleSets("TN").map((r) => r.id)).toEqual(["utk.core16"]);
    expect(stateDefaultRuleSets("TX").map((r) => r.id)).toEqual(["tamu.recommended"]);
  });

  it("finds course rules and cards for a college page", () => {
    expect(ruleSetsForCollege(228778).map((r) => r.id)).toEqual(["utaustin.prereq", "utaustin.calc-ready"]);
    expect(infoCardsForCollege(230737).map((c) => c.tests)).toEqual(["not_required"]);
    expect(findRuleSet("tx.dla")?.file.id).toBe("tx.options");
    expect(findRuleSet("nope")).toBeNull();
  });
});

describe("major prep", () => {
  it("covers all 32 families with a math target, at most 3 rigor-first subjects, and cited lines", () => {
    const families = majorFamiliesContent().families;
    expect(families.map((f) => f.id).sort()).toEqual([...FAMILY_IDS].sort());
    for (const f of families) {
      expect(f.math.target.length, f.id).toBeGreaterThan(0);
      expect(f.rigorFirst.length, f.id).toBeLessThanOrEqual(3);
    }
  });

  it("routes the research's example codes, sending pre-nursing to nursing", () => {
    const cases: [string, string | null][] = [
      ["51.3801", "nursing"],
      ["51.1105", "nursing"],
      ["51.1102", "pre_health"],
      ["51.0904", "public_safety"],
      ["51.0801", "allied_health"],
      ["13.1312", "music"],
      ["13.1202", "education"],
      ["19.0706", "education"],
      ["19.0701", "social_work"],
      ["30.1901", "kinesiology_public_health"],
      ["11.0701", "computer_data_science"],
      ["11.1003", "it_cybersecurity"],
      ["15.1201", "it_cybersecurity"],
      ["14.0901", "engineering"],
      ["15.0303", "engineering_tech"],
      ["40.0601", "math_physical_sciences"],
      ["26.0101", "biological_sciences"],
      ["50.0408", "architecture"],
      ["50.0605", "visual_arts"],
      ["50.0602", "theatre_dance_film"],
      ["50.0901", "music"],
      ["10.0304", "visual_arts"],
      ["09.0401", "communication"],
      ["52.0901", "culinary_hospitality"],
      ["52.0301", "business"],
      ["45.0601", "economics"],
      ["45.1001", "social_sciences_law"],
      ["47.0604", "transportation_maintenance"],
      ["47.0201", "construction_trades"],
      ["49.0102", "aviation"],
      ["12.0401", "cosmetology"],
      ["24.0101", "humanities"],
      ["25.0101", null],
    ];
    for (const [cip, family] of cases) expect(familyForCip(cip), cip).toBe(family);
  });

  it("can reach every family through some routing rule", () => {
    const reached = new Set(plannerContent().cipRouting!.rules.map((r) => r.family));
    for (const id of FAMILY_IDS) expect(reached.has(id), id).toBe(true);
  });

  it("links program gates to the rule sets that encode them", () => {
    const eng = majorFamiliesContent().families.find((f) => f.id === "engineering")!;
    expect(eng.gates.map((g) => g.ruleSetId).filter(Boolean)).toEqual(["utaustin.calc-ready", "tamu.engineering"]);
  });
});

describe("rigor", () => {
  const rigor = rigorContent();

  it("has the four tiers in order, with no college-level suggestions for open admission", () => {
    expect(rigor.tiers.map((t) => t.id)).toEqual([...RIGOR_TIERS]);
    expect(rigor.tiers[0]).toMatchObject({ id: "open", collegeLevelFromGrade: null, rigorFirstSubjects: 0 });
    for (const t of rigor.tiers.slice(1)) {
      expect(t.collegeLevelFromGrade).toBeGreaterThanOrEqual(10);
      expect(t.rigorFirstSubjects).toBeGreaterThan(0);
    }
  });

  it("states the owner's load limits and never offers a stretch or counts AP classes", () => {
    const load = rigor.guardrails.find((g) => g.id === "load")!;
    expect(load.text).toContain(`No more than ${DEFAULT_MAX_COLLEGE_LEVEL_PER_YEAR} college-level classes a year`);
    expect(load.text).toContain(`at ${COLLEGE_LEVEL_SOFT_WARNING_AT} or more`);
    expect(rigor.guardrails.find((g) => g.id === "no-ap-count")?.text).toMatch(/never scored or ranked/);
    for (const t of allText()) expect(t.text, t.where).not.toMatch(/\bstretch\b/i);
  });
});

describe("review status and staleness", () => {
  it("labels every file as not yet reviewed by a school counselor (no review gate in the proof of concept)", () => {
    for (const state of PLANNER_STATES) {
      for (const n of reviewNoticesFor(state, "2026-09-25")) {
        expect(n).toMatchObject({ status: "draft", label: "Not yet reviewed by a school counselor", stale: false, staleLabel: null });
      }
    }
  });

  it("reads 'being re-checked' after the school year ends, and after a rule set's own re-check date", () => {
    const later = reviewNoticesFor("TX", "2027-08-01");
    expect(later.every((n) => n.stale && n.staleLabel === "Checked for 2026-27; being re-checked. Ask your counselor.")).toBe(true);
    expect(ruleSetStaleness("tx.dla", "2027-06-29")).toEqual({ stale: false, label: null });
    expect(ruleSetStaleness("tx.dla", "2027-07-01")?.stale).toBe(true);
    expect(ruleSetStaleness("tx.fhsp.grad", "2027-07-01")?.stale).toBe(false);
    expect(ruleSetStaleness("nope", "2027-07-01")).toBeNull();
  });

  it("checks every file for the 2026-27 school year", () => {
    for (const { file } of contentFiles()) expect(file.verifiedForSchoolYear, file.id).toBe(2026);
  });
});

describe("rule files hold their own kinds", () => {
  it("keeps graduation, option, admission and aid rule sets in their files", () => {
    const kinds = (file: RuleFile) => [...new Set(file.ruleSets.map((r) => r.kind))];
    for (const file of content.rules) {
      if (file.kind === "graduation") expect(kinds(file)).toEqual(["state_graduation"]);
      if (file.kind === "options") expect(kinds(file)).toEqual(["graduation_option"]);
    }
  });
});
