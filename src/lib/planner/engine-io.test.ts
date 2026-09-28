import { describe, expect, expectTypeOf, it } from "vitest";
import { DRAFT_BANNER, STANDING_PLAN_NOTE } from "./copy";
import {
  type ChoiceKey,
  COLLEGE_LEVEL_SOFT_WARNING_AT,
  DEFAULT_LIMITS,
  type Gap,
  type GapOption,
  type PathResult,
  type PlannedPath,
  type PlanOption,
  type Reason,
  suggestionKey,
} from "./engine-io";
import { fixturePlannerInput } from "./fixtures";
import type { Check, ChoiceGate, OptionPref } from "./rules";

const reason: Reason = {
  kind: "requirement",
  text: "Texas needs Algebra II for the Distinguished Level of Achievement.",
  claim: "rule",
  strength: "required",
  ruleSetId: "fx.tx.dla",
  reqId: "dla.alg2",
  familyId: null,
  citations: ["fx-dla"],
  params: {},
};

const ask: GapOption = { kind: "ask_counselor", text: "Ask your counselor", note: "", closes: null, adds: [], citations: [] };
const plan: PlanOption = { id: "A", label: "Plan A", years: [], audit: [], gaps: [], deadlines: [], askCounselor: [] };

describe("engine input", () => {
  it("is plain JSON, so the engine can stay pure and deterministic", () => {
    const input = fixturePlannerInput();
    expect(JSON.parse(JSON.stringify(input))).toEqual(input);
    expect(input.student.cohort).toMatchObject({ grade9EntryYear: 2025, classYear: 2029 });
  });

  it("defaults to at most 3 college-level classes a year, with a soft warning at 4", () => {
    expect(DEFAULT_LIMITS.maxCollegeLevelPerYear).toBe(3);
    expect(COLLEGE_LEVEL_SOFT_WARNING_AT).toBe(4);
    expect(DEFAULT_LIMITS.accelerateMath).toBe(false);
  });

  it("stores every choice a rule gates on or reads", () => {
    expectTypeOf<ChoiceGate["key"]>().toExtend<ChoiceKey>();
    expectTypeOf<OptionPref>().toExtend<ChoiceKey>();
    expectTypeOf<Extract<Check, { kind: "senior_year_math" }>["unlessChoice"]>().toExtend<ChoiceKey>();
  });

  it("keys suggestions by what they're for, the type and the level", () => {
    expect(suggestionKey({ ruleSetId: "tx.fhsp.grad", reqId: "sci.third" }, "sci.chem", "honors")).toBe("tx.fhsp.grad/sci.third/sci.chem/honors");
    expect(suggestionKey({ prep: "nursing" }, "sci.anat", "regular")).toBe("prep:nursing/sci.anat/regular");
  });
});

describe("engine output", () => {
  it("can express a minimal planned path", () => {
    const gap: Gap = {
      id: "gap.alg2",
      kind: "unmet",
      priority: 1,
      demandId: "d.alg2",
      text: "Room to add Algebra II by the end of 11th grade.",
      decideBy: { grade: 11, point: "end" },
      options: [ask],
      reasons: [reason],
    };
    const path: PlannedPath = {
      mode: "generic",
      state: "TX",
      stage: "high_school",
      inputsFingerprint: "0123456789abcdef",
      notices: { draft: DRAFT_BANNER, standing: STANDING_PLAN_NOTE, review: [] },
      builtFrom: { ruleSets: [], catalogs: [], families: [], colleges: [], rigor: { tier: "admits_most", why: "No colleges on your list yet." } },
      deadlines: [{ id: "dl.alg2", kind: "rule", by: { grade: 11, point: "end" }, text: "Algebra II by the end of 11th.", slackYears: 0, reasons: [reason] }],
      decisions: [],
      plans: [plan],
      planChoice: null,
      gaps: [gap],
      audit: [],
      demands: [],
      askCounselor: [],
      confirm: [],
      middleSchool: null,
      citations: {},
    };
    const result: PathResult = path;
    expect(result.mode).toBe("generic");
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("allows at most two plans and at most three options per gap", () => {
    const planB: PlanOption = { ...plan, id: "B" };
    // @ts-expect-error: never more than two plans
    const tooManyPlans: PlannedPath["plans"] = [plan, planB, planB];
    // @ts-expect-error: at most three options per gap
    const tooManyOptions: Gap["options"] = [ask, ask, ask, ask];
    // @ts-expect-error: every gap has at least one option ("ask your counselor")
    const noOptions: Gap["options"] = [];
    expect([tooManyPlans, tooManyOptions, noOptions]).toHaveLength(3);
  });
});
