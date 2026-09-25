import { eq } from "drizzle-orm";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import type { MatchExplanation } from "@/db/schema";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "@/lib/matching/service";
import { loadExplanation } from "./load-explanation";
import ResultsPage from "./page";

// The signed-in results page, server-rendered with the student and database mocked.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));

const DAY_MS = 86_400_000;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const render = async () => renderToStaticMarkup((await ResultsPage()) as ReactNode);

beforeEach(async () => {
  const db = await createTestDb();
  state.db = db;
  const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
    ["19-2031.00", "Chemists", 4, { I: 7, R: 4 }],
    ["25-2031.00", "Secondary School Teachers", 4, { S: 7, A: 3 }],
    ["11-9151.00", "Social and Community Service Managers", 4, { R: 4, I: 4, A: 4, S: 4, E: 4, C: 4 }],
    ["43-4071.00", "File Clerks", 2, { C: 7 }],
  ];
  await db.insert(schema.occupations).values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: "" })));
  await db.insert(schema.occupationInterests).values(
    occs.flatMap(([code, , , i]) =>
      (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 })),
    ),
  );
  await loadOccupationProfiles(db, { fresh: true });
  const res = await registerStudent(db, {
    displayName: "Sam",
    email: "sam@example.com",
    password: "correct horse battery",
    birthDate: "2010-05-01",
    grade: 10,
  });
  if (!res.ok) throw new Error(res.error);
  state.user = { id: res.value.userId, role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 10 };
});

afterEach(() => {
  state.db = null;
  state.user = null;
});

/** Likes all investigative activities, likes hands-on ones, is unsure about artistic ones, and dislikes the rest. */
const SCIENTIST: Partial<Record<Riasec, number>> = { I: 5, R: 4, A: 3 };

/**
 * Finishes interests `daysAgo` days ago with the same answer for every activity in an area (1,
 * "Strongly dislike", for areas not given), and computes matches.
 */
async function takeInterests(answers: Partial<Record<Riasec, number>>, daysAgo = 0) {
  const db = state.db!;
  const userId = state.user!.id;
  const when = new Date(Date.now() - daysAgo * DAY_MS);
  const start = await startOrResumeAttempt(db, userId, "interests", new Date(when.getTime() - 60_000));
  if (!start.ok) throw new Error();
  await saveResponses(db, userId, start.attempt.id, Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, answers[i.area] ?? 1])));
  await completeAttempt(db, userId, start.attempt.id, when);
  await computeMatches(db, userId);
}

describe("/discover/results", () => {
  it("shows the code and fit labels for a clear profile", async () => {
    await takeInterests(SCIENTIST);
    const t = text(await render());
    expect(t).toContain("Your code is IRA : Investigative, Realistic, Artistic.");
    expect(t).not.toContain("No area stands out");
  });

  it("says no area stands out when every answer is 'Not sure', with no great or good fits", async () => {
    await takeInterests({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 });
    const html = await render();
    const t = text(html);
    expect(t).toContain("No area stands out. You rated all six about the same");
    expect(t).not.toContain("Your code is");
    expect(t).not.toMatch(/Great fit|Good fit/);
    expect(t).toContain("Worth exploring");
    expect(t).toMatch(/You can take the interests activity again after \w+ \d+, \d{4}\./);
    expect(html).toContain('href="/careers"');
    // All six areas are described, since none is ahead.
    expect(t).toContain("Hands-on work:");
    expect(t).toContain("Keeping things in order:");
  });

  it("says no area stands out when no area reached 'Not sure', though File Clerks match the shape", async () => {
    // "Dislike" on the Conventional activities and "Strongly dislike" on the rest.
    await takeInterests({ C: 2 });
    const run = await latestMatchRun(state.db!, state.user!.id);
    expect(run?.matches.find((m) => m.title === "File Clerks")?.score).toBe(100);
    const t = text(await render());
    expect(t).toContain("No area stands out. Overall you leaned toward disliking all six");
    expect(t).not.toMatch(/Your code is|Conventional stands out/);
    expect(t).not.toMatch(/Great fit|Good fit/);
    expect(t).toContain("Worth exploring");
    expect(t).toContain("Hands-on work:");
  });

  it("shows the template for a flat profile right away, even over an explanation stored before that rule", async () => {
    await takeInterests({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 });
    const run = await latestMatchRun(state.db!, state.user!.id);
    const stale: MatchExplanation = {
      source: "ai",
      overview: "Your strongest interest areas are hands-on work and figuring things out.",
      careers: [{ code: "19-2031.00", why: "Chemists get to do hands-on work you love." }],
    };
    await state.db!.update(schema.matchRuns).set({ explanation: stale }).where(eq(schema.matchRuns.id, run!.id));
    const t = text(await render());
    expect(t).toContain("You rated all six interest areas about the same, so no area stands out yet.");
    expect(t).not.toContain("Your strongest interest areas");
    expect(t).not.toContain("hands-on work you love");
    // Written on the server, so there's nothing to wait for.
    expect(t).not.toContain("Writing a summary");
  });

  it("links to the interests activity when a flat profile can be retaken", async () => {
    await takeInterests({}, 100);
    const html = await render();
    expect(text(html)).toContain("take the interests activity again");
    expect(html).toContain('href="/discover/interests"');
  });

  it("names a tie instead of a code picked in RIASEC order", async () => {
    await takeInterests({ A: 5, S: 4 });
    const t = text(await render());
    expect(t).toContain("Artistic and Social stand out. The other four areas are tied.");
    expect(t).not.toContain("Your code is");
  });

  it("shows one explanation to the overview and every career list", async () => {
    await takeInterests(SCIENTIST);
    const run = await latestMatchRun(state.db!, state.user!.id);
    const explanation: MatchExplanation = {
      source: "ai",
      overview: "You like figuring out how things work.",
      careers: [
        { code: "19-2031.00", why: "Chemists run experiments." },
        { code: "43-4071.00", why: "File clerks keep records in order." },
      ],
    };
    await state.db!.update(schema.matchRuns).set({ explanation }).where(eq(schema.matchRuns.id, run!.id));
    const t = text(await render());
    expect(t).toContain("You like figuring out how things work.");
    expect(t).not.toContain("Writing a summary");
    expect(t).toContain("Chemists run experiments.");
    expect(t).toContain("File clerks keep records in order.");
  });
});

describe("loading the explanation", () => {
  const found: MatchExplanation = { source: "ai", overview: "Overview.", careers: [] };

  it("asks once per run while a request is on its way", async () => {
    const explain = vi.fn(async () => found);
    const all = await Promise.all([loadExplanation("run-1", explain), loadExplanation("run-1", explain), loadExplanation("run-1", explain)]);
    expect(all).toEqual([found, found, found]);
    expect(explain).toHaveBeenCalledTimes(1);
    // A later view asks again (the server then returns the stored one), as does another run.
    await loadExplanation("run-1", explain);
    await loadExplanation("run-2", explain);
    expect(explain).toHaveBeenCalledTimes(3);
  });

  it("lets a failed request be tried again", async () => {
    const broken = vi.fn(async (): Promise<MatchExplanation | null> => {
      throw new Error("network");
    });
    await expect(loadExplanation("run-3", broken)).rejects.toThrow("network");
    const explain = vi.fn(async () => found);
    expect(await loadExplanation("run-3", explain)).toEqual(found);
  });
});
