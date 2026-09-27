import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import type { CourseLevel, CourseStatus, CourseSubject } from "@/db/schema";
import { addNorthStar } from "@/lib/goals";
import { comingLaterNote, DRAFT_BANNER, STANDING_PLAN_NOTE } from "@/lib/planner/copy";
import type { PlannedPath, PlanSlot } from "@/lib/planner/engine-io";
import { getPlanPrefs } from "@/lib/planner/prefs";
import { REVIEW_LABELS } from "@/lib/planner/review";
import {
  acceptSuggestion,
  dismissSuggestion,
  pathOverview,
  restoreSuggestions,
  savePlanSettings,
  studentPath,
  type StudentPath,
} from "@/lib/planner/service";
import { deleteStudent, exportStudentData } from "@/lib/privacy";

// "Your path" end to end against a real database (createTestDb) and the real Utah, Tennessee and
// Texas content: what the service gathers (grade, cohort, state, classes, north stars routed to
// families, the college list, choices), what the engine returns, and what Add, "Not for me" and
// the settings store.

const NOW = new Date("2026-09-25T15:00:00Z");
let db: Db;

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  // Calls that read today (pathOverview, the data download) see the same day as NOW.
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  db = await createTestDb();
  // Reference data: careers with their majors (CIP-SOC crosswalk) and the colleges on lists.
  await db.insert(schema.occupations).values([
    { code: "15-1252.00", title: "Software Developers", description: "Writes software.", jobZone: 4 },
    { code: "29-1141.00", title: "Registered Nurses", description: "Cares for patients.", jobZone: 3 },
    { code: "17-2141.00", title: "Mechanical Engineers", description: "Designs machines.", jobZone: 4 },
  ]);
  await db.insert(schema.majors).values([
    ...SOFTWARE_DEVELOPER_MAJORS.map(([cipCode, title]) => ({ cipCode, title })),
    { cipCode: "51.3801", title: "Registered Nursing/Registered Nurse" },
    { cipCode: "14.1901", title: "Mechanical Engineering" },
  ]);
  await db.insert(schema.cipSocLinks).values([
    ...SOFTWARE_DEVELOPER_MAJORS.map(([cipCode]) => ({ cipCode, socCode: "15-1252" })),
    { cipCode: "51.3801", socCode: "29-1141" },
    { cipCode: "14.1901", socCode: "17-2141" },
  ]);
  await db.insert(schema.colleges).values([
    { unitId: 228778, name: "The University of Texas at Austin", state: "TX", control: 1, admissionRate: 0.29 },
    { unitId: 228723, name: "Texas A&M University-College Station", state: "TX", control: 1, admissionRate: 0.63 },
    { unitId: 221759, name: "The University of Tennessee-Knoxville", state: "TN", control: 1, admissionRate: 0.46 },
    ...[1, 2, 3, 4, 5].map((n) => ({ unitId: 990000 + n, name: `Test College ${n}`, state: "ZZ", control: 1 })),
  ]);
  // Which colleges offer each Software Developers major's family: the real counts (1599 colleges
  // offer 11.01, 1032 offer 11.07, …) scaled down by about 200.
  const offering: [string, number][] = [["11.01", 8], ["11.07", 5], ["11.04", 2], ["11.08", 4], ["11.02", 3], ["11.09", 3], ["14.09", 2], ["15.12", 1]];
  const unitIds = [228778, 228723, 221759, 990001, 990002, 990003, 990004, 990005];
  await db.insert(schema.collegePrograms).values(
    offering.flatMap(([cip4, n]) => unitIds.slice(0, n).map((unitId) => ({ unitId, cip4, title: cip4, credentialLevel: 3 }))),
  );
});

// Software Developers' 15 related majors in the NCES CIP-SOC crosswalk, as getCareer lists them:
// 8 narrow IT majors (11.02xx, 11.0804, 11.0902, 15.1204) and 5 computer science ones.
const SOFTWARE_DEVELOPER_MAJORS: [string, string][] = [
  ["11.0102", "Artificial Intelligence"],
  ["11.0103", "Information Technology"],
  ["11.0104", "Informatics"],
  ["11.0701", "Computer Science"],
  ["11.0804", "Modeling, Virtual Environments and Simulation"],
  ["11.0201", "Computer Programming/Programmer, General"],
  ["11.0202", "Computer Programming, Specific Applications"],
  ["11.0203", "Computer Programming, Vendor/Product Certification"],
  ["11.0204", "Computer Game Programming"],
  ["11.0205", "Computer Programming, Specific Platforms"],
  ["11.0902", "Cloud Computing"],
  ["11.0401", "Information Science/Studies"],
  ["14.0901", "Computer Engineering, General"],
  ["14.0903", "Computer Software Engineering"],
  ["15.1204", "Computer Software Technology/Technician"],
];

type Row = { name: string; subject: CourseSubject; grade: number; type?: string; level?: CourseLevel; status?: CourseStatus; letter?: string; credits?: number };

async function student({ grade, state, rows = [], stars = [], colleges = [] }: { grade: number; state: string | null; rows?: Row[]; stars?: string[]; colleges?: number[] }) {
  const [household] = await db.insert(schema.households).values({}).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ role: "student", householdId: household.id, displayName: "Sam", passwordHash: "x", birthDate: "2011-01-15", grade, gradeSchoolYear: 2026, homeState: state })
    .returning({ id: schema.users.id });
  for (const r of rows) {
    const status = r.status ?? (r.grade < grade ? "completed" : r.grade === grade ? "in_progress" : "planned");
    await db.insert(schema.studentCourses).values({
      userId: user.id,
      name: r.name,
      subject: r.subject,
      level: r.level ?? "regular",
      gradeLevel: r.grade,
      credits: r.credits ?? 1,
      status,
      finalGrade: status === "completed" ? (r.letter ?? "A") : null,
      highSchoolCredit: r.grade >= 9 || r.type === "math.alg1",
      courseTypeId: r.type ?? null,
      courseTypeSource: r.type ? "student" : null,
    });
  }
  for (const code of stars) expect((await addNorthStar(db, user.id, code)).ok).toBe(true);
  for (const unitId of colleges) {
    const [c] = await db.select().from(schema.colleges).where(eq(schema.colleges.unitId, unitId));
    await db.insert(schema.collegeList).values({ userId: user.id, unitId, name: c.name });
  }
  return user.id;
}

function planned(path: StudentPath): Extract<StudentPath, { kind: "planned" }> {
  if (path.kind !== "planned") throw new Error(`expected a planned path, got ${path.kind}`);
  return path;
}

type Suggested = Extract<PlanSlot, { kind: "suggested" }> & { grade: number };

function suggestions(result: PlannedPath, plan: "A" | "B" = "A"): Suggested[] {
  return (result.plans.find((p) => p.id === plan)?.years ?? []).flatMap((y) =>
    y.slots.filter((s): s is Extract<PlanSlot, { kind: "suggested" }> => s.kind === "suggested").map((s) => ({ ...s, grade: y.grade })),
  );
}

const TX_NINTH: Row[] = [
  { name: "Algebra I", subject: "math", grade: 8, type: "math.alg1", letter: "A-" },
  { name: "English I Honors", subject: "english", grade: 9, type: "ela.9", level: "honors" },
  { name: "Geometry Honors", subject: "math", grade: 9, type: "math.geom", level: "honors" },
  { name: "Biology", subject: "science", grade: 9, type: "sci.bio" },
  { name: "World Geography", subject: "social_studies", grade: 9, type: "ss.world_geo" },
  { name: "Spanish I", subject: "world_language", grade: 9, type: "lang.es.1" },
  { name: "Computer Science Principles", subject: "computer_science", grade: 9, type: "cs.principles" },
];

describe("a Texas 9th grader's path", () => {
  it("is built from their classes, their north star and their college list", async () => {
    const id = await student({ grade: 9, state: "TX", rows: TX_NINTH, stars: ["15-1252.00"], colleges: [228778, 228723] });
    const path = planned(await studentPath(db, id, NOW));
    const r = path.result;
    expect(r.state).toBe("TX");
    expect(r.stage).toBe("high_school");
    expect(r.mode).toBe("generic");
    expect(r.notices.draft).toBe(DRAFT_BANNER);
    expect(r.notices.standing).toBe(STANDING_PLAN_NOTE);
    expect(r.notices.review.every((n) => n.label === REVIEW_LABELS.draft)).toBe(true);
    // Class of 2030 under the 2026-entry Texas rules.
    expect(path.ctx.cohort).toMatchObject({ grade9EntryYear: 2026, classYear: 2030 });
    expect(r.builtFrom.families[0]).toMatchObject({ familyId: "computer_data_science", because: "Software Developers" });
    // Both colleges (added in the same instant, so in either order).
    expect(r.builtFrom.colleges.map((c) => c.name).sort()).toEqual(["Texas A&M University-College Station", "The University of Texas at Austin"]);
    // A degree path (inferred from the goal and the colleges), so the DLA is the default target.
    expect(path.ctx).toMatchObject({ path: "degree", pathInferred: true });
    const ids = r.audit.map((a) => a.ruleSetId);
    for (const rs of ["tx.fhsp.grad", "tx.dla", "utaustin.prereq", "utaustin.calc-ready", "tamu.recommended"]) expect(ids).toContain(rs);
    // Their own classes are locked into 9th grade.
    const ninth = r.plans[0]!.years.find((y) => y.grade === 9)!;
    expect(ninth.slots.filter((s) => s.kind === "yours")).toHaveLength(6);
    // Something to add in 10th, with reasons that quote a source.
    const tenth = suggestions(r).filter((s) => s.grade === 10);
    expect(tenth.length).toBeGreaterThan(0);
    expect(tenth.every((s) => s.reasons.length > 0)).toBe(true);
    expect(Object.keys(r.citations).length).toBeGreaterThan(0);
    expect(r.askCounselor.length).toBeGreaterThanOrEqual(3);
    expect(r.askCounselor.length).toBeLessThanOrEqual(8);
  });

  it("never suggests more college-level classes a year than the student's limit (3 by default)", async () => {
    const id = await student({ grade: 9, state: "TX", rows: TX_NINTH, stars: ["15-1252.00"], colleges: [228778] });
    for (const max of [3, 1, 0]) {
      if (max !== 3) await savePlanSettings(db, id, { limits: { maxCollegeLevelPerYear: max } }, NOW);
      const r = planned(await studentPath(db, id, NOW)).result;
      for (const plan of r.plans) {
        for (const y of plan.years) {
          const suggestedCollege = y.slots.filter((s) => s.kind === "suggested" && s.collegeLevel).length;
          expect(suggestedCollege, `${max} in ${y.grade}`).toBeLessThanOrEqual(max);
          expect(y.load.cap).toBe(max);
        }
      }
    }
  });

  it("Add makes a suggestion the student's own class, and the path plans around it", async () => {
    const id = await student({ grade: 9, state: "TX", rows: TX_NINTH, stars: ["15-1252.00"] });
    const before = planned(await studentPath(db, id, NOW)).result;
    const pick = suggestions(before).find((s) => s.grade === 10)!;
    const res = await acceptSuggestion(db, id, pick.key, NOW);
    expect(res).toMatchObject({ ok: true, grade: 10 });
    const [row] = await db.select().from(schema.studentCourses).where(eq(schema.studentCourses.name, pick.title.slice(0, 80)));
    expect(row).toMatchObject({ gradeLevel: 10, status: "planned", courseTypeId: pick.typeId, courseTypeSource: "student" });

    const after = planned(await studentPath(db, id, NOW)).result;
    const tenth = after.plans[0]!.years.find((y) => y.grade === 10)!;
    expect(tenth.slots).toContainEqual(expect.objectContaining({ kind: "yours", courseId: row.id }));
    expect(suggestions(after).map((s) => s.key)).not.toContain(pick.key);
  });

  it("an alternative (“Other choices”) can be added instead", async () => {
    const id = await student({ grade: 9, state: "TX", rows: TX_NINTH });
    const r = planned(await studentPath(db, id, NOW)).result;
    const withAlt = suggestions(r).find((s) => s.alternatives.length > 0)!;
    const alt = withAlt.alternatives[0];
    expect(await acceptSuggestion(db, id, alt.key, NOW)).toMatchObject({ ok: true, grade: withAlt.grade });
    const rows = await db.select().from(schema.studentCourses).where(eq(schema.studentCourses.courseTypeId, alt.typeId));
    expect(rows.some((row) => row.gradeLevel === withAlt.grade && row.level === (alt.level === "regular" ? "regular" : alt.level))).toBe(true);
  });

  it("“Not for me” sets a suggestion aside until the student brings it back", async () => {
    const id = await student({ grade: 9, state: "TX", rows: TX_NINTH });
    const r = planned(await studentPath(db, id, NOW)).result;
    const pick = suggestions(r).find((s) => s.grade === 11)!;
    expect(await dismissSuggestion(db, id, pick.key, NOW)).toEqual({ ok: true });
    expect((await getPlanPrefs(db, id)).dismissed).toEqual([pick.key]);
    expect(suggestions(planned(await studentPath(db, id, NOW)).result).map((s) => s.key)).not.toContain(pick.key);
    await restoreSuggestions(db, id, NOW);
    expect((await getPlanPrefs(db, id)).dismissed).toEqual([]);
    expect(await db.select().from(schema.studentCourses).where(eq(schema.studentCourses.gradeLevel, 11))).toHaveLength(0);
  });

  it("refuses keys that aren't in today's plan, so the browser never decides what's added", async () => {
    const id = await student({ grade: 9, state: "TX", rows: TX_NINTH });
    const count = async () => (await db.select().from(schema.studentCourses)).length;
    const n = await count();
    expect(await acceptSuggestion(db, id, "tx.fhsp.grad/ela.2/ela.12/ap", NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await acceptSuggestion(db, id, "<script>alert(1)</script>", NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await dismissSuggestion(db, id, "made/up/key/regular", NOW)).toEqual({ ok: false });
    expect(await count()).toBe(n);
    expect((await getPlanPrefs(db, id)).dismissed).toEqual([]);
  });

  it("offers a second plan only when a choice separates them, and naming the endorsement settles it", async () => {
    const id = await student({ grade: 9, state: "TX", rows: TX_NINTH, stars: ["15-1252.00"] });
    const before = planned(await studentPath(db, id, NOW)).result;
    expect(before.decisions.map((d) => d.key)).toContain("txEndorsements");
    if (before.plans.length === 2) expect(before.planChoice?.kind).toBe("endorsement");
    await savePlanSettings(db, id, { choices: { txEndorsements: ["stem"] } }, NOW);
    const after = planned(await studentPath(db, id, NOW)).result;
    expect(after.decisions.map((d) => d.key)).not.toContain("txEndorsements");
    expect(after.plans).toHaveLength(1);
    expect(after.audit.map((a) => a.ruleSetId)).toContain("tx.endorse.stem");
  });

  it("plans the DLA on a degree path unless the student turns it off; not on a training path", async () => {
    const id = await student({ grade: 10, state: "TX", rows: [{ name: "English II", subject: "english", grade: 10, type: "ela.10" }] });
    // No goals or colleges yet: "not sure yet", so nothing is assumed.
    const unsure = planned(await studentPath(db, id, NOW));
    expect(unsure.ctx).toMatchObject({ path: "undecided", pathInferred: true });
    expect(unsure.result.audit.map((a) => a.ruleSetId)).not.toContain("tx.dla");
    await savePlanSettings(db, id, { path: "degree" }, NOW);
    expect(planned(await studentPath(db, id, NOW)).result.audit.map((a) => a.ruleSetId)).toContain("tx.dla");
    await savePlanSettings(db, id, { choices: { txAimDla: false } }, NOW);
    expect(planned(await studentPath(db, id, NOW)).result.audit.map((a) => a.ruleSetId)).not.toContain("tx.dla");
    await savePlanSettings(db, id, { path: "training", choices: { txAimDla: null } }, NOW);
    expect(planned(await studentPath(db, id, NOW)).result.audit.map((a) => a.ruleSetId)).not.toContain("tx.dla");
  });
});

describe("classes recorded without choosing their kind", () => {
  it("a parent sees them as waiting on a confirmed kind, not as room to add", async () => {
    const guessed: Row[] = [
      { name: "English I", subject: "english", grade: 9 },
      { name: "Algebra I", subject: "math", grade: 9 },
      { name: "Biology", subject: "science", grade: 9 },
      { name: "World Geography", subject: "social_studies", grade: 9 },
      { name: "Spanish I", subject: "world_language", grade: 9 },
      { name: "English II", subject: "english", grade: 10 },
      { name: "Geometry", subject: "math", grade: 10 },
      { name: "Spanish II", subject: "world_language", grade: 10 },
    ];
    const id = await student({ grade: 11, state: "TX", rows: guessed });
    const path = planned(await studentPath(db, id, NOW));
    const guessedLines = path.result.audit
      .filter((a) => a.kind === "state_graduation")
      .flatMap((a) => a.requirements)
      .filter((r) => r.status === "waiting_confirm" && r.modifiers.includes("guessed_type"));
    expect(guessedLines.length).toBeGreaterThan(0);
    const overview = await pathOverview(db, id, NOW);
    if (overview.kind !== "planned") throw new Error(overview.kind);
    expect(overview.summary.counts.confirmType).toBe(guessedLines.length);
    const roomLines = path.result.audit.filter((a) => a.kind === "state_graduation").flatMap((a) => a.requirements).filter((r) => r.status === "room_to_add");
    expect(overview.summary.counts.roomToAdd).toBe(roomLines.length);
    // No language gap for the guessed Spanish I and II.
    expect(path.result.gaps.filter((g) => /language/i.test(g.text))).toEqual([]);
  });
});

// Classes typed with a name only (no kind picked: every row saved before the "What kind of class
// is this?" question, and any row where it's skipped). The planner guesses the type, and a guess
// never makes a named requirement done; the fill must still plan as if the guess were right and
// never add a second class of a kind the student probably already has (counselor re-review, S1-S3).
describe("classes typed with a name only are planned around, never added again", () => {
  async function guessesAndPath(rows: Row[], opts: { grade: number; state: string; stars: string[]; colleges?: number[] }) {
    const id = await student({ ...opts, rows });
    const path = planned(await studentPath(db, id, NOW));
    const guessed = new Set(path.input.courses.filter((c) => c.assumed).map((c) => c.typeId));
    expect(path.input.courses.every((c) => c.assumed)).toBe(true);
    return { path, guessed };
  }

  function expectNoDuplicates(result: PlannedPath, guessed: Set<string>, labels: RegExp) {
    for (const plan of result.plans) {
      for (const s of suggestions(result, plan.id)) {
        expect(guessed.has(s.typeId), `${plan.id} ${s.grade}: ${s.typeId} repeats a typed class`).toBe(false);
        for (const r of s.reasons) expect(r.text, `${plan.id} ${s.typeId}`).not.toMatch(labels);
      }
    }
  }

  it("S1: a Texas 10th grader's typed Spanish, Chemistry, World Geography and Athletics aren't doubled", async () => {
    const { path, guessed } = await guessesAndPath(
      [
        { name: "Algebra 1", subject: "math", grade: 9, letter: "B+" },
        { name: "English 1", subject: "english", grade: 9 },
        { name: "Biology", subject: "science", grade: 9 },
        { name: "World Geography", subject: "social_studies", grade: 9 },
        { name: "Spanish 1", subject: "world_language", grade: 9 },
        { name: "Athletics", subject: "health_pe", grade: 9 },
        { name: "Geometry", subject: "math", grade: 10 },
        { name: "English 2", subject: "english", grade: 10 },
        { name: "Chemistry", subject: "science", grade: 10 },
        { name: "Spanish 2", subject: "world_language", grade: 10 },
        { name: "AP CSP", subject: "computer_science", grade: 10, level: "ap" },
      ],
      { grade: 10, state: "TX", stars: ["15-1252.00"], colleges: [228778, 228723] },
    );
    expect(path.ctx.cohort).toMatchObject({ classYear: 2029 });
    expect([...guessed]).toEqual(expect.arrayContaining(["lang.es.1", "lang.es.2", "sci.chem", "ss.world_geo", "pe.athletics"]));
    expectNoDuplicates(path.result, guessed, /computer programming credits|IPC, chemistry or physics|World history or world geography|Physical education/);
    // No Computer Science I and II for the language credit, no second chemistry.
    for (const plan of path.result.plans) expect(suggestions(path.result, plan.id).map((s) => s.typeId)).not.toEqual(expect.arrayContaining(["cs.prog1", "cs.prog2"]));
    for (const plan of path.result.plans) expect(suggestions(path.result, plan.id).map((s) => s.typeId)).not.toContain("sci.chem2");
    // The audit shows the language route the guesses meet, waiting on a confirmed type.
    const lote = path.result.audit.find((a) => a.ruleSetId === "tx.fhsp.grad")!.requirements.find((r) => r.reqId.startsWith("lote"))!;
    expect(lote).toMatchObject({ reqId: "lote.same", status: "waiting_confirm" });
    expect(lote.modifiers).toContain("guessed_type");
    // Only the credits the plan leaves for 12th's open periods (round 9): nothing missing or impossible.
    expect(path.result.gaps.filter((g) => g.priority <= 1 && !/in 12th grade \(your open periods\)/.test(g.text))).toEqual([]);
  });

  it("S2: a Utah 11th grader's typed English 10 Honors, Health and Fitness for Life aren't doubled", async () => {
    await db.insert(schema.colleges).values({ unitId: 230764, name: "University of Utah", state: "UT", control: 1, admissionRate: 0.86 });
    const { path, guessed } = await guessesAndPath(
      [
        { name: "English 9", subject: "english", grade: 9 },
        { name: "Secondary Math I", subject: "math", grade: 9 },
        { name: "Earth Science", subject: "science", grade: 9 },
        { name: "World Geography", subject: "social_studies", grade: 9, credits: 0.5 },
        { name: "Health", subject: "health_pe", grade: 9, credits: 0.5 },
        { name: "Fitness for Life", subject: "health_pe", grade: 9, credits: 0.5 },
        { name: "Participation Skills", subject: "health_pe", grade: 9, credits: 0.5 },
        { name: "English 10 Honors", subject: "english", grade: 10, level: "honors" },
        { name: "Secondary Math II", subject: "math", grade: 10 },
        { name: "Biology", subject: "science", grade: 10 },
        { name: "World History", subject: "social_studies", grade: 10, credits: 0.5 },
        { name: "Spanish 1", subject: "world_language", grade: 10 },
        { name: "English 11", subject: "english", grade: 11 },
        { name: "Secondary Math III", subject: "math", grade: 11 },
        { name: "Chemistry", subject: "science", grade: 11 },
        { name: "U.S. History", subject: "social_studies", grade: 11 },
        { name: "Spanish 2", subject: "world_language", grade: 11 },
      ],
      { grade: 11, state: "UT", stars: ["29-1141.00"], colleges: [230764] },
    );
    expect([...guessed]).toEqual(expect.arrayContaining(["ela.10", "health.health", "pe.fitness", "pe.skills", "ss.world_geo", "math.ut_sec3"]));
    expectNoDuplicates(path.result, guessed, /Grade 10 language arts|Health\.|Fitness for Life|World geography|Participation Skills/);
    // Nothing for Grade 10 language arts in the year in progress (no AP Seminar).
    expect(suggestions(path.result).map((s) => s.typeId)).not.toContain("ela.seminar");
    const gaps = path.result.gaps.map((g) => `${g.text} ${g.options.map((o) => o.text).join(" ")}`).join("\n");
    expect(gaps).not.toMatch(/World geography|Participation Skills|Secondary Mathematics I online/);
  });

  it("S3: a Tennessee 9th grader's typed Lifetime Wellness isn't doubled", async () => {
    const { path, guessed } = await guessesAndPath(
      [
        { name: "English 9", subject: "english", grade: 9 },
        { name: "Algebra I", subject: "math", grade: 9 },
        { name: "Biology", subject: "science", grade: 9 },
        { name: "World History", subject: "social_studies", grade: 9 },
        { name: "Lifetime Wellness", subject: "health_pe", grade: 9 },
        { name: "Spanish I", subject: "world_language", grade: 9 },
      ],
      { grade: 9, state: "TN", stars: ["17-2141.00"] },
    );
    expect([...guessed]).toEqual(expect.arrayContaining(["health.wellness", "ss.world_hist", "sci.bio"]));
    expectNoDuplicates(path.result, guessed, /Lifetime Wellness|World History and Geography|Biology\./);
  });
});

describe("a Utah 7th grader", () => {
  it("sees the middle-school view: math placement, Utah's notes and a 9th-grade sketch, with nothing to add", async () => {
    const id = await student({
      grade: 7,
      state: "UT",
      rows: [
        { name: "Math 7", subject: "math", grade: 7, type: "math.ms" },
        { name: "English 7", subject: "english", grade: 7, type: "ela.ms" },
      ],
      stars: ["29-1141.00"],
    });
    const path = planned(await studentPath(db, id, NOW));
    expect(path.result.stage).toBe("middle_school");
    expect(path.result.plans).toEqual([]);
    // Utah's own name for the first high school math class.
    expect(path.result.middleSchool?.mathPlacement.text).toMatch(/Secondary Mathematics I in 8th/);
    expect(path.result.middleSchool?.stateNotes.some((n) => /Utah/.test(n.text))).toBe(true);
    expect(path.result.builtFrom.families[0]).toMatchObject({ familyId: "nursing" });
    expect(path.ctx.cohort).toMatchObject({ classYear: 2032 });
  });
});

describe("a Tennessee 11th grader", () => {
  const rows: Row[] = [
    { name: "English I", subject: "english", grade: 9, type: "ela.9", letter: "B+" },
    { name: "Algebra I", subject: "math", grade: 9, type: "math.alg1", letter: "B" },
    { name: "Biology", subject: "science", grade: 9, type: "sci.bio" },
    { name: "World History and Geography", subject: "social_studies", grade: 9, type: "ss.world_hist" },
    { name: "Spanish I", subject: "world_language", grade: 9, type: "lang.es.1" },
    { name: "Lifetime Wellness", subject: "health_pe", grade: 9, type: "health.wellness" },
    { name: "Art I", subject: "arts", grade: 9, type: "arts.visual" },
    { name: "English II", subject: "english", grade: 10, type: "ela.10" },
    { name: "Geometry", subject: "math", grade: 10, type: "math.geom" },
    { name: "Chemistry", subject: "science", grade: 10, type: "sci.chem" },
    { name: "U.S. History and Geography", subject: "social_studies", grade: 10, type: "ss.us_hist" },
    { name: "Spanish II", subject: "world_language", grade: 10, type: "lang.es.2" },
    { name: "Computer Science Principles", subject: "computer_science", grade: 10, type: "cs.principles" },
    { name: "Physical Education", subject: "health_pe", grade: 10, type: "pe.fitness", credits: 0.5 },
    { name: "English III", subject: "english", grade: 11, type: "ela.11" },
    { name: "Algebra II", subject: "math", grade: 11, type: "math.alg2" },
    { name: "Physics", subject: "science", grade: 11, type: "sci.phys" },
    { name: "Economics", subject: "social_studies", grade: 11, type: "ss.econ", credits: 0.5 },
    { name: "U.S. Government and Civics", subject: "social_studies", grade: 11, type: "ss.us_gov", credits: 0.5 },
    { name: "Personal Finance", subject: "social_studies", grade: 11, type: "ss.pfl", credits: 0.5 },
  ];

  it("has the elective focus as a choice to make, and a full year of U.S. history counts", async () => {
    const id = await student({ grade: 11, state: "TN", rows, stars: ["17-2141.00"], colleges: [221759] });
    const r = planned(await studentPath(db, id, NOW)).result;
    expect(r.decisions.map((d) => d.key)).toContain("tnElectiveFocus");
    const grad = r.audit.find((a) => a.ruleSetId === "tn.grad")!;
    // A full-credit class covers its half-credit requirement and the rest of social studies.
    for (const req of ["ss.us_hist", "ss.world_hist", "ss.econ", "ss.gov", "ss.rest"]) {
      expect(grad.requirements.find((q) => q.reqId === req)?.status, req).toMatch(/done|planned/);
    }
    expect(r.gaps.filter((g) => /history/i.test(g.text))).toEqual([]);
    expect(r.audit.map((a) => a.ruleSetId)).toContain("utk.core16");
    expect(r.plans[0]!.years.map((y) => y.grade)).toEqual([11, 12]);

    await savePlanSettings(db, id, { choices: { tnElectiveFocus: "math_science" } }, NOW);
    const after = planned(await studentPath(db, id, NOW)).result;
    expect(after.decisions.map((d) => d.key)).not.toContain("tnElectiveFocus");
    expect(after.audit.map((a) => a.ruleSetId)).toContain("tn.focus.math-science");
  });

  it("gives the parent dashboard a short summary", async () => {
    const id = await student({ grade: 11, state: "TN", rows });
    const overview = await pathOverview(db, id, NOW);
    expect(overview.kind).toBe("planned");
    if (overview.kind !== "planned") return;
    expect(overview.summary).toMatchObject({ state: "TN", classYear: 2028 });
    expect(overview.summary.counts.done).toBeGreaterThan(10);
    expect(overview.summary.counts.confirmType).toBe(0);
  });
});

describe("students outside Utah, Tennessee and Texas", () => {
  it("keep today's checklist and see that planning for their state is coming", async () => {
    const id = await student({ grade: 10, state: "OH" });
    const path = await studentPath(db, id, NOW);
    expect(path.kind).toBe("no_state");
    if (path.kind !== "no_state") return;
    expect(path.result.comingLater).toBe(comingLaterNote("Ohio"));
    expect(await pathOverview(db, id, NOW)).toEqual({ kind: "coming_later", homeState: "OH" });
  });

  it("with no state set, there's nothing to say about a state", async () => {
    const id = await student({ grade: 10, state: null });
    const path = await studentPath(db, id, NOW);
    expect(path.kind === "no_state" && path.result.comingLater).toBeNull();
  });

  it("graduates aren't planned", async () => {
    const id = await student({ grade: 12, state: "TX" });
    await db.update(schema.users).set({ gradeSchoolYear: 2025 }).where(eq(schema.users.id, id));
    expect((await studentPath(db, id, NOW)).kind).toBe("graduated");
  });
});

describe("planning choices (student_plan_prefs)", () => {
  it("drops stored values that don't check out, keeping the rest", async () => {
    const id = await student({ grade: 10, state: "TX" });
    await db.insert(schema.studentPlanPrefs).values({
      userId: id,
      targets: { path: "moon", familyId: "nursing" },
      choices: { txEndorsements: ["bogus"], worldLanguage: "fr", tnElectiveFocus: 5 },
      limits: { maxCollegeLevelPerYear: 99, accelerateMath: true },
      cohort: { grade9Entry: { year: "soon" } },
      dismissed: ["tx.fhsp.grad/arts/arts.visual/regular", "bad key <b>"],
    });
    const prefs = await getPlanPrefs(db, id);
    expect(prefs).toMatchObject({
      path: null,
      familyId: "nursing",
      choices: { worldLanguage: "fr" },
      limits: { maxCollegeLevelPerYear: 3, accelerateMath: true },
      cohort: {},
      dismissed: ["tx.fhsp.grad/arts/arts.visual/regular"],
    });
    expect(prefs.choices).not.toHaveProperty("txEndorsements");
    // A chosen family is planned around first, before the north stars.
    const path = planned(await studentPath(db, id, NOW));
    expect(path.result.builtFrom.families[0]).toMatchObject({ familyId: "nursing", source: "chosen" });
  });

  it("store only what the student chose: the first save doesn't freeze the defaults", async () => {
    const id = await student({ grade: 10, state: "TX" });
    const r = planned(await studentPath(db, id, NOW)).result;
    await dismissSuggestion(db, id, suggestions(r)[0].key, NOW);
    const [row] = await db.select().from(schema.studentPlanPrefs).where(eq(schema.studentPlanPrefs.userId, id));
    expect(row.limits).toEqual({});
    expect((await getPlanPrefs(db, id)).limits).toMatchObject({ maxCollegeLevelPerYear: 3, allowSummer: true });
    await savePlanSettings(db, id, { limits: { maxCollegeLevelPerYear: 2 } }, NOW);
    const [after] = await db.select().from(schema.studentPlanPrefs).where(eq(schema.studentPlanPrefs.userId, id));
    expect(after.limits).toEqual({ maxCollegeLevelPerYear: 2 });
    // Back to the default: nothing stored again.
    await savePlanSettings(db, id, { limits: { maxCollegeLevelPerYear: null } }, NOW);
    const [cleared] = await db.select().from(schema.studentPlanPrefs).where(eq(schema.studentPlanPrefs.userId, id));
    expect(cleared.limits).toEqual({});
  });

  it("a corrected grade-9 entry year changes which Texas rules apply", async () => {
    // A 10th grader in 2026-27 started 9th grade in fall 2025: the Texas rules before the 2026 update.
    const id = await student({ grade: 10, state: "TX", rows: [{ name: "English II", subject: "english", grade: 10, type: "ela.10" }] });
    const before = planned(await studentPath(db, id, NOW));
    expect(before.ctx.cohort).toMatchObject({ grade9EntryYear: 2025, classYear: 2029 });
    expect(before.result.audit.find((a) => a.ruleSetId === "tx.fhsp.grad")?.variantId).toBe("tx.fhsp.grad.pre2026");
    // They repeated 9th grade, so they started 9th grade in fall 2026 as far as the rules go.
    await savePlanSettings(db, id, { cohort: { grade9Entry: { year: 2026, reason: "repeated" } } }, NOW);
    const after = planned(await studentPath(db, id, NOW));
    expect(after.ctx.cohort).toMatchObject({ grade9EntryYear: 2026, overrides: { grade9Entry: "repeated" } });
    expect(after.ctx.cohortDefault).toMatchObject({ grade9EntryYear: 2025 });
    expect(after.result.audit.find((a) => a.ruleSetId === "tx.fhsp.grad")?.variantId).toBe("tx.fhsp.grad.2026");
    await savePlanSettings(db, id, { cohort: { grade9Entry: null } }, NOW);
    expect(planned(await studentPath(db, id, NOW)).ctx.cohort).toMatchObject({ grade9EntryYear: 2025, overrides: {} });
  });

  it("are in the student's (and a parent's) data download, and deleted with the student", async () => {
    const id = await student({ grade: 9, state: "TX", rows: TX_NINTH });
    const [parent] = await db.insert(schema.users).values({ role: "parent", displayName: "Pat", passwordHash: "x" }).returning({ id: schema.users.id });
    await db.insert(schema.parentStudentLinks).values({ parentUserId: parent.id, studentUserId: id });
    const r = planned(await studentPath(db, id, NOW)).result;
    await dismissSuggestion(db, id, suggestions(r)[0].key, NOW);
    await savePlanSettings(db, id, { path: "degree", familyId: "engineering", choices: { txEndorsements: ["stem"], worldLanguage: "es" }, limits: { maxCollegeLevelPerYear: 2 } }, NOW);

    for (const requester of [id, parent.id]) {
      const data = await exportStudentData(db, requester, id);
      expect(data?.planChoices).toMatchObject({
        targets: { path: "degree", familyId: "engineering" },
        choices: { txEndorsements: ["stem"], worldLanguage: "es" },
        limits: { maxCollegeLevelPerYear: 2 },
        dismissed: [suggestions(r)[0].key],
      });
      expect(data?.courses.every((c) => "courseTypeId" in c && "courseTypeSource" in c)).toBe(true);
    }

    expect(await deleteStudent(db, id, id)).toBe(true);
    expect(await db.select().from(schema.studentPlanPrefs)).toHaveLength(0);
  });
});
