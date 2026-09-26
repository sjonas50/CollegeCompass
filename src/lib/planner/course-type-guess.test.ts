import { describe, expect, it } from "vitest";
import type { CourseSubject } from "@/db/schema";
import type { PlannerState } from "./common";
import { guessCourseTypeId, resolveRowCourseType } from "./course-type-guess";
import type { CourseTypeId } from "./course-types";

const CASES: [name: string, subject: CourseSubject, expected: CourseTypeId, state?: PlannerState][] = [
  ["English 9", "english", "ela.9"],
  ["Honors English I", "english", "ela.9"],
  ["English II", "english", "ela.10"],
  ["English 10", "english", "ela.10"],
  ["English III", "english", "ela.11"],
  ["English IV", "english", "ela.12"],
  ["ELA 8", "english", "ela.ms"],
  ["AP English Language and Composition", "english", "ela.lang_comp"],
  ["AP Lit", "english", "ela.lit_comp"],
  ["AP Seminar", "english", "ela.seminar"],
  ["Yearbook", "english", "ela.journalism"],
  ["English", "english", "ela.other"],
  ["Pre-Algebra", "math", "math.ms"],
  ["Math 8", "math", "math.ms"],
  ["Algebra 1", "math", "math.alg1"],
  ["Algebra I Honors", "math", "math.alg1"],
  ["Algebra II", "math", "math.alg2"],
  ["Algebraic Reasoning", "math", "math.alg_reasoning"],
  ["College Algebra", "math", "math.college_alg"],
  ["Geometry", "math", "math.geom"],
  ["Pre-Calculus", "math", "math.precalc"],
  ["AP Calculus AB", "math", "math.calc"],
  ["Calculus II", "math", "math.calc2"],
  ["AP Statistics", "math", "math.stats"],
  ["Secondary Math III", "math", "math.ut_sec3"],
  ["Sec Math 1 Honors", "math", "math.ut_sec1"],
  ["Math 2", "math", "math.ut_sec2", "UT"],
  ["Math 2", "math", "math.int2", "TN"],
  ["Integrated Math III", "math", "math.int3"],
  ["Math Models", "math", "math.applied.models"],
  ["Accounting", "math", "cte.accounting"],
  ["Accounting I", "career_technical", "cte.accounting"],
  ["Accounting II", "career_technical", "cte.accounting2"],
  ["Accounting 2", "math", "cte.accounting2"],
  ["Robotics", "career_technical", "cte.robotics"],
  ["Robotics II", "career_technical", "cte.robotics2"],
  ["Biology", "science", "sci.bio"],
  ["Honors Chem", "science", "sci.chem"],
  ["Chemistry II", "science", "sci.chem2"],
  ["AP Physics 1", "science", "sci.phys"],
  ["AP Physics C: Mechanics", "science", "sci.phys2"],
  ["IPC", "science", "sci.ipc"],
  ["APES", "science", "sci.env"],
  ["Anatomy & Physiology", "science", "sci.anat"],
  ["Anatomy and Physiology", "career_technical", "sci.anat"],
  ["Integrated Science 7", "science", "sci.ms"],
  ["APUSH", "social_studies", "ss.us_hist"],
  ["U.S. History", "social_studies", "ss.us_hist"],
  ["World Geography", "social_studies", "ss.world_geo"],
  ["AP Human Geography", "social_studies", "ss.world_geo"],
  ["Geography for Life", "social_studies", "ss.world_geo"],
  ["World/Cultural Geography CE", "social_studies", "ss.world_geo"],
  ["World History", "social_studies", "ss.world_hist"],
  ["Texas History", "social_studies", "ss.ms"],
  ["US Government", "social_studies", "ss.us_gov"],
  ["American Constitutional Government", "social_studies", "ss.ut_acgc"],
  ["PFL and Economics", "social_studies", "ss.pfl_econ"],
  ["Personal Finance", "other", "ss.pfl"],
  ["AP Macroeconomics", "social_studies", "ss.econ"],
  ["Spanish", "world_language", "lang.es.1"],
  ["Spanish 2", "world_language", "lang.es.2"],
  ["French III", "world_language", "lang.fr.3"],
  ["AP Spanish Language", "world_language", "lang.es.4"],
  ["ASL I", "world_language", "lang.asl.1"],
  ["Klingon", "world_language", "lang.other.1"],
  ["Band", "arts", "arts.ensemble"],
  ["Art I", "arts", "arts.visual"],
  ["Art 7", "arts", "arts.ms"],
  ["AP Music Theory", "arts", "arts.music_theory"],
  ["Theatre Arts", "arts", "arts.theatre"],
  ["Floral Design", "arts", "cte.floral_design"],
  ["AP Computer Science A", "computer_science", "cs.prog2"],
  ["AP CSP", "computer_science", "cs.principles"],
  ["Computer Science I", "computer_science", "cs.prog1"],
  ["Exploring Computer Science", "computer_science", "cs.intro"],
  ["Health", "health_pe", "health.health"],
  ["Lifetime Wellness", "health_pe", "health.wellness"],
  ["PE", "health_pe", "pe.general"],
  ["Varsity Basketball", "health_pe", "pe.athletics"],
  ["JROTC I", "other", "other.jrotc"],
  ["Principles of Health Science", "career_technical", "cte.health_principles"],
  ["Medical Terminology", "career_technical", "cte.medical_terminology"],
  ["Welding I", "career_technical", "cte.manufacturing.1"],
  ["Culinary Arts", "career_technical", "cte.hospitality.1"],
  ["Principles of Applied Engineering", "career_technical", "cte.engineering_design"],
  ["Something Else", "career_technical", "cte.other"],
  // A name matching another subject's type falls back within the row's subject.
  ["Chemistry", "career_technical", "cte.other"],
];

describe("guessCourseTypeId", () => {
  it.each(CASES)("%s (%s) -> %s", (name, subject, expected, state) => {
    expect(guessCourseTypeId(name, subject, state ?? null)).toBe(expected);
  });
});

describe("resolveRowCourseType", () => {
  it("uses a stored type as is, with the row's level", () => {
    expect(
      resolveRowCourseType({ name: "Chem H", subject: "science", level: "honors", courseTypeId: "sci.chem", courseTypeSource: "catalog" }),
    ).toEqual({ typeId: "sci.chem", level: "honors", source: "catalog", assumed: false });
  });

  it("guesses from the name when nothing is stored, and marks it assumed", () => {
    expect(resolveRowCourseType({ name: "Honors Chem", subject: "science", level: "honors" })).toEqual({
      typeId: "sci.chem",
      level: "honors",
      source: "guess",
      assumed: true,
    });
  });

  it("ignores a stored id the vocabulary doesn't know", () => {
    const resolved = resolveRowCourseType({ name: "Biology", subject: "science", level: "regular", courseTypeId: "sci.retired", courseTypeSource: "student" });
    expect(resolved).toMatchObject({ typeId: "sci.bio", assumed: true });
  });
});
