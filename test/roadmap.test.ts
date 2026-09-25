import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { addMilestoneStep, getMilestoneProgress, markMilestone, roadmapSummary } from "@/lib/roadmap";
import type { Milestone } from "@/lib/roadmap/types";
import {
  MAX_STEPS_PER_WEEK,
  STEP_TEXT_MAX,
  addStep,
  completeStep,
  editStep,
  listWeek,
  removeStep,
  reopenStep,
  stepStats,
  weeklyStepsView,
} from "@/lib/steps";

// Wednesday, September 23 2026 (week of Monday the 21st).
const now = new Date("2026-09-23T12:00:00Z");
const nextWeek = new Date("2026-09-30T12:00:00Z");
const inThreeWeeks = new Date("2026-10-14T12:00:00Z");

function ms(id: string, grade: number, months: number[], title = `Title ${id}`): Milestone {
  return { id, grade, months, title, detail: "d", why: "w", category: "testing", pathway: "all", sources: [] };
}

const LIBRARY: Milestone[] = [
  ms("g10-aug", 10, [8], "Say hi to your counselor"),
  ms("g10-sep", 10, [9], "Sign up for the PSAT"),
  ms("g10-sep-2", 10, [9], "Join a club"),
  ms("g10-oct", 10, [10], "Take the PSAT"),
  ms("g10-mar", 10, [3], "Look for summer programs"),
  ms("g11-sep", 11, [9], "Plan junior year"),
];

let db: Db;
let ana: string;
let ben: string;

async function student(displayName: string, email: string, username?: string) {
  const res = await registerStudent(
    db,
    { displayName, email, password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
    now,
  );
  if (!res.ok) throw new Error(res.error);
  if (username) {
    await db.update(schema.users).set({ username }).where(eq(schema.users.id, res.value.userId));
  }
  return res.value.userId;
}

beforeEach(async () => {
  db = await createTestDb();
  ana = await student("Ana", "ana@example.com", "anarocks");
  ben = await student("Ben", "ben@example.com");
});

describe("milestone progress", () => {
  it("marks, changes and resets a milestone", async () => {
    expect(await markMilestone(db, ana, "g10-sep", "done", { library: LIBRARY })).toEqual({ ok: true });
    expect(await getMilestoneProgress(db, ana)).toEqual(new Map([["g10-sep", "done"]]));

    expect(await markMilestone(db, ana, "g10-sep", "skipped", { library: LIBRARY })).toEqual({ ok: true });
    expect((await getMilestoneProgress(db, ana)).get("g10-sep")).toBe("skipped");
    expect(await db.select().from(schema.studentMilestones)).toHaveLength(1);

    expect(await markMilestone(db, ana, "g10-sep", null, { library: LIBRARY })).toEqual({ ok: true });
    expect((await getMilestoneProgress(db, ana)).size).toBe(0);
    // Resetting something that was never marked is fine.
    expect(await markMilestone(db, ana, "g10-oct", null, { library: LIBRARY })).toEqual({ ok: true });
  });

  it("only accepts milestones from the library and known statuses", async () => {
    expect(await markMilestone(db, ana, "made-up", "done", { library: LIBRARY })).toEqual({ ok: false, error: "not_found" });
    expect(await markMilestone(db, ana, "g10-sep", "finished" as never, { library: LIBRARY })).toEqual({
      ok: false,
      error: "invalid_status",
    });
    expect(await db.select().from(schema.studentMilestones)).toHaveLength(0);
  });

  it("keeps each student's progress separate", async () => {
    await markMilestone(db, ana, "g10-sep", "done", { library: LIBRARY });
    await markMilestone(db, ben, "g10-sep", "skipped", { library: LIBRARY });
    await markMilestone(db, ben, "g10-sep", null, { library: LIBRARY });
    expect((await getMilestoneProgress(db, ana)).get("g10-sep")).toBe("done");
    expect((await getMilestoneProgress(db, ben)).size).toBe(0);
  });
});

describe("weekly steps", () => {
  it("adds trimmed steps, linked to a milestone or not", async () => {
    const custom = await addStep(db, ana, { text: "  Email my counselor  " }, { now, library: LIBRARY });
    expect(custom).toMatchObject({ ok: true, step: { text: "Email my counselor", weekStart: "2026-09-21", status: "open", milestoneId: null } });
    const linked = await addStep(db, ana, { text: "Sign up for the PSAT", milestoneId: "g10-sep" }, { now, library: LIBRARY });
    expect(linked).toMatchObject({ ok: true, step: { milestoneId: "g10-sep" } });
    expect((await listWeek(db, ana, "2026-09-21")).map((s) => s.text).sort()).toEqual(["Email my counselor", "Sign up for the PSAT"]);
  });

  it("lists a week's steps oldest first", async () => {
    const at = (iso: string) => new Date(iso);
    await db.insert(schema.weeklySteps).values([
      { userId: ana, weekStart: "2026-09-21", text: "Second", createdAt: at("2026-09-22T10:00:00Z") },
      { userId: ana, weekStart: "2026-09-21", text: "First", createdAt: at("2026-09-21T10:00:00Z") },
      { userId: ana, weekStart: "2026-09-14", text: "Last week", createdAt: at("2026-09-15T10:00:00Z") },
      { userId: ben, weekStart: "2026-09-21", text: "Ben's", createdAt: at("2026-09-21T09:00:00Z") },
    ]);
    expect((await listWeek(db, ana, "2026-09-21")).map((s) => s.text)).toEqual(["First", "Second"]);
  });

  it("rejects empty, too long, or non-text steps", async () => {
    expect(await addStep(db, ana, { text: "   " }, { now })).toMatchObject({ ok: false, error: "invalid_text" });
    expect(await addStep(db, ana, { text: "x".repeat(141) }, { now })).toMatchObject({ ok: false, error: "invalid_text" });
    expect(await addStep(db, ana, { text: null }, { now })).toMatchObject({ ok: false, error: "invalid_text" });
    expect(await addStep(db, ana, { text: "x".repeat(140) }, { now })).toMatchObject({ ok: true });
  });

  it("requires linked milestones to exist and be added once a week", async () => {
    expect(await addStep(db, ana, { text: "Hi", milestoneId: "nope" }, { now, library: LIBRARY })).toEqual({
      ok: false,
      error: "milestone_not_found",
    });
    await addStep(db, ana, { text: "PSAT", milestoneId: "g10-sep" }, { now, library: LIBRARY });
    expect(await addStep(db, ana, { text: "PSAT again", milestoneId: "g10-sep" }, { now, library: LIBRARY })).toEqual({
      ok: false,
      error: "already_added",
    });
    // Another student, or next week, is fine.
    expect(await addStep(db, ben, { text: "PSAT", milestoneId: "g10-sep" }, { now, library: LIBRARY })).toMatchObject({ ok: true });
    expect(await addStep(db, ana, { text: "PSAT", milestoneId: "g10-sep" }, { now: nextWeek, library: LIBRARY })).toMatchObject({
      ok: true,
    });
  });

  it("adds a milestone to this week using its title", async () => {
    const long = ms("g10-long", 10, [9], `${"Word ".repeat(40)}end`);
    const library = [...LIBRARY, long];
    expect(await addMilestoneStep(db, ana, "g10-sep", { now, library })).toMatchObject({
      ok: true,
      step: { text: "Sign up for the PSAT", milestoneId: "g10-sep" },
    });
    expect(await addMilestoneStep(db, ana, "g10-sep", { now, library })).toEqual({ ok: false, error: "already_added" });
    expect(await addMilestoneStep(db, ana, "nope", { now, library })).toEqual({ ok: false, error: "milestone_not_found" });

    const res = await addMilestoneStep(db, ana, "g10-long", { now, library });
    if (!res.ok) throw new Error(res.error);
    expect(res.step.text).toHaveLength(140);
    expect(res.step.text.endsWith("…")).toBe(true);
  });

  it("allows at most three steps a week, done or not", async () => {
    for (const text of ["One", "Two", "Three"]) {
      expect(await addStep(db, ana, { text }, { now })).toMatchObject({ ok: true });
    }
    const [first] = await listWeek(db, ana, "2026-09-21");
    await completeStep(db, ana, first.id, now);
    expect(await addStep(db, ana, { text: "Four" }, { now })).toEqual({ ok: false, error: "week_full" });
    expect(await addStep(db, ben, { text: "Ben's first" }, { now })).toMatchObject({ ok: true });
    expect(await addStep(db, ana, { text: "Next week" }, { now: nextWeek })).toMatchObject({ ok: true });

    // Removing an unfinished step makes room again.
    const open = (await listWeek(db, ana, "2026-09-21")).find((s) => s.status === "open");
    expect(await removeStep(db, ana, open!.id)).toBe(true);
    expect(await addStep(db, ana, { text: "Room again" }, { now })).toMatchObject({ ok: true });
  });

  it("removes finished steps too, which takes them out of the finished count", async () => {
    for (const text of ["One", "Two", "Three"]) await addStep(db, ana, { text }, { now });
    const [first, second] = await listWeek(db, ana, "2026-09-21");
    await completeStep(db, ana, first.id, now);
    await completeStep(db, ana, second.id, now);
    expect(await stepStats(db, ana)).toEqual({ stepsCompleted: 2, weeksWithProgress: 1 });
    // Finished steps hold their places in a full week until they're removed.
    expect(await addStep(db, ana, { text: "Four" }, { now })).toEqual({ ok: false, error: "week_full" });

    // Only the student's own, like every other change.
    expect(await removeStep(db, ben, first.id)).toBe(false);
    expect(await stepStats(db, ana)).toEqual({ stepsCompleted: 2, weeksWithProgress: 1 });

    expect(await removeStep(db, ana, first.id)).toBe(true);
    expect(await stepStats(db, ana)).toEqual({ stepsCompleted: 1, weeksWithProgress: 1 });
    expect((await listWeek(db, ana, "2026-09-21")).map((s) => s.text)).toEqual(["Two", "Three"]);
    expect(await addStep(db, ana, { text: "Four" }, { now })).toMatchObject({ ok: true });

    // The last finished step of a week takes that week out of the count too.
    expect(await removeStep(db, ana, second.id)).toBe(true);
    expect(await stepStats(db, ana)).toEqual({ stepsCompleted: 0, weeksWithProgress: 0 });
  });

  it("edits a step's text, trimmed, and changes nothing else", async () => {
    const linked = await addStep(db, ana, { text: "Sign up for the PSAT", milestoneId: "g10-sep" }, { now, library: LIBRARY });
    const own = await addStep(db, ana, { text: "Emial my counselor" }, { now });
    if (!linked.ok || !own.ok) throw new Error();
    await completeStep(db, ana, linked.step.id, now);

    const fixed = await editStep(db, ana, own.step.id, "  Email my counselor  ");
    expect(fixed).toMatchObject({ ok: true, step: { id: own.step.id, text: "Email my counselor", status: "open" } });
    // A finished step can be fixed too, and stays finished, in its week, linked to its milestone.
    expect(await editStep(db, ana, linked.step.id, "Sign up for the October PSAT")).toMatchObject({ ok: true });
    const week = await listWeek(db, ana, "2026-09-21");
    expect(week).toEqual([
      { ...linked.step, text: "Sign up for the October PSAT", status: "done", completedAt: now },
      { ...own.step, text: "Email my counselor" },
    ]);
    expect(await stepStats(db, ana)).toEqual({ stepsCompleted: 1, weeksWithProgress: 1 });
  });

  it("checks edited text the same way as a new step", async () => {
    const res = await addStep(db, ana, { text: "Visit the library" }, { now });
    if (!res.ok) throw new Error(res.error);
    const id = res.step.id;
    for (const text of ["", "   ", "x".repeat(STEP_TEXT_MAX + 1), null, 42, undefined]) {
      const added = await addStep(db, ben, { text }, { now });
      const edited = await editStep(db, ana, id, text);
      expect(edited).toEqual(added);
      expect(edited).toMatchObject({ ok: false, error: "invalid_text" });
    }
    expect(await editStep(db, ana, id, "   ")).toEqual({
      ok: false,
      error: "invalid_text",
      message: "Write a short step, like “Ask my counselor about summer programs.”",
    });
    expect(await editStep(db, ana, id, "x".repeat(STEP_TEXT_MAX + 1))).toEqual({
      ok: false,
      error: "invalid_text",
      message: `Keep it to ${STEP_TEXT_MAX} characters or fewer.`,
    });
    expect(await editStep(db, ana, id, "x".repeat(STEP_TEXT_MAX))).toMatchObject({ ok: true });
    expect(await db.select().from(schema.weeklySteps).where(eq(schema.weeklySteps.userId, ben))).toEqual([]);
  });

  it("edits only the student's own steps", async () => {
    const res = await addStep(db, ana, { text: "Mine" }, { now });
    if (!res.ok) throw new Error(res.error);
    const id = res.step.id;

    expect(await editStep(db, ben, id, "Ben's now")).toEqual({ ok: false, error: "not_found" });
    expect(await editStep(db, ana, "not-a-uuid", "Hi")).toEqual({ ok: false, error: "not_found" });
    expect(await editStep(db, ana, null, "Hi")).toEqual({ ok: false, error: "not_found" });
    expect(await editStep(db, ana, "00000000-0000-4000-8000-000000000000", "Hi")).toEqual({ ok: false, error: "not_found" });
    expect((await listWeek(db, ana, "2026-09-21")).map((s) => s.text)).toEqual(["Mine"]);

    await removeStep(db, ana, id);
    expect(await editStep(db, ana, id, "Gone")).toEqual({ ok: false, error: "not_found" });
  });

  it("holds the limit when several adds arrive at once", async () => {
    const results = await Promise.all(["a", "b", "c", "d", "e"].map((text) => addStep(db, ana, { text }, { now })));
    expect(results.filter((r) => r.ok)).toHaveLength(MAX_STEPS_PER_WEEK);
    expect(await listWeek(db, ana, "2026-09-21")).toHaveLength(MAX_STEPS_PER_WEEK);
  });

  it("returns not_found for a user that doesn't exist", async () => {
    expect(await addStep(db, "00000000-0000-4000-8000-000000000000", { text: "Hi" }, { now })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("completes, reopens and removes only the student's own steps", async () => {
    const res = await addStep(db, ana, { text: "Mine" }, { now });
    if (!res.ok) throw new Error(res.error);
    const id = res.step.id;

    expect(await completeStep(db, ben, id, now)).toBe(false);
    expect(await reopenStep(db, ben, id)).toBe(false);
    expect(await removeStep(db, ben, id)).toBe(false);
    expect(await completeStep(db, ana, "not-a-uuid", now)).toBe(false);
    expect(await removeStep(db, ana, "not-a-uuid")).toBe(false);
    expect((await listWeek(db, ana, "2026-09-21"))[0].status).toBe("open");

    expect(await completeStep(db, ana, id, now)).toBe(true);
    expect((await listWeek(db, ana, "2026-09-21"))[0]).toMatchObject({ status: "done", completedAt: now });
    expect(await reopenStep(db, ana, id)).toBe(true);
    expect((await listWeek(db, ana, "2026-09-21"))[0]).toMatchObject({ status: "open", completedAt: null });
    expect(await removeStep(db, ana, id)).toBe(true);
    expect(await listWeek(db, ana, "2026-09-21")).toEqual([]);
    expect(await removeStep(db, ana, id)).toBe(false);
  });

  it("counts lifetime progress, and a missed week takes nothing away", async () => {
    expect(await stepStats(db, ana)).toEqual({ stepsCompleted: 0, weeksWithProgress: 0 });

    const complete = async (text: string, when: Date) => {
      const res = await addStep(db, ana, { text }, { now: when });
      if (!res.ok) throw new Error(res.error);
      await completeStep(db, ana, res.step.id, when);
      return res.step.id;
    };
    await complete("One", now);
    await complete("Two", now);
    await addStep(db, ana, { text: "Still open" }, { now });
    await complete("Three", nextWeek);
    // Skip a week entirely, then come back.
    const reopened = await complete("Four", inThreeWeeks);
    expect(await stepStats(db, ana)).toEqual({ stepsCompleted: 4, weeksWithProgress: 3 });
    expect(await stepStats(db, ben)).toEqual({ stepsCompleted: 0, weeksWithProgress: 0 });

    await reopenStep(db, ana, reopened);
    expect(await stepStats(db, ana)).toEqual({ stepsCompleted: 3, weeksWithProgress: 2 });
  });

  it("builds the card view for this week", async () => {
    await addStep(db, ana, { text: "Last week" }, { now: new Date("2026-09-16T12:00:00Z") });
    await addStep(db, ana, { text: "This week" }, { now });
    const view = await weeklyStepsView(db, ana, now);
    expect(view).toMatchObject({ weekStart: "2026-09-21", max: 3, stats: { stepsCompleted: 0, weeksWithProgress: 0 } });
    expect(view.steps.map((s) => s.text)).toEqual(["This week"]);
  });
});

describe("roadmapSummary", () => {
  it("summarizes now, coming up, catch up and this week without ids or personal details", async () => {
    await markMilestone(db, ana, "g10-sep", "done", { library: LIBRARY });
    await markMilestone(db, ana, "g10-mar", "skipped", { library: LIBRARY });
    await addStep(db, ana, { text: "Ask Ana's mom (ana@example.com) about anarocks", milestoneId: "g10-sep-2" }, { now, library: LIBRARY });
    const res = await addStep(db, ana, { text: "Call 555-123-4567" }, { now, library: LIBRARY });
    if (!res.ok) throw new Error(res.error);
    await completeStep(db, ana, res.step.id, now);
    await addStep(db, ana, { text: "Old week" }, { now: new Date("2026-09-14T12:00:00Z") });

    const summary = await roadmapSummary(db, ana, 10, now, LIBRARY);
    const { thisWeek, ...rest } = summary;
    // Both steps were added in the same instant, so their order isn't meaningful here.
    expect(thisWeek).toHaveLength(2);
    expect(thisWeek).toEqual(
      expect.arrayContaining([
        { text: "Ask [name]'s mom ([email]) about [name]", done: false, milestoneId: "g10-sep-2" },
        { text: "Call [phone]", done: true, milestoneId: null },
      ]),
    );
    expect(rest).toEqual({
      grade: 10,
      graduated: false,
      month: "September",
      summer: false,
      now: [
        { id: "g10-sep", title: "Sign up for the PSAT", status: "done" },
        { id: "g10-sep-2", title: "Join a club", status: "open" },
      ],
      comingUp: [{ id: "g10-oct", title: "Take the PSAT", status: "open" }],
      catchUp: [{ id: "g10-aug", title: "Say hi to your counselor" }],
      gradeProgress: { done: 1, total: 4 },
      weeklyStepLimit: 3,
    });

    const json = JSON.stringify(summary);
    expect(json).not.toContain(ana);
    expect(json).not.toContain(res.step.id);
    expect(json).not.toMatch(/userId|user_id/);
  });

  it("uses the real library by default and handles graduates and missing grades", async () => {
    const real = await roadmapSummary(db, ana, 10, now);
    expect(Array.isArray(real.now)).toBe(true);

    const grad = await roadmapSummary(db, ana, 13, now, LIBRARY);
    expect(grad).toMatchObject({ grade: 13, graduated: true, now: [], comingUp: [], catchUp: [], gradeProgress: null });

    const unknown = await roadmapSummary(db, ana, null, now, LIBRARY);
    expect(unknown).toMatchObject({ grade: null, graduated: false, now: [], gradeProgress: null, thisWeek: [] });
  });

  it("includes any-time milestones in now, even at the end of the year", async () => {
    const library = [...LIBRARY, ms("g10-any", 10, [], "Keep a list of your activities")];
    const july = await roadmapSummary(db, ana, 10, new Date("2027-07-20T12:00:00Z"), library);
    expect(july.now).toEqual([{ id: "g10-any", title: "Keep a list of your activities", status: "open" }]);
  });

  it("leaves set-aside milestones out of grade progress", async () => {
    for (const id of ["g10-aug", "g10-sep", "g10-sep-2", "g10-oct", "g10-mar"]) {
      await markMilestone(db, ana, id, "skipped", { library: LIBRARY });
    }
    expect((await roadmapSummary(db, ana, 10, now, LIBRARY)).gradeProgress).toEqual({ done: 0, total: 0 });
  });

  it("looks ahead to next grade in the summer", async () => {
    const summary = await roadmapSummary(db, ana, 10, new Date("2027-07-20T12:00:00Z"), LIBRARY);
    expect(summary).toMatchObject({ summer: true, month: "July", comingUp: [{ id: "g11-sep", status: "open" }] });
  });
});
