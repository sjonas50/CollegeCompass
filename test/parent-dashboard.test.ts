import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ParentHome from "@/app/parent/page";
import { type Db, createTestDb, schema } from "@/db";
import { resetEnvCache } from "@/env";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import type { BigFive, Riasec } from "@/lib/assessments/instruments";
import { schoolYearOf } from "@/lib/auth/age";
import type { SessionUser } from "@/lib/auth/sessions";
import { verifyParentConsent } from "@/lib/consent/verifier";
import type { Email } from "@/lib/email";
import { acceptInvite, createInvite } from "@/lib/invites";
import {
  PARENT_DEADLINE_LIMIT,
  PARENT_TIMELY_LIMIT,
  PARENT_TOP_MATCHES,
  fafsaMilestones,
  interestsForParent,
  parentDashboard,
  strengthsForParent,
  topMatches,
} from "@/lib/parent-dashboard";
import { exportStudentData } from "@/lib/privacy";
import { MILESTONES } from "@/lib/roadmap/milestones";
import { weekStartOf } from "@/lib/steps";

// Thursday, September 24, 2026 (a school year that started in August 2026).
const now = new Date("2026-09-24T15:00:00Z");
const thisWeek = weekStartOf(now);
const lastWeek = "2026-09-14";
const DAY_MS = 86_400_000;

let db: Db;

// The parent page reads the database and the signed-in parent through these.
const page = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => page.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => page.user, getCurrentUser: async () => page.user }));

beforeEach(async () => {
  db = await createTestDb();
  page.db = db;
});

afterEach(() => {
  page.user = null;
  vi.unstubAllEnvs();
  resetEnvCache();
});

async function parentId(email = "rosa@example.com") {
  const res = await registerParent(db, { displayName: "Rosa", email, password: "correct horse battery" });
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function child(parent: string, grade: number, username = `kid${grade}`) {
  const consent = await verifyParentConsent({ parentUserId: parent, attested: true });
  const res = await createChildAccount(
    db,
    parent,
    { displayName: `Kid${grade}`, username, password: "correct horse battery", birthDate: "2010-02-01", grade },
    consent,
    now,
  );
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

async function completedAttempt(userId: string, instrument: string, completed = true) {
  await db.insert(schema.assessmentAttempts).values({
    userId,
    instrument,
    instrumentVersion: "test",
    startedAt: new Date(now.getTime() - 86_400_000),
    completedAt: completed ? new Date(now.getTime() - 3_600_000) : null,
  });
}

describe("parent dashboard summary", () => {
  it("shows a child who just started as an early state with zero counts", async () => {
    const parent = await parentId();
    const kid = await child(parent, 9);
    const [overview] = await parentDashboard(db, parent, now);
    expect(overview.id).toBe(kid);
    expect(overview.progress).toMatchObject({
      grade: 9,
      graduated: false,
      justStarted: true,
      northStars: [],
      steps: { thisWeekDone: 0, thisWeekTotal: 0, lifetimeDone: 0 },
      plan: { courses: 0, estimatedGpa: null },
      colleges: { count: 0, nextDeadlines: null },
      fafsa: null,
    });
    expect(overview.progress.assessments.map((a) => a.state)).toEqual(["not_started", "not_started", "not_started"]);
    expect(overview.progress.roadmap?.done).toBe(0);
    expect(overview.progress.roadmap?.total).toBe(MILESTONES.filter((m) => m.grade === 9).length);
  });

  it("summarizes assessments, north stars, roadmap, steps, classes and the college list", async () => {
    const parent = await parentId();
    const kid = await child(parent, 11);
    await completedAttempt(kid, "interests");
    await completedAttempt(kid, "personality", false);
    await db.insert(schema.northStarGoals).values([
      { userId: kid, occupationCode: "29-1141.00", title: "Registered Nurses" },
      { userId: kid, occupationCode: "29-1123.00", title: "Physical Therapists" },
    ]);
    const grade11 = MILESTONES.filter((m) => m.grade === 11);
    // Done and set aside: three that aren't timely in September, and one that is.
    const later = grade11.filter((m) => !m.months.includes(8) && !m.months.includes(9));
    const september = grade11.filter((m) => m.months.includes(9));
    await db.insert(schema.studentMilestones).values([
      { userId: kid, milestoneId: later[0].id, status: "done" },
      { userId: kid, milestoneId: later[1].id, status: "skipped" },
      { userId: kid, milestoneId: september[0].id, status: "done" },
    ]);
    await db.insert(schema.weeklySteps).values([
      { userId: kid, weekStart: thisWeek, text: "Ask about the PSAT", status: "done" },
      { userId: kid, weekStart: thisWeek, text: "Look up nursing programs" },
      { userId: kid, weekStart: lastWeek, text: "Visit the library", status: "done" },
      { userId: kid, weekStart: lastWeek, text: "Email my coach" },
    ]);
    await db.insert(schema.studentCourses).values([
      { userId: kid, name: "Biology", subject: "science", gradeLevel: 10, status: "completed", finalGrade: "A" },
      { userId: kid, name: "Geometry", subject: "math", gradeLevel: 10, status: "completed", finalGrade: "B" },
      { userId: kid, name: "Chemistry", subject: "science", gradeLevel: 11, status: "in_progress" },
    ]);
    await db.insert(schema.collegeList).values([
      { userId: kid, name: "Far College", deadline: "2027-01-15", deadlineType: "regular" },
      { userId: kid, name: "Soon University", deadline: "2026-10-15", deadlineType: "early_action" },
      { userId: kid, name: "Sent College", deadline: "2026-10-01", status: "applied" },
      { userId: kid, name: "Passed College", deadline: "2026-09-01" },
      { userId: kid, name: "Middle College", deadline: "2026-11-01", deadlineType: "early_decision" },
      { userId: kid, name: "Later College", deadline: "2027-02-01" },
      { userId: kid, name: "Undated Program", kind: "program" },
    ]);

    const [{ progress: p }] = await parentDashboard(db, parent, now);
    expect(p.justStarted).toBe(false);
    expect(p.assessments).toEqual([
      { id: "interests", title: "Interests", state: "done" },
      { id: "personality", title: "Personality", state: "in_progress" },
      { id: "values", title: "What matters to you", state: "not_started" },
    ]);
    expect(p.northStars).toEqual([
      { code: "29-1141.00", title: "Registered Nurses" },
      { code: "29-1123.00", title: "Physical Therapists" },
    ]);
    // Interests are marked done here without a stored result, so there's nothing to show yet.
    expect(p.results).toBeNull();
    // Set-aside milestones don't count against the student.
    expect(p.roadmap).toMatchObject({ done: 2, total: grade11.length - 1 });
    // The same list the student's dashboard leads with: open milestones for this month, then catch-up.
    expect(p.roadmap!.timely.map((m) => m.id)).toEqual(september.slice(1, 1 + PARENT_TIMELY_LIMIT).map((m) => m.id));
    expect(p.steps).toEqual({ thisWeekDone: 1, thisWeekTotal: 2, lifetimeDone: 2 });
    expect(p.plan).toEqual({ courses: 3, estimatedGpa: 3.5 });
    expect(p.colleges.count).toBe(7);
    // Unsent, upcoming, soonest first, at most three.
    expect(p.colleges.nextDeadlines).toHaveLength(PARENT_DEADLINE_LIMIT);
    expect(p.colleges.nextDeadlines!.map((d) => d.name)).toEqual(["Soon University", "Middle College", "Far College"]);
    expect(p.colleges.nextDeadlines![0]).toEqual({ name: "Soon University", deadlineType: "early_action", deadline: "2026-10-15", daysLeft: 21 });
    expect(p.fafsa).toBeNull();
  });

  it("leaves out deadlines before 11th grade", async () => {
    const parent = await parentId();
    const kid = await child(parent, 10);
    await db.insert(schema.collegeList).values({ userId: kid, name: "State University", deadline: "2026-10-15" });
    const [{ progress }] = await parentDashboard(db, parent, now);
    expect(progress.colleges).toEqual({ count: 1, nextDeadlines: null });
  });

  it("shows seniors' FAFSA milestones with their status", async () => {
    const parent = await parentId();
    const kid = await child(parent, 12);
    await db.insert(schema.studentMilestones).values([
      { userId: kid, milestoneId: "g12-file-the-fafsa", status: "done" },
      { userId: kid, milestoneId: "g12-check-state-aid-programs", status: "skipped" },
    ]);
    const [{ progress }] = await parentDashboard(db, parent, now);
    const ids = fafsaMilestones().map((m) => m.id);
    expect(ids).toContain("g12-file-the-fafsa");
    expect(ids.every((id) => id.startsWith("g12-"))).toBe(true);
    expect(progress.fafsa?.map((m) => m.id)).toEqual(ids);
    const status = Object.fromEntries(progress.fafsa!.map((m) => [m.id, m.status]));
    expect(status["g12-file-the-fafsa"]).toBe("done");
    expect(status["g12-check-state-aid-programs"]).toBe("skipped");
    expect(Object.values(status).filter((s) => s === "open").length).toBe(ids.length - 2);
  });

  it("handles a child who finished high school", async () => {
    const parent = await parentId();
    const kid = await child(parent, 12);
    const [{ progress }] = await parentDashboard(db, parent, new Date("2027-09-01T15:00:00Z"));
    expect(progress).toMatchObject({ grade: 13, graduated: true, roadmap: null, fafsa: null });
    expect(kid).toBeTruthy();
  });

  it("only covers the parent's own children", async () => {
    const rosa = await parentId();
    const other = await parentId("other@example.com");
    await child(rosa, 8, "rosakid");
    await child(other, 9, "otherkid");
    const teen = await registerStudent(
      db,
      { displayName: "Solo", email: "solo@example.com", password: "correct horse battery", birthDate: "2010-01-01", grade: 10 },
      now,
    );
    if (!teen.ok) throw new Error();
    expect((await parentDashboard(db, rosa, now)).map((c) => c.username)).toEqual(["rosakid"]);
    expect(await parentDashboard(db, teen.value.userId, now)).toEqual([]);
  });

  it("never includes counselor conversations, memory notes or safety events", async () => {
    const parent = await parentId();
    const kid = await child(parent, 11);
    const [conversation] = await db
      .insert(schema.counselorConversations)
      .values({ userId: kid, title: "SECRET-TITLE", concernFlagged: true, context: "SECRET-CONTEXT" })
      .returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conversation.id, role: "user", content: "SECRET-MESSAGE" });
    await db.insert(schema.counselorMemory).values({ userId: kid, notes: ["SECRET-MEMORY"] });
    await db.insert(schema.safetyEvents).values({ userId: kid, category: "distress", severity: "medium", sources: ["rules"], excerpt: "SECRET-EXCERPT" });
    await db.insert(schema.collegeList).values({ userId: kid, name: "State University", notes: "SECRET-NOTE", aidOffer: { grants: 12345 } });

    const overview = await parentDashboard(db, parent, now);
    const dump = JSON.stringify(overview);
    expect(dump).not.toContain("SECRET");
    expect(dump).not.toContain("12345");
    expect(dump).not.toMatch(/concern|safety|memory|conversation/i);
  });

  it("runs the same number of queries for one child or many", async () => {
    let queries = 0;
    const counted = drizzle({ client: new PGlite(), schema, logger: { logQuery: () => void queries++ } }) as unknown as Db;
    await migrate(counted as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    db = counted;

    const one = await parentId("one@example.com");
    await withResults(await child(one, 11, "only"));
    const many = await parentId("many@example.com");
    // Results for some children and not others, each with their own matches.
    for (const grade of [7, 9, 10, 11, 12]) {
      const kid = await child(many, grade, `many${grade}`);
      if (grade !== 9) await withResults(kid);
    }

    queries = 0;
    const [only] = await parentDashboard(db, one, now);
    const forOne = queries;
    expect(only.progress.results?.topMatches).toHaveLength(PARENT_TOP_MATCHES);
    queries = 0;
    const overviews = await parentDashboard(db, many, now);
    expect(overviews).toHaveLength(5);
    expect(overviews.filter((o) => o.progress.results)).toHaveLength(4);
    expect(queries).toBe(forOne);
    expect(forOne).toBeLessThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Results: what the activities found
// ---------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

/** A finished activity with its stored result. */
async function result(userId: string, instrument: "interests" | "personality" | "values", scores: object, completedAt = new Date(now.getTime() - HOUR_MS)) {
  const [attempt] = await db
    .insert(schema.assessmentAttempts)
    .values({ userId, instrument, instrumentVersion: "test", startedAt: new Date(completedAt.getTime() - HOUR_MS), completedAt })
    .returning({ id: schema.assessmentAttempts.id });
  await db.insert(schema.assessmentResults).values({ attemptId: attempt.id, scores: scores as Record<string, unknown>, scoringVersion: "2" });
  return attempt.id;
}

/** A set of career matches, stored in rank order like computeMatches does: [code, title, score]. */
async function matchRun(userId: string, interestsAttemptId: string, careers: [string, string, number][], createdAt = new Date(now.getTime() - HOUR_MS)) {
  const [run] = await db.insert(schema.matchRuns).values({ userId, interestsAttemptId, scoringVersion: "2", createdAt }).returning({ id: schema.matchRuns.id });
  await db.insert(schema.careerMatches).values(
    careers.map(([occupationCode, title, score], i) => ({ runId: run.id, rank: i + 1, occupationCode, title, score, interestFit: score })),
  );
}

const areas = (a: Partial<Record<Riasec, number>>): Record<Riasec, number> => ({ R: 0, I: 0, A: 0, S: 0, E: 0, C: 0, ...a });

/** Investigative first, then Artistic and Social tied: code IAS. */
const IAS = areas({ R: 10, I: 35, A: 30, S: 30, E: 15, C: 5 });
/** Very calm (neuroticism 10) and very curious; above the middle on warmth and organization, below it on social energy. */
const TRAITS: Record<BigFive, number> = { extraversion: 40, agreeableness: 75, conscientiousness: 55, neuroticism: 10, intellect: 90 };
/** Degree paths first (ranks 1–5), then training paths (6–8), as computeMatches stores them. */
const CAREERS: [string, string, number][] = [
  ["19-2031.00", "Chemists", 91],
  ["17-2051.00", "Civil Engineers", 89],
  ["27-1024.00", "Graphic Designers", 86],
  ["25-2031.00", "Secondary School Teachers", 84],
  ["19-1029.00", "Biologists", 80],
  ["29-2012.00", "Medical and Clinical Laboratory Technicians", 90],
  ["47-2111.00", "Electricians", 85],
  ["43-4071.00", "File Clerks", 60],
];
/** The five highest scores, from both lists. */
const TOP_FIVE = [
  { code: "19-2031.00", title: "Chemists" },
  { code: "29-2012.00", title: "Medical and Clinical Laboratory Technicians" },
  { code: "17-2051.00", title: "Civil Engineers" },
  { code: "27-1024.00", title: "Graphic Designers" },
  { code: "47-2111.00", title: "Electricians" },
];

/** Interests, personality and values results, with matches. */
async function withResults(userId: string, { interests = IAS, traits = TRAITS } = {}) {
  const attempt = await result(userId, "interests", { areas: interests, code: "IAS" });
  await result(userId, "personality", { traits });
  await result(userId, "values", { ranking: ["relationships", "achievement", "support", "independence", "recognition", "working_conditions"] });
  await matchRun(userId, attempt, CAREERS);
}

/** Every way the page could describe emotional stability ("Staying calm"), at any level. */
const STAYING_CALM = ["Staying calm", "Steady", "Bounces back", "Feels things deeply", "stress", "calm", "neuroticism"];

describe("what parents see of their children's results", () => {
  it("shows interests, the strengths that count and the top five matches for each child, and nothing for a child with none", async () => {
    const parent = await parentId();
    const withAll = await child(parent, 10, "kid10");
    const without = await child(parent, 8, "kid8");
    await withResults(withAll);
    await db.insert(schema.northStarGoals).values({ userId: withAll, occupationCode: "19-2031.00", title: "Chemists" });
    // Some progress, but no activity finished.
    await completedAttempt(without, "interests", false);

    const [ten, eight] = await parentDashboard(db, parent, now);
    expect(ten.id).toBe(withAll);
    expect(ten.progress.results).toEqual({
      interests: {
        noLead: false,
        text: "Kid10's interest code is IAS: Investigative, Artistic and Social. Artistic and Social are tied, so their order doesn't matter.",
      },
      // Highest first; social energy is below the middle, so it isn't listed.
      strengths: [
        { trait: "intellect", name: "Curiosity", label: "Curious" },
        { trait: "agreeableness", name: "Warmth", label: "Caring" },
        { trait: "conscientiousness", name: "Organization", label: "Organized when it counts" },
      ],
      topMatches: TOP_FIVE,
    });
    expect(ten.progress.northStars).toEqual([{ code: "19-2031.00", title: "Chemists" }]);

    expect(eight.id).toBe(without);
    expect(eight.progress.results).toBeNull();
    expect(eight.progress.justStarted).toBe(false);
    expect(eight.progress.assessments.map((a) => a.state)).toEqual(["in_progress", "not_started", "not_started"]);
  });

  it("never includes emotional stability, however it was answered", async () => {
    const parent = await parentId();
    const anxious = await child(parent, 10, "kid10");
    const calm = await child(parent, 11, "kid11");
    await withResults(anxious, { traits: { ...TRAITS, neuroticism: 95 } });
    await withResults(calm, { traits: { extraversion: 20, agreeableness: 30, conscientiousness: 40, neuroticism: 0, intellect: 50 } });

    const overviews = await parentDashboard(db, parent, now);
    for (const o of overviews) {
      expect(o.progress.results?.strengths?.map((s) => s.trait)).not.toContain("neuroticism");
      const dump = JSON.stringify(o.progress);
      for (const word of STAYING_CALM) expect(dump).not.toContain(word);
    }
    // Nothing above the middle of the scale (and 50 is the middle): no strengths to list.
    expect(overviews[1].progress.results?.strengths).toEqual([]);
  });

  it("uses the latest result and the latest matches", async () => {
    const parent = await parentId();
    const kid = await child(parent, 10, "kid10");
    const earlier = new Date(now.getTime() - 100 * 24 * HOUR_MS);
    const old = await result(kid, "interests", { areas: areas({ R: 40, I: 30, C: 25 }), code: "RIC" }, earlier);
    await result(kid, "personality", { traits: { ...TRAITS, extraversion: 95 } }, earlier);
    await matchRun(kid, old, [["47-2111.00", "Electricians", 95]], earlier);
    await withResults(kid);
    // A retake that was started but not finished doesn't hide the finished one.
    await completedAttempt(kid, "interests", false);

    const [{ progress }] = await parentDashboard(db, parent, now);
    expect(progress.results?.interests?.text).toContain("IAS");
    expect(progress.results?.strengths?.map((s) => s.trait)).not.toContain("extraversion");
    expect(progress.results?.topMatches).toEqual(TOP_FIVE);
  });

  it("is honest when no interest area stands out", async () => {
    const parent = await parentId();
    const kid = await child(parent, 9, "kid9");
    await withResults(kid, { interests: areas({ R: 20, I: 20, A: 21, S: 20, E: 20, C: 19 }) });
    const [{ progress }] = await parentDashboard(db, parent, now);
    expect(progress.results?.interests).toEqual({
      noLead: true,
      text: "No area stands out yet. Kid9 rated all six interest areas about the same, which can happen when they're not sure yet.",
    });
  });

  it("shows strengths before interests are done, and matches only once there are some", async () => {
    const parent = await parentId();
    const kid = await child(parent, 7, "kid7");
    await result(kid, "personality", { traits: TRAITS });
    const [{ progress }] = await parentDashboard(db, parent, now);
    expect(progress.results).toEqual({ interests: null, strengths: expect.any(Array), topMatches: [] });
    expect(progress.results?.strengths).toHaveLength(3);
  });
});

describe("interestsForParent", () => {
  const text = (a: Partial<Record<Riasec, number>>) => interestsForParent(areas(a), "Mia");

  it("gives the code, and says when areas in it are tied", () => {
    expect(text({ A: 40, S: 30, E: 25 })).toEqual({ noLead: false, text: "Mia's interest code is ASE: Artistic, Social and Enterprising." });
    expect(text(IAS).text).toBe(
      "Mia's interest code is IAS: Investigative, Artistic and Social. Artistic and Social are tied, so their order doesn't matter.",
    );
  });

  it("names only the areas that stand out when a tie decides the last places", () => {
    expect(text({ A: 40, S: 30, E: 20, C: 20, R: 10, I: 5 })).toEqual({
      noLead: false,
      text: "Artistic and Social stand out. Enterprising and Conventional are tied after them.",
    });
    expect(text({ R: 30, I: 30, A: 30, S: 30, E: 10, C: 10 }).text).toBe(
      "Realistic, Investigative, Artistic and Social are tied for their top area.",
    );
  });

  it("never ranks areas the child leaned toward disliking", () => {
    expect(text({ A: 40, S: 1 })).toEqual({ noLead: false, text: "Artistic stands out. Mia leaned toward disliking the other five areas." });
    expect(text({ R: 19, I: 15, A: 5, S: 2, E: 0, C: 10 })).toEqual({
      noLead: true,
      text: "No area stands out yet. Mia leaned toward disliking all six interest areas, which can happen before they've tried many of these activities.",
    });
  });

  it("says when the areas were rated about the same", () => {
    expect(text({ R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 })).toEqual({
      noLead: true,
      text: "No area stands out yet. Mia rated all six interest areas about the same, which can happen when they're not sure yet.",
    });
  });
});

describe("strengthsForParent", () => {
  it("lists the strengths that count, highest first, in the student's words", () => {
    expect(strengthsForParent(TRAITS)).toEqual([
      { trait: "intellect", name: "Curiosity", label: "Curious" },
      { trait: "agreeableness", name: "Warmth", label: "Caring" },
      { trait: "conscientiousness", name: "Organization", label: "Organized when it counts" },
    ]);
    expect(strengthsForParent({ ...TRAITS, extraversion: 80 }).map((s) => s.label)).toEqual(["Curious", "Outgoing", "Caring", "Organized when it counts"]);
  });

  it("never lists emotional stability, at any score", () => {
    for (const neuroticism of [0, 10, 50, 51, 90, 100]) {
      const strengths = strengthsForParent({ extraversion: 50, agreeableness: 50, conscientiousness: 50, intellect: 50, neuroticism });
      expect(strengths).toEqual([]);
    }
  });
});

describe("topMatches", () => {
  it("takes the highest scores from degree and training paths, keeping stored order for ties", () => {
    const rows = CAREERS.map(([code, title, score], i) => ({ code, title, score, rank: i + 1 }));
    expect(topMatches(rows)).toEqual(TOP_FIVE);
    expect(topMatches([...rows].reverse())).toEqual(TOP_FIVE);
    const tied = [
      { code: "b", title: "B", score: 80, rank: 2 },
      { code: "a", title: "A", score: 80, rank: 1 },
    ];
    expect(topMatches(tied)).toEqual([
      { code: "a", title: "A" },
      { code: "b", title: "B" },
    ]);
    expect(topMatches([])).toEqual([]);
  });
});

describe("parent results and the parent's data download", () => {
  /** A 15-year-old who signed up on their own, then linked a parent through an invitation. */
  async function invitedTeen(parent: string) {
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    const sent: Email[] = [];
    await createInvite(db, res.value.userId, "rosa@example.com", { appUrl: "https://compass.example", send: async (e) => void sent.push(e), now });
    const accepted = await acceptInvite(db, /\/invite\/(\S+)/.exec(sent[0].text)![1], parent, now);
    if (!accepted.ok) throw new Error(accepted.error);
    return res.value.userId;
  }

  it("shows nothing a linked parent's download of a teen's own account doesn't already have", async () => {
    const parent = await parentId();
    const teen = await invitedTeen(parent);
    const earlier = new Date(now.getTime() - 100 * 24 * HOUR_MS);
    await matchRun(teen, await result(teen, "interests", { areas: areas({ R: 40 }), code: "RIA" }, earlier), [["47-2111.00", "Electricians", 95]], earlier);
    await withResults(teen);
    await db.insert(schema.northStarGoals).values({ userId: teen, occupationCode: "19-2031.00", title: "Chemists" });

    const [{ progress, parentManaged }] = await parentDashboard(db, parent, now);
    expect(parentManaged).toBe(false);
    const exported = await exportStudentData(db, parent, teen);
    if (!exported) throw new Error("no export");
    // The parent's copy of a teen who owns their account: counselor chats and notes are left out.
    expect(exported).toHaveProperty("notIncluded");

    const latest = <T extends { completedAt: Date | null }>(rows: T[]) => rows.reduce((a, b) => ((b.completedAt ?? 0) > (a.completedAt ?? 0) ? b : a));
    const interests = latest(exported.assessments.filter((a) => a.instrument === "interests"));
    const personality = latest(exported.assessments.filter((a) => a.instrument === "personality"));
    expect(progress.results?.interests).toEqual(interestsForParent((interests.scores as { areas: Record<Riasec, number> }).areas, "Ana"));
    const traits = (personality.scores as { traits: Record<BigFive, number> }).traits;
    expect(progress.results?.strengths).toEqual(strengthsForParent(traits));

    const run = exported.careerMatches.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    expect(progress.results?.topMatches).toEqual(topMatches(run.matches.map((m) => ({ code: m.occupationCode, title: m.title, score: m.score, rank: m.rank }))));
    expect(progress.northStars).toEqual(exported.northStars.map((s) => ({ code: s.occupationCode, title: s.title })));
  });
});

// ---------------------------------------------------------------------------
// The page (server-rendered with the signed-in parent mocked; it uses the real clock)
// ---------------------------------------------------------------------------

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

async function signInParent(id: string) {
  page.user = { id, role: "parent", displayName: "Rosa", username: null, householdId: null, parentManaged: false, grade: null };
}

async function renderParentPage(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await ParentHome({ searchParams: Promise.resolve(searchParams) } as PageProps<"/parent">));
}

/** Pins a child's grade to this school year on the real clock, so the page shows that grade. */
async function setGradeNow(userId: string, grade: number) {
  await db.update(schema.users).set({ grade, gradeSchoolYear: schoolYearOf(new Date()) }).where(eq(schema.users.id, userId));
}

describe("parent page", () => {
  it("shows progress, keeps the controls, links to the aid guide and billing, and nothing private", async () => {
    const parent = await parentId();
    const kid = await child(parent, 11);
    await setGradeNow(kid, 11);
    await completedAttempt(kid, "interests");
    await db.insert(schema.northStarGoals).values({ userId: kid, occupationCode: "29-1141.00", title: "Registered Nurses" });
    const [conversation] = await db.insert(schema.counselorConversations).values({ userId: kid, title: "SECRET-TITLE" }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conversation.id, role: "user", content: "SECRET-MESSAGE" });
    await db.insert(schema.counselorMemory).values({ userId: kid, notes: ["SECRET-MEMORY"] });
    await db.insert(schema.safetyEvents).values({ userId: kid, category: "distress", severity: "medium", sources: ["rules"], excerpt: "SECRET-EXCERPT" });
    await signInParent(parent);

    const html = await renderParentPage();
    const t = text(html);
    expect(t).toContain("Chats with the AI counselor aren't shown on this page.");
    expect(t).toContain("Registered Nurses");
    expect(t).toContain("1 of 3 done");
    expect(t).toContain("11th grade roadmap");
    expect(html).not.toContain("SECRET");
    expect(html).toContain('href="/aid/en"');
    expect(html).toMatch(/<a[^>]*href="\/aid\/es"[^>]*lang="es"|<a[^>]*lang="es"[^>]*href="\/aid\/es"/);
    expect(html).toContain('href="/account/billing"');
    expect(html).toContain(`href="/api/parent/children/${kid}/export"`);
    expect(html).toContain(`href="/parent/children/${kid}/delete"`);
    expect(html).toContain('name="reminders"');
    expect(html).toContain('name="grade"');
  });

  it("shows an early state for a child who just started", async () => {
    const parent = await parentId();
    await child(parent, 8);
    await signInParent(parent);
    expect(text(await renderParentPage())).toContain("Kid8 is just getting started.");
  });

  it("shows a senior's financial aid steps", async () => {
    const parent = await parentId();
    const kid = await child(parent, 12);
    await setGradeNow(kid, 12);
    await db.insert(schema.studentMilestones).values({ userId: kid, milestoneId: "g12-file-the-fafsa", status: "done" });
    await signInParent(parent);
    const t = text(await renderParentPage());
    expect(t).toContain("Senior year: applying for financial aid");
    expect(t).toContain("File your FAFSA as soon as you can Done");
  });

  it("words the billing card for the family's access and whether plans are offered", async () => {
    const parent = await parentId();
    await signInParent(parent);
    // A new family is on its trial. Without paid plans, the card offers only free access.
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    resetEnvCache();
    let t = text(await renderParentPage());
    expect(t).toContain("Paid plans aren't available yet, but you can turn on free access there.");
    expect(t).not.toContain("See or change your family's plan");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_monthly");
    resetEnvCache();
    expect(text(await renderParentPage())).toContain("Choose a plan for your family. If cost is a problem, you can turn on free access there.");

    const [{ householdId }] = await db.select({ householdId: schema.users.householdId }).from(schema.users).where(eq(schema.users.id, parent));
    await db.insert(schema.accessGrants).values({
      householdId: householdId!,
      kind: "free_access",
      startsAt: new Date(Date.now() - DAY_MS),
      endsAt: new Date(Date.now() + 300 * DAY_MS),
    });
    t = text(await renderParentPage());
    expect(t).toContain("See when your free access ends and when you can renew it.");
    expect(t).not.toContain("If cost is a problem");
  });

  it("says nothing was deleted when a delete found nothing, and never claims a deletion", async () => {
    const parent = await parentId();
    await child(parent, 9);
    await signInParent(parent);
    const t = text(await renderParentPage({ "not-deleted": "1" }));
    expect(t).toContain("Nothing was deleted. That account may already be gone.");
    expect(t).not.toContain("were deleted");
  });

  it("gives the Delete my parent account link a full-size target", async () => {
    await signInParent(await parentId());
    expect(await renderParentPage()).toMatch(/<a class="[^"]*\binline-flex\b[^"]*\bmin-h-11\b[^"]*" href="\/parent\/delete">Delete my parent account<\/a>/);
  });

  it("helps a parent with no children yet, and confirms a new link", async () => {
    const parent = await parentId();
    await signInParent(parent);
    const t = text(await renderParentPage({ linked: "1" }));
    expect(t).toContain("No children added yet.");
    expect(t).toContain("ask them to invite you from their dashboard");
    expect(t).toContain("You're linked.");
    expect(t).toContain("Paying for college");
    expect(t).not.toContain("O*NET");
  });

  it("shows each child's results, for now, with career links, and says when a child has none yet", async () => {
    const parent = await parentId();
    const kid = await child(parent, 10, "kid10");
    const other = await child(parent, 8, "kid8");
    await withResults(kid);
    await db.insert(schema.northStarGoals).values({ userId: kid, occupationCode: "25-2031.00", title: "Secondary School Teachers" });
    await completedAttempt(other, "interests", false);
    // Private data the page must never show, next to the results.
    const [conversation] = await db.insert(schema.counselorConversations).values({ userId: kid, title: "SECRET-TITLE" }).returning();
    await db.insert(schema.counselorMessages).values({ conversationId: conversation.id, role: "user", content: "SECRET-MESSAGE" });
    await db.insert(schema.counselorMemory).values({ userId: kid, notes: ["SECRET-MEMORY"] });
    await db.insert(schema.safetyEvents).values({ userId: kid, category: "distress", severity: "medium", sources: ["rules"], excerpt: "SECRET-EXCERPT" });
    await signInParent(parent);

    const html = await renderParentPage();
    const t = text(html);
    expect(t.match(/Results, for now/g)).toHaveLength(1);
    expect(t).toContain("What Kid10's activities show so far.");
    expect(t).toContain("Kid10's interest code is IAS: Investigative, Artistic and Social.");
    expect(t).toContain("Strengths Kid10 sees in themselves: Curiosity: Curious Warmth: Caring Organization: Organized when it counts");
    expect(t).toContain("Top career matches");
    for (const { code, title } of [...TOP_FIVE, { code: "25-2031.00", title: "Secondary School Teachers" }]) {
      expect(html).toMatch(new RegExp(`<a class="[^"]*\\bmin-h-11\\b[^"]*" href="/careers/${code}">${title}</a>`));
    }
    // Only the top five matches.
    expect(html).not.toContain('href="/careers/43-4071.00"');
    expect(html).not.toContain('href="/careers/19-1029.00"');
    for (const word of STAYING_CALM) expect(t).not.toContain(word);
    expect(html).not.toContain("SECRET");

    expect(t).toContain("Results show up here once Kid8 finishes an activity.");
    expect(t).toContain("You see progress, results and plans here, not what your child talks about.");
    expect(t).toContain("O*NET Career Exploration Tools");
    expect(t).toContain("O*NET Database");
  });

  it("calls matches careers to explore when no interest area stands out", async () => {
    const parent = await parentId();
    const kid = await child(parent, 9, "kid9");
    await withResults(kid, { interests: areas({ R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 }) });
    await signInParent(parent);
    const t = text(await renderParentPage());
    expect(t).toContain("No area stands out yet. Kid9 rated all six interest areas about the same");
    expect(t).toContain("Careers to explore No interest area stands out yet, so these are just a place to start.");
    expect(t).not.toContain("Top career matches");
    expect(t).not.toContain("interest code");
  });

  it("says when no strength stood out, and what's still to come", async () => {
    const parent = await parentId();
    const kid = await child(parent, 7, "kid7");
    await result(kid, "personality", { traits: { extraversion: 30, agreeableness: 50, conscientiousness: 45, neuroticism: 90, intellect: 20 } });
    await signInParent(parent);
    const t = text(await renderParentPage());
    expect(t).toContain("Done. No strength stood out above the middle of the scale this time. Ask Kid7 what they learned about themselves.");
    expect(t.match(/Shows here after the Interests activity\./g)).toHaveLength(2);
    for (const word of STAYING_CALM) expect(t).not.toContain(word);
    expect(t).not.toContain("O*NET");
  });
});
