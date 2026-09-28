import { describe, expect, it } from "vitest";
import { type SchoolGrade } from "../common";
import { getCourseType, isCollegeLevel } from "../course-types";
import type { PathResult, PlannedPath, PlannerInput, PlanSlot } from "../engine-io";
import type { Req, RuleFile } from "../rules";
import { walkReqs } from "../validate";
import { defaultGrades } from "./catalog";
import { slotHalves } from "./model";
import { plan } from "./index";
import { randomInput } from "./testing/random";

// Property tests (design §10.1) over seeded random students, targets, limits and school lists.
// A failure prints its seed; replay it with randomInput(seed).

const RUNS = 250;
const SEEDS = Array.from({ length: RUNS }, (_, i) => 1000 + i * 7919);

type Case = { seed: number; input: PlannerInput; result: PathResult };

const cases: Case[] = SEEDS.map((seed) => {
  const input = randomInput(seed);
  return { seed, input, result: plan(input) };
});

function plannedCases(): (Case & { path: PlannedPath })[] {
  return cases.filter((c): c is Case & { result: PlannedPath } => c.result.mode !== "no_state").map((c) => ({ ...c, path: c.result as PlannedPath }));
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }>;

function eachYear(path: PlannedPath, fn: (planId: string, grade: number, slots: PlanSlot[], y: PlannedPath["plans"][number]["years"][number]) => void) {
  for (const p of path.plans) for (const y of p.years) fn(p.id, y.grade, y.slots, y);
}

function firstPlanGrade(input: PlannerInput): number {
  return input.asOf.month === 6 || input.asOf.month === 7 ? input.student.grade + 1 : input.student.grade;
}

describe("planner properties", () => {
  it("covers every state and stage", () => {
    const planned = plannedCases();
    expect(new Set(planned.map((c) => c.path.state))).toEqual(new Set(["TX", "TN", "UT"]));
    expect(planned.some((c) => c.path.stage === "middle_school")).toBe(true);
    expect(planned.some((c) => c.path.mode !== "generic")).toBe(true);
  });

  it("is deterministic: same input, byte-identical output", () => {
    for (const { seed, input, result } of cases.slice(0, 60)) {
      const again = plan(structuredClone(input));
      expect(JSON.stringify(again), `seed ${seed}`).toBe(JSON.stringify(result));
    }
  });

  it("is plain JSON", () => {
    for (const { seed, result } of cases.slice(0, 40)) expect(JSON.parse(JSON.stringify(result)), `seed ${seed}`).toEqual(result);
  });

  it("never moves, changes or removes a class the student chose", () => {
    for (const { seed, input, path } of plannedCases()) {
      if (path.stage === "middle_school") continue;
      const from = firstPlanGrade(input);
      for (const p of path.plans) {
        for (const course of input.courses.filter((c) => c.grade >= Math.max(9, from))) {
          const found = p.years.flatMap((y) => y.slots.filter((s) => s.kind === "yours" && s.courseId === course.id).map((s) => ({ s, grade: y.grade })));
          expect(found, `seed ${seed} course ${course.id}`).toHaveLength(1);
          const { s, grade } = found[0];
          expect(grade).toBe(course.grade);
          if (s.kind !== "yours") continue;
          expect([s.typeId, s.level, s.title, s.units, s.status]).toEqual([course.typeId, course.level, course.name, course.units, course.status]);
        }
      }
    }
  });

  it("never suggests past a year's capacity or the student's college-level cap", () => {
    for (const { seed, input, path } of plannedCases()) {
      eachYear(path, (planId, grade, slots, y) => {
        const own = input.courses.filter((c) => c.grade === grade);
        const ownHalves = own.reduce((n, c) => n + slotHalves(c.term, c.units), 0);
        const suggested = slots.filter((s): s is Suggested => s.kind === "suggested" && s.term !== "summer");
        const halves = suggested.reduce((n, s) => n + slotHalves(s.term, s.units), 0);
        if (halves > 0) expect(ownHalves + halves, `seed ${seed} plan ${planId} grade ${grade}`).toBeLessThanOrEqual(y.capacity.classes * 2);
        const collegeSuggested = suggested.filter((s) => s.collegeLevel).length;
        if (collegeSuggested > 0) {
          const total = own.filter((c) => isCollegeLevel(c.level)).length + collegeSuggested;
          expect(total, `seed ${seed} plan ${planId} grade ${grade}`).toBeLessThanOrEqual(input.prefs.limits.maxCollegeLevelPerYear);
        }
        expect(y.load.warning).toBe(y.load.collegeLevel >= 4);
      });
    }
  });

  it("suggests nothing in grades 7-8, no rigor in 12th, and no acceleration in Plan A", () => {
    for (const { seed, path } of plannedCases()) {
      eachYear(path, (planId, grade, slots) => {
        const suggested = slots.filter((s): s is Suggested => s.kind === "suggested");
        expect(grade, `seed ${seed}`).toBeGreaterThanOrEqual(9);
        if (grade === 12) for (const s of suggested) expect(s.reasons.some((r) => r.kind === "rigor"), `seed ${seed} ${s.key}`).toBe(false);
        if (planId === "A" && path.planChoice?.kind !== "math_route") for (const s of suggested) expect(s.term, `seed ${seed}`).not.toBe("summer");
      });
      const sketch = path.middleSchool?.ninthGradeSketch;
      if (sketch) for (const s of sketch.slots) if (s.kind === "suggested") expect(s.collegeLevel).toBe(false);
    }
  });

  it("adds no second math class to a year without the opt-in and a B or better (a senior's required credit aside)", () => {
    for (const { seed, input, path } of plannedCases()) {
      const last = input.courses.filter((c) => c.subject === "math" && c.status === "completed" && c.finalGrade).sort((a, b) => b.grade - a.grade)[0];
      const bOrBetter = !!last && ["A+", "A", "A-", "B+", "B"].includes(last.finalGrade!);
      if (input.prefs.limits.accelerateMath && bOrBetter) continue;
      eachYear(path, (planId, grade, slots) => {
        const suggestedMath = slots.filter((s): s is Suggested => s.kind === "suggested" && s.term !== "summer" && getCourseType(s.typeId).subject === "math" && !s.needsPlanNow);
        if (!suggestedMath.length) return;
        const ownMath = slots.filter((s) => s.kind === "yours" && getCourseType(s.typeId).subject === "math" && s.status !== "completed");
        expect(ownMath.length + suggestedMath.length, `seed ${seed} ${planId} ${grade}: ${suggestedMath.map((s) => s.typeId).join(", ")}`).toBeLessThanOrEqual(1);
      });
    }
  });

  it("respects prerequisites and grade availability", () => {
    for (const { seed, input, path } of plannedCases()) {
      for (const p of path.plans) {
        const items = [
          ...input.courses.filter((c) => !(c.status === "completed" && (c.finalGrade === "F" || c.finalGrade === "W" || c.finalGrade === "I"))).map((c) => ({ typeId: c.typeId, grade: c.grade as number, summer: c.term === "summer" })),
          ...p.years.flatMap((y) => y.slots.filter((s): s is Suggested => s.kind === "suggested").map((s) => ({ typeId: s.typeId, grade: y.grade as number, summer: s.term === "summer" }))),
        ];
        for (const y of p.years) {
          for (const s of y.slots) {
            if (s.kind !== "suggested") continue;
            const printed = s.catalogCourseId ? input.catalogs[y.grade as SchoolGrade]?.courses.find((c) => c.id === s.catalogCourseId) : undefined;
            const allowed = printed?.grades ?? defaultGrades(s.typeId);
            expect(allowed, `seed ${seed} ${s.typeId} in ${y.grade}`).toContain(y.grade);
            // Type prerequisites (English I-IV follow the grade; printed prerequisites are the list's own).
            if (s.typeId.startsWith("ela.") || (printed && printed.prereqs.length > 0)) continue;
            for (const group of getCourseType(s.typeId).prereqs) {
              const ladder = getCourseType(group.anyOf[0]).ladder;
              const maxRank = Math.max(...group.anyOf.map((t) => getCourseType(t).ladder?.rank ?? 0));
              const met = items.some((i) => {
                // Earlier grades come first; a summer class comes after the school year it follows.
                const before = i.grade < y.grade || (s.term === "summer" && i.grade === y.grade && !i.summer);
                if (!before) return false;
                if (group.anyOf.includes(i.typeId)) return true;
                const l = getCourseType(i.typeId).ladder;
                return !!ladder && !!l && l.id === ladder.id && l.rank >= maxRank;
              });
              expect(met, `seed ${seed}: ${s.typeId} in ${y.grade} needs one of ${group.anyOf.join(", ")}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("in catalog mode, suggests only classes on the list in use", () => {
    for (const { seed, input, path } of plannedCases()) {
      for (const p of path.plans) {
        for (const y of p.years) {
          const list = input.catalogs[y.grade as SchoolGrade];
          for (const s of y.slots) {
            if (s.kind !== "suggested") continue;
            if (!list) {
              expect(s.catalogCourseId, `seed ${seed}`).toBeNull();
              continue;
            }
            const confirmed = list.confirmedSubjects === "all" || list.confirmedSubjects.includes(getCourseType(s.typeId).subject);
            if (confirmed) expect(list.courses.some((c) => c.id === s.catalogCourseId), `seed ${seed} ${s.typeId}`).toBe(true);
            expect(s.genericTitle).toBe(getCourseType(s.typeId).title);
          }
        }
      }
    }
  });

  it("never double-counts a class in an exclusive rule set, unless a rule allows sharing", () => {
    for (const { seed, input, path } of plannedCases()) {
      const leafById = new Map<string, Req>();
      const exclusive = new Set<string>();
      for (const file of input.content!.rules as RuleFile[]) {
        for (const rs of file.ruleSets) {
          for (const v of rs.variants) {
            if (v.allocation === "exclusive") exclusive.add(rs.id);
            for (const r of walkReqs(v.requirements)) leafById.set(`${rs.id}/${r.id}`, r);
          }
        }
      }
      for (const rs of path.audit) {
        if (!exclusive.has(rs.ruleSetId)) continue;
        const subTargets = new Set<string>();
        for (const r of rs.requirements) {
          const leaf = leafById.get(`${rs.ruleSetId}/${r.reqId}`);
          if (leaf?.kind === "credits") for (const t of leaf.substitutesForOneOf ?? []) subTargets.add(t);
        }
        const used = new Map<string, number>();
        const langUsed = new Set<string>();
        for (const r of rs.requirements) {
          const leaf = leafById.get(`${rs.ruleSetId}/${r.reqId}`);
          if (!leaf || leaf.kind === "total_credits" || leaf.kind === "count" || (leaf.kind === "credits" && leaf.shareable)) continue;
          if (leaf.kind === "same_language") {
            for (const c of r.counted) langUsed.add(JSON.stringify(c.ref));
            continue;
          }
          if (subTargets.size && [...subTargets].some((t) => r.reqId === t || leafById.get(`${rs.ruleSetId}/${t}`)?.kind !== "credits")) continue;
          for (const c of r.counted) {
            const key = JSON.stringify(c.ref);
            used.set(key, (used.get(key) ?? 0) + c.amount);
          }
        }
        const unitsOf = (ref: string) => {
          const parsed = JSON.parse(ref) as { kind: string; courseId?: string; key?: string };
          if (parsed.kind === "course") return input.courses.find((c) => c.id === parsed.courseId)!.units;
          const s = path.plans.flatMap((p) => p.years.flatMap((y) => y.slots)).find((x) => x.kind === "suggested" && x.key === parsed.key);
          return s && s.kind === "suggested" ? s.units : Infinity;
        };
        for (const [ref, amount] of used) {
          expect(amount, `seed ${seed} ${rs.ruleSetId} ${ref}`).toBeLessThanOrEqual(unitsOf(ref));
          expect(langUsed.has(ref), `seed ${seed} ${rs.ruleSetId} ${ref} counted as a language and something else`).toBe(false);
        }
      }
    }
  });

  it("keeps plans, options and labels within the contract", () => {
    for (const { seed, path, input } of plannedCases()) {
      expect(path.plans.length, `seed ${seed}`).toBeLessThanOrEqual(2);
      if (path.plans.length === 2) expect(path.planChoice).not.toBeNull();
      for (const p of path.plans) expect(p.label).not.toMatch(/\b(better|harder|best|stronger|easier)\b/i);
      for (const g of path.gaps) {
        expect(g.options.length).toBeGreaterThanOrEqual(1);
        expect(g.options.length).toBeLessThanOrEqual(3);
        expect(g.options[g.options.length - 1].kind).toBe("ask_counselor");
        expect(g.text).not.toMatch(/\bbehind\b/i);
      }
      expect(path.askCounselor.length).toBeGreaterThanOrEqual(3);
      expect(path.askCounselor.length).toBeLessThanOrEqual(8);
      const dismissed = new Set(input.prefs.dismissed);
      for (const p of path.plans) for (const y of p.years) for (const s of y.slots) if (s.kind === "suggested") expect(dismissed.has(s.key.replace(/#\d+$/, ""))).toBe(false);
    }
  });

  it("explains every line, with sources that resolve", () => {
    for (const { seed, path } of plannedCases()) {
      for (const p of path.plans) {
        for (const y of p.years) {
          for (const s of y.slots) {
            if (s.kind !== "suggested") continue;
            expect(s.reasons.length, `seed ${seed} ${s.key}`).toBeGreaterThan(0);
            // A quoted source, or the student's own choice (a CTE pathway they picked).
            expect(s.reasons.some((r) => r.citations.length > 0 || r.kind === "choice"), `seed ${seed} ${s.key} has no source`).toBe(true);
          }
        }
      }
      for (const rs of path.audit) for (const r of rs.requirements) expect(r.reasons.length).toBeGreaterThan(0);
      for (const g of path.gaps) expect(g.reasons.length, `seed ${seed} ${g.id}`).toBeGreaterThan(0);
      for (const d of path.deadlines) expect(d.reasons.length).toBeGreaterThan(0);
      const cited = new Set<string>();
      JSON.stringify(path, (key, value) => {
        if (key === "citations" && Array.isArray(value)) for (const c of value) cited.add(c);
        return value;
      });
      for (const id of cited) expect(path.citations[id], `seed ${seed} citation ${id}`).toBeDefined();
    }
  });

  it("is monotonic: a finished, passed class never turns Done into Room to add", () => {
    for (const { seed, input, path } of plannedCases().slice(0, 120)) {
      const grade = Math.max(9, input.student.grade - 1) as SchoolGrade;
      if (grade >= input.student.grade) continue;
      const extra = structuredClone(input);
      const typeId = input.content!.genericCatalog.courses[seed % input.content!.genericCatalog.courses.length].typeId;
      const type = getCourseType(typeId);
      extra.courses.push({
        ...input.courses[0] ?? ({} as PlannerInput["courses"][number]),
        id: "extra",
        name: type.title,
        typeId,
        typeSource: "student",
        assumed: false,
        level: "regular",
        subject: type.subject,
        grade,
        schoolYear: input.student.cohort.grade9EntryYear + (grade - 9),
        term: type.units <= 2 ? "fall" : "full_year",
        units: type.units,
        status: "completed",
        finalGrade: "A",
        highSchoolCredit: true,
        cte: type.cte === "always",
        lectureOnly: false,
        catalogCourseId: null,
        origin: "typed",
      });
      const after = plan(extra);
      if (after.mode === "no_state") continue;
      for (const rs of path.audit) {
        const rs2 = after.audit.find((r) => r.ruleSetId === rs.ruleSetId);
        if (!rs2) continue;
        for (const r of rs.requirements) {
          if (r.status !== "done") continue;
          const r2 = rs2.requirements.find((x) => x.reqId === r.reqId);
          if (r2) expect(r2.status, `seed ${seed} ${rs.ruleSetId}/${r.reqId}`).not.toBe("room_to_add");
        }
      }
    }
  });
});
