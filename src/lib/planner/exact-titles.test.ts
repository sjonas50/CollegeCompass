import { describe, expect, it } from "vitest";
import type { CourseLevel, CourseSubject } from "@/db/schema";
import type { PlannerState } from "./common";
import { exactRowType, guessCourseType, resolveRowCourseType } from "./course-type-guess";
import { type CourseTypeId, type CourseTypeLevel, getCourseType } from "./course-types";
import { exactCourseType, exactTitlesFor, titleWords } from "./exact-titles";

// Exact titles (exact-titles.ts): a typed name that's the official or canonical title of exactly one
// kind of class in the student's state is that kind, with nothing to confirm. Everything else stays
// a guess to confirm (engine/confirm.ts).

const STATES = ["TX", "TN", "UT"] as const;

/** In 2026-27 unless another school year is given (null: not known). */
const exact = (name: string, subject: CourseSubject, state: PlannerState, level: CourseTypeLevel = "regular", schoolYear: number | null = 2026) =>
  exactRowType(name, subject, level, state, schoolYear);
const exactId = (name: string, subject: CourseSubject, state: PlannerState, level: CourseTypeLevel = "regular", schoolYear: number | null = 2026) =>
  exact(name, subject, state, level, schoolYear)?.typeId ?? null;
/** The level a class of this kind is usually recorded at: regular, or its only level (AP Seminar). */
const usualLevel = (typeId: CourseTypeId): CourseTypeLevel => (getCourseType(typeId).levels.includes("regular") ? "regular" : getCourseType(typeId).levels[0]);

describe("titleWords", () => {
  it("ignores case, spaces, accents and punctuation, reads 1-4 as roman numerals, and splits a glued honors letter", () => {
    expect(titleWords("  ALGEBRA   1 ")).toEqual(["algebra", "i"]);
    expect(titleWords("U.S. History")).toEqual(titleWords("US history"));
    expect(titleWords("U. S. Government & Civics")).toEqual(["us", "government", "and", "civics"]);
    expect(titleWords("Skill-Based Lifetime Activities")).toEqual(["skill", "based", "lifetime", "activities"]);
    expect(titleWords("English 10H")).toEqual(["english", "10", "h"]);
    expect(titleWords("English 12")).toEqual(["english", "12"]);
    expect(titleWords("Alg 2/Trig")).toEqual(["alg", "ii", "/", "trig"]);
    expect(titleWords("Français I")).toEqual(["francais", "i"]);
  });
});

describe("the demo Texas 9th grader", () => {
  const rows: [string, CourseSubject, CourseTypeId | null][] = [
    ["Algebra I", "math", "math.alg1"],
    ["English I", "english", "ela.9"],
    ["Geometry", "math", "math.geom"],
    ["Biology", "science", "sci.bio"],
    ["World Geography", "social_studies", "ss.world_geo"],
    ["Spanish I", "world_language", "lang.es.1"],
    ["Principles of Applied Engineering", "career_technical", "cte.engineering_design"],
    ["Alg 2/Trig", "math", null],
  ];
  it("seven exact titles are their kinds with nothing to confirm; \"Alg 2/Trig\" stays a guess to confirm", () => {
    for (const [name, subject, typeId] of rows) {
      const resolved = resolveRowCourseType({ name, subject, level: "regular" }, "TX");
      if (typeId) expect(resolved, name).toEqual({ typeId, level: "regular", source: "exact", assumed: false });
      else expect(resolved, name).toMatchObject({ typeId: "math.alg2", source: "guess", assumed: true });
    }
  });
});

describe("each state's official and canonical titles", () => {
  for (const state of STATES) {
    it(`${state}: every title in the state's list is exact for its kind, except a title joining two classes`, () => {
      let checked = 0;
      for (const { title, typeId } of exactTitlesFor(state)) {
        const got = exactId(title, getCourseType(typeId).subject, state, usualLevel(typeId));
        // "Personal Financial Literacy and Economics" is one Texas class, but its name joins two.
        if (typeId === "ss.pfl_econ") expect(got, title).toBeNull();
        else expect(got, `${title} (${state})`).toBe(typeId);
        checked++;
      }
      expect(checked).toBeGreaterThan(100);
    });

    it(`${state}: no title names two kinds, and the guesser never reads an exact title as another kind`, () => {
      const kinds = new Map<string, Set<CourseTypeId>>();
      for (const { title, typeId } of exactTitlesFor(state)) {
        const key = titleWords(title).join(" ");
        kinds.set(key, (kinds.get(key) ?? new Set()).add(typeId));
        // The add form pre-selects a confident guess, so it must agree with the exact kind.
        const guess = guessCourseType(title, getCourseType(typeId).subject, state, { level: usualLevel(typeId), schoolYear: 2026 });
        if (guess.confident) expect(guess.typeId, `${title} (${state})`).toBe(typeId);
      }
      expect([...kinds].filter(([, v]) => v.size > 1)).toEqual([]);
    });
  }

  it("Texas: the TEKS and TEA titles", () => {
    for (const [name, subject, typeId] of [
      ["Lifetime Fitness and Wellness Pursuits", "health_pe", "pe.fitness"],
      ["Lifetime Fitness & Wellness Pursuits", "health_pe", "pe.fitness"],
      ["Lifetime Recreation and Outdoor Pursuits", "health_pe", "pe.lifetime"],
      ["Skill-Based Lifetime Activities", "health_pe", "pe.skills"],
      ["Integrated Physics and Chemistry", "science", "sci.ipc"],
      ["World Geography Studies", "social_studies", "ss.world_geo"],
      ["World History Studies", "social_studies", "ss.world_hist"],
      ["United States History Studies Since 1877", "social_studies", "ss.us_hist"],
      ["Economics with Emphasis on the Free Enterprise System and Its Benefits", "social_studies", "ss.econ"],
      ["Mathematical Models with Applications", "math", "math.applied.models"],
      ["Principles of Health Science", "career_technical", "cte.health_principles"],
      ["Engineering Design and Problem Solving", "career_technical", "cte.engineering_problem_solving"],
      ["Computer Science I", "computer_science", "cs.prog1"],
      ["English IV", "english", "ela.12"],
    ] as const) {
      expect(exactId(name, subject, "TX"), name).toBe(typeId);
    }
  });

  it("Tennessee: the state's course names (Policy 3.205)", () => {
    for (const [name, subject, typeId] of [
      ["Lifetime Wellness", "health_pe", "health.wellness"],
      ["U.S. History and Geography", "social_studies", "ss.us_hist"],
      ["United States History and Geography", "social_studies", "ss.us_hist"],
      ["World History and Geography", "social_studies", "ss.world_hist"],
      ["U.S. Government & Civics", "social_studies", "ss.us_gov"],
      ["Biology I", "science", "sci.bio"],
      ["Chemistry II", "science", "sci.chem2"],
      ["Personal Finance", "social_studies", "ss.pfl"],
      ["Coding I", "computer_science", "cs.prog1"],
      ["Computer Science Foundations", "computer_science", "cs.intro"],
      ["Integrated Math II", "math", "math.int2"],
      ["Mathematical Reasoning for Decision Making", "math", "math.applied.decision"],
      ["English Language Arts III", "english", "ela.11"],
    ] as const) {
      expect(exactId(name, subject, "TN"), name).toBe(typeId);
    }
  });

  it("Utah: the USBE titles", () => {
    for (const [name, subject, typeId] of [
      ["Secondary Mathematics I", "math", "math.ut_sec1"],
      ["Secondary Mathematics III", "math", "math.ut_sec3"],
      ["Secondary Math 2", "math", "math.ut_sec2"],
      ["English Language Arts 9", "english", "ela.9"],
      ["ELA 10", "english", "ela.10"],
      ["English 11", "english", "ela.11"],
      ["U.S. History 2", "social_studies", "ss.us_hist"],
      ["Geography for Life", "social_studies", "ss.world_geo"],
      ["American Constitutional Government and Citizenship (ACGC)", "social_studies", "ss.ut_acgc"],
      ["U.S. Government and Citizenship", "social_studies", "ss.us_gov"],
      ["General Financial Literacy", "social_studies", "ss.pfl"],
      ["Fitness for Life", "health_pe", "pe.fitness"],
      ["Participation Skills and Techniques", "health_pe", "pe.skills"],
      ["Individualized Lifetime Activities", "health_pe", "pe.lifetime"],
      ["Health II", "health_pe", "health.health"],
      ["Exploring Computer Science", "computer_science", "cs.intro"],
      ["Computer Programming 1", "computer_science", "cs.prog1"],
    ] as const) {
      expect(exactId(name, subject, "UT"), name).toBe(typeId);
    }
  });

  it("a state's own title is exact only in that state", () => {
    expect(exactId("Lifetime Wellness", "health_pe", "TX")).toBeNull();
    expect(exactId("Lifetime Wellness", "health_pe", "UT")).toBeNull();
    expect(exactId("Lifetime Fitness and Wellness Pursuits", "health_pe", "TN")).toBeNull();
    expect(exactId("Secondary Mathematics I", "math", "TX")).toBeNull();
    expect(exactId("U.S. History and Geography", "social_studies", "UT")).toBeNull();
    expect(exactId("Coding I", "computer_science", "UT")).toBeNull();
    // Without a state, nothing is exact: the name is guessed.
    expect(resolveRowCourseType({ name: "Biology", subject: "science", level: "regular" })).toMatchObject({ source: "guess", assumed: true });
  });

  it("a name the state's schools also use for another kind is never exact there (otherKindsInState)", () => {
    // Tennessee's required Lifetime Wellness is usually called "Health": only the state's own
    // "Health Education" (Policy 3.205 6.2) is its health class for sure.
    expect(exactId("Health", "health_pe", "TN")).toBeNull();
    expect(exactId("Health H", "health_pe", "TN")).toBeNull();
    expect(exactId("Health Education", "health_pe", "TN")).toBe("health.health");
    expect(exactTitlesFor("TN").filter((t) => t.typeId === "health.health").map((t) => t.title)).toEqual(["Health Education"]);
    expect(exactId("Health", "health_pe", "TX")).toBe("health.health");
    expect(exactId("Health", "health_pe", "UT")).toBe("health.health");
    // Utah's U.S. Government and Citizenship is replaced by ACGC in 2027-28 (UT-S4): its titles are
    // exact only before then, and never when the class's school year isn't known.
    for (const name of ["U.S. Government", "United States Government", "U.S. Government and Citizenship"]) {
      expect(exactId(name, "social_studies", "UT", "regular", 2026), name).toBe("ss.us_gov");
      expect(exactId(name, "social_studies", "UT", "regular", 2027), name).toBeNull();
      expect(exactId(name, "social_studies", "UT", "regular", 2030), name).toBeNull();
      expect(exactId(name, "social_studies", "UT", "regular", null), name).toBeNull();
    }
    expect(exactId("U.S. Government", "social_studies", "TX", "regular", 2028)).toBe("ss.us_gov");
    expect(exactId("American Constitutional Government and Citizenship", "social_studies", "UT", "regular", 2028)).toBe("ss.ut_acgc");
    // Utah's college-credit English 11 is ENGL 1010, college composition (UT-S3 p. 2).
    expect(exactId("English 11", "english", "UT", "dual_enrollment")).toBeNull();
    expect(exactId("English 11", "english", "UT")).toBe("ela.11");
    expect(exactId("English III Dual Credit", "english", "TX")).toBe("ela.11");
  });

  it("the kind must fit the row's subject", () => {
    expect(exactId("Chemistry", "career_technical", "TX")).toBeNull();
    expect(exactId("Accounting II", "math", "UT")).toBe("cte.accounting2");
  });
});

describe("titles that aren't exact stay guesses to confirm", () => {
  it("a title more than one kind has, in the state or in general, is never exact", () => {
    // Two kinds sharing a title in a state's list.
    const shared = [
      { title: "Integrated Science", typeId: "sci.ipc", source: "official" },
      { title: "Integrated Science", typeId: "sci.earth", source: "official" },
    ] as const;
    expect(exactCourseType("Integrated Science", "science", "regular", "TX", { titles: shared })).toBeNull();
    expect(exactCourseType("Integrated Science", "science", "regular", "TX", { titles: shared.slice(0, 1) })).toEqual({ typeId: "sci.ipc", level: "regular" });
    // Names that stand for a family of classes, or for different classes in different schools.
    for (const [name, subject, state] of [
      ["Wellness", "health_pe", "TN"],
      ["Health & Wellness", "health_pe", "UT"],
      ["Physical Education", "health_pe", "UT"],
      ["PE", "health_pe", "TX"],
      ["Math 1", "math", "UT"],
      ["Spanish", "world_language", "TX"],
      ["Government", "social_studies", "UT"],
      ["English", "english", "TN"],
      ["Computer Science", "computer_science", "TN"],
      ["Art", "arts", "TX"],
      ["Music", "arts", "UT"],
      ["Advanced Biology", "science", "TX"],
      ["Secondary Math IE", "math", "UT"],
    ] as const) {
      expect(exactId(name, subject, state), `${name} (${state})`).toBeNull();
    }
  });

  it("a title joining two classes is never exact", () => {
    for (const [name, subject, state] of [
      ["Gov/Econ", "social_studies", "TX"],
      ["Alg 2/Trig", "math", "TX"],
      ["Algebra II/Trigonometry", "math", "TN"],
      ["Algebra I & Geometry", "math", "TX"],
      ["Economics and Personal Finance", "social_studies", "TN"],
      ["Economics & Psychology", "social_studies", "UT"],
      ["Personal Financial Literacy and Economics", "social_studies", "TX"],
      ["Health/PE", "health_pe", "UT"],
      ["Biology + Chemistry", "science", "TX"],
      ["English I/II", "english", "TX"],
    ] as const) {
      expect(exactId(name, subject, state), `${name} (${state})`).toBeNull();
      expect(resolveRowCourseType({ name, subject, level: "regular" }, state), name).toMatchObject({ source: "guess", assumed: true });
    }
  });
});

describe("level markers only set the level", () => {
  it("a trailing or leading H, Honors, AP, Pre-AP, CE or dual credit marker sets the level of a row left at regular", () => {
    for (const [name, subject, state, typeId, level] of [
      ["Biology H", "science", "TX", "sci.bio", "honors"],
      ["Honors Biology", "science", "TX", "sci.bio", "honors"],
      ["Algebra 1H", "math", "TX", "math.alg1", "honors"],
      ["English 10H", "english", "UT", "ela.10", "honors"],
      ["Geometry Honors", "math", "TN", "math.geom", "honors"],
      ["U.S. History AP", "social_studies", "TX", "ss.us_hist", "ap"],
      ["AP US History", "social_studies", "TX", "ss.us_hist", "ap"],
      ["AP Human Geography", "social_studies", "UT", "ss.world_geo", "ap"],
      ["Precalculus AP", "math", "TX", "math.precalc", "ap"],
      ["Spanish IV AP", "world_language", "TX", "lang.es.4", "ap"],
      ["English 12 CE", "english", "UT", "ela.12", "dual_enrollment"],
      ["English IV Dual Credit", "english", "TX", "ela.12", "dual_enrollment"],
    ] as const) {
      expect(exact(name, subject, state), name).toEqual({ typeId, level });
      expect(resolveRowCourseType({ name, subject, level: "regular" }, state), name).toEqual({ typeId, level, source: "exact", assumed: false });
    }
  });

  it("Pre-AP is honors, never AP", () => {
    expect(exact("Pre-AP English I", "english", "TX")).toEqual({ typeId: "ela.9", level: "honors" });
    expect(exact("English I Pre-AP", "english", "TX")).toEqual({ typeId: "ela.9", level: "honors" });
    expect(exact("Pre-AP Spanish II", "world_language", "TX")).toEqual({ typeId: "lang.es.2", level: "honors" });
    expect(exact("Pre-AP English I", "english", "TX", "honors")).toEqual({ typeId: "ela.9", level: "honors" });
    // A row marked AP with a Pre-AP name isn't clear: a guess to confirm.
    expect(exact("Pre-AP English I", "english", "TX", "ap")).toBeNull();
    expect(resolveRowCourseType({ name: "Pre-AP English I", subject: "english", level: "ap" }, "TX")).toMatchObject({ source: "guess", assumed: true, level: "ap" });
  });

  it("a marker that could change the kind makes the title a guess", () => {
    for (const [name, subject, state, level] of [
      // AP, IB or college-credit Biology, Chemistry, Physics or Calculus may be the second-year class.
      ["AP Biology", "science", "TX", "regular"],
      ["Biology AP", "science", "TX", "regular"],
      ["Chemistry", "science", "TN", "ap"],
      ["Biology", "science", "TX", "ib"],
      ["Biology CE", "science", "UT", "regular"],
      ["Calculus AP", "math", "TX", "regular"],
      // Levels the kind isn't offered at: an AP English III is probably AP English Language.
      ["English III", "english", "TX", "ap"],
      ["English III AP", "english", "TX", "regular"],
      ["Spanish I AP", "world_language", "TX", "regular"],
      ["Algebra I AP", "math", "TX", "regular"],
      // Utah's CE or dual-credit English 11 is usually ENGL 1010, college composition.
      ["English 11 CE", "english", "UT", "regular"],
      ["CE English 11", "english", "UT", "regular"],
      ["English III Dual Credit", "english", "UT", "regular"],
      ["English 11 Concurrent Enrollment", "english", "UT", "regular"],
      // A marker that disagrees with the row's level, or two markers.
      ["Biology H", "science", "TX", "ap"],
      ["U.S. History AP", "social_studies", "TX", "honors"],
      ["Honors U.S. History AP", "social_studies", "TX", "regular"],
    ] as const) {
      expect(exact(name, subject, state, level), `${name} (${level})`).toBeNull();
    }
  });

  it("no marker changes the kind of any exact title, in any state", () => {
    const markers = ["H", "Honors", "AP", "Pre-AP", "CE", "Dual Credit"];
    let checked = 0;
    for (const state of STATES) {
      for (const { title, typeId } of exactTitlesFor(state)) {
        const subject = getCourseType(typeId).subject;
        for (const m of markers) {
          for (const marked of [`${title} ${m}`, `${m} ${title}`]) {
            const got = exactId(marked, subject, state);
            if (got !== null) expect(got, `${marked} (${state})`).toBe(typeId);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("the row's level stands when the title has no marker", () => {
    for (const level of ["regular", "honors", "ap", "dual_enrollment"] as CourseLevel[]) {
      expect(resolveRowCourseType({ name: "U.S. History", subject: "social_studies", level }, "TN")).toEqual({ typeId: "ss.us_hist", level, source: "exact", assumed: false });
    }
  });
});

describe("resolveRowCourseType tiers", () => {
  it("a stored kind wins over an exact title, and an exact title over a guess", () => {
    expect(resolveRowCourseType({ name: "Biology", subject: "science", level: "regular", courseTypeId: "sci.bio2", courseTypeSource: "student" }, "TX")).toEqual({
      typeId: "sci.bio2",
      level: "regular",
      source: "student",
      assumed: false,
    });
    expect(resolveRowCourseType({ name: "Biology", subject: "science", level: "regular" }, "TX")).toEqual({ typeId: "sci.bio", level: "regular", source: "exact", assumed: false });
    expect(resolveRowCourseType({ name: "Bio", subject: "science", level: "regular" }, "TX")).toEqual({ typeId: "sci.bio", level: "regular", source: "guess", assumed: true });
  });
});
