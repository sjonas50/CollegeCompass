import { eq } from "drizzle-orm";
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import type { MatchExplanation } from "@/db/schema";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { WORK_STYLES } from "@/lib/reference/work-styles";
import { EXPLANATION_FACTS_VERSION } from "@/lib/matching/explain";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "@/lib/matching/service";
import { CareerReasons, ExplanationContext, ExplanationOverview } from "./explanation";
import { type ExplanationResult, loadExplanation, requestExplanation } from "./load-explanation";
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
    await takeInterests({ A: 5, S: 4, E: 4, C: 4 });
    const t = text(await render());
    expect(t).toContain("Artistic stands out. Social, Enterprising and Conventional are tied after it.");
    expect(t).not.toContain("Your code is");
  });

  it("never ranks an area the student disliked as an interest", async () => {
    // "Dislike" on every social activity: Social scored 10 of 40, and the code is "ASR".
    await takeInterests({ A: 5, S: 2 });
    const t = text(await render());
    expect(t).toContain("Artistic stands out. You leaned toward disliking the other five areas.");
    expect(t).not.toMatch(/Your code is|Social stand/);
    // Only Artistic is described as theirs.
    expect(t).toContain("Making things that express ideas:");
    expect(t).not.toContain("Working with people:");
  });

  it("names the two areas that reached 'Not sure' without ranking a third", async () => {
    await takeInterests({ A: 5, S: 4 });
    const t = text(await render());
    expect(t).toContain("Artistic and Social stand out. You leaned toward disliking the other four areas.");
    expect(t).not.toContain("Your code is");
  });

  it("doesn't show an explanation written from older facts for a tie, and asks for a new one", async () => {
    await takeInterests({ A: 5, S: 4, E: 4, C: 4 });
    const run = await latestMatchRun(state.db!, state.user!.id);
    const stale: MatchExplanation = {
      source: "ai",
      overview: "Your strongest interests are creating things, hands-on work and figuring things out.",
      careers: [{ code: "19-2031.00", why: "Chemists get to do hands-on work you love." }],
    };
    await state.db!.update(schema.matchRuns).set({ explanation: stale }).where(eq(schema.matchRuns.id, run!.id));
    let t = text(await render());
    expect(t).not.toContain("hands-on work");
    // The page asks for one to be written (see ExplanationProvider).
    expect(t).toContain("Writing a summary");

    // One written from the current facts is shown.
    const current: MatchExplanation = { ...stale, overview: "You love creating things.", factsVersion: EXPLANATION_FACTS_VERSION };
    await state.db!.update(schema.matchRuns).set({ explanation: current }).where(eq(schema.matchRuns.id, run!.id));
    t = text(await render());
    expect(t).toContain("You love creating things.");
    expect(t).not.toContain("Writing a summary");
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

describe("the strengths card", () => {
  beforeEach(async () => {
    // Work styles for every career, varying by career so trait demand has some spread.
    const codes = ["19-2031.00", "25-2031.00", "11-9151.00", "43-4071.00"];
    await state.db!.insert(schema.occupationWorkStyles).values(
      codes.flatMap((occupationCode, i) => WORK_STYLES.map((s, j) => ({ occupationCode, style: s.id, impact: ((i + j) % 4) - 0.5, distinctiveRank: null }))),
    );
    await loadOccupationProfiles(state.db!, { fresh: true });
  });

  /** Finishes personality with `answer` for each statement, and computes matches as finishing does. */
  async function takePersonality(answer: (item: (typeof PERSONALITY_ITEMS)[number]) => number) {
    const db = state.db!;
    const userId = state.user!.id;
    const start = await startOrResumeAttempt(db, userId, "personality");
    if (!start.ok) throw new Error();
    await saveResponses(db, userId, start.attempt.id, Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, answer(i)])));
    await completeAttempt(db, userId, start.attempt.id);
    await computeMatches(db, userId);
  }

  it("sits right below the interest areas and invites the student to find their strengths", async () => {
    await takeInterests(SCIENTIST);
    const html = await render();
    const t = text(html);
    expect(t).toContain("Find my strengths (3 min)");
    expect(t.indexOf("Your interest areas")).toBeLessThan(t.indexOf("Your strengths"));
    expect(t.indexOf("Your strengths")).toBeLessThan(t.indexOf("College degree paths"));
    expect(html).toContain('href="/discover/personality"');
  });

  it("shows all five strengths once personality is done, and says how they count", async () => {
    await takeInterests(SCIENTIST);
    // "Moderately accurate" for every statement that describes the trait.
    await takePersonality((i) => (i.keyed === 1 ? 4 : 2));
    const t = text(await render());
    for (const s of ["Social energy: Outgoing.", "Warmth: Caring.", "Organization: Organized.", "Curiosity: Curious.", "Staying calm: Feels things deeply."]) {
      expect(t).toContain(s);
    }
    // All four career traits are above the middle, so all four count, and the card names them.
    expect(t).toContain(
      "Your matches give a small boost to careers that call for your social energy, warmth, organization and curiosity. Your interests count the most.",
    );
    expect(t).toContain("What your strengths mean for school and work");
    expect(t).not.toContain("Find my strengths");
  });

  it("names only the strengths above the middle, and none when no strength is", async () => {
    await takeInterests(SCIENTIST);
    // Outgoing and curious; warmth and organization in the middle ("Very accurate" either way cancels out).
    await takePersonality((i) => (i.factor === "extraversion" || i.factor === "intellect" ? (i.keyed === 1 ? 5 : 1) : 3));
    expect(text(await render())).toContain("Your matches give a small boost to careers that call for your social energy and curiosity.");

    await state.db!.update(schema.assessmentAttempts).set({ completedAt: new Date(Date.now() - 100 * DAY_MS) });
    // Quiet and hands-on: every career trait below the middle.
    await takePersonality((i) => (i.factor === "neuroticism" ? 3 : i.keyed === 1 ? 2 : 4));
    const t = text(await render());
    expect(t).toContain("Social energy: Thoughtful.");
    expect(t).toContain("Your answers didn't change your matches. Your interests decide them.");
    expect(t).not.toMatch(/small boost|call for your/);
  });

  it("offers to update matches made before strengths counted", async () => {
    await takeInterests(SCIENTIST);
    await takePersonality((i) => (i.keyed === 1 ? 4 : 2));
    const run = await latestMatchRun(state.db!, state.user!.id);
    await state.db!.update(schema.matchRuns).set({ scoringVersion: "1" }).where(eq(schema.matchRuns.id, run!.id));
    const t = text(await render());
    expect(t).toContain("Curiosity:");
    expect(t).toContain(
      "These matches were made before your strengths counted. Update them to give a small boost to careers that call for your social energy, warmth, organization and curiosity.",
    );
    expect(t).toContain("Update my matches");
    expect(t).not.toContain("Your matches give a small boost");
  });

  it("doesn't say strengths count when no work styles are loaded", async () => {
    await state.db!.delete(schema.occupationWorkStyles);
    await loadOccupationProfiles(state.db!, { fresh: true });
    await takeInterests(SCIENTIST);
    await takePersonality((i) => (i.keyed === 1 ? 4 : 2));
    expect((await latestMatchRun(state.db!, state.user!.id))?.personalityAttemptId).toBeNull();
    const t = text(await render());
    expect(t).toContain("Curiosity:");
    expect(t).toContain("Your answers didn't change your matches. Your interests decide them.");
    expect(t).not.toMatch(/small boost|Update my matches/);
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

  it("turns a failed request into a result the page can show, never a rejection", async () => {
    // The server action's POST failing, as when the connection drops ("Failed to fetch").
    const offline = vi.fn(async (): Promise<MatchExplanation | null> => {
      throw new TypeError("Failed to fetch");
    });
    expect(await requestExplanation("run-4", offline)).toEqual({ ok: false });
    // Nothing to show is a failure too, not a summary that never arrives.
    expect(await requestExplanation("run-5", async () => null)).toEqual({ ok: false });
    // Trying again asks again.
    const explain = vi.fn(async () => found);
    expect(await requestExplanation("run-4", explain)).toEqual({ ok: true, explanation: found });
    expect(explain).toHaveBeenCalledTimes(1);
  });

  describe("on the page", () => {
    const careers = [{ code: "19-2031.00", title: "Chemists", href: "/careers/19-2031.00", label: "Great fit" }];
    const show = (result: ExplanationResult | null) =>
      text(
        renderToStaticMarkup(
          createElement(
            ExplanationContext,
            { value: { result, retry: () => {} } },
            createElement(ExplanationOverview),
            createElement(CareerReasons, { careers }),
          ),
        ),
      );

    it("says it's writing a summary only while the request is on its way", () => {
      expect(show(null)).toContain("Writing a summary of your results");
      const ready = show({ ok: true, explanation: { ...found, careers: [{ code: "19-2031.00", why: "Chemists run experiments." }] } });
      expect(ready).toContain("Overview.");
      expect(ready).toContain("Chemists run experiments.");
      expect(ready).not.toContain("Writing a summary");
    });

    it("says the summary couldn't be written, with a way to try again, when the request fails", () => {
      const html = renderToStaticMarkup(
        createElement(ExplanationContext, { value: { result: { ok: false }, retry: () => {} } }, createElement(ExplanationOverview)),
      );
      expect(text(html)).toContain("We couldn't write a summary of your results just now.");
      expect(text(html)).not.toContain("Writing a summary");
      expect(html).toMatch(/<p role="alert"[^>]*>We couldn/);
      expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
      // The careers are still listed, without reasons.
      expect(show({ ok: false })).toContain("Chemists");
    });
  });
});
