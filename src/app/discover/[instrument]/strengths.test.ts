import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "@/lib/matching/service";
import { WORK_STYLES } from "@/lib/reference/work-styles";
import InstrumentPage from "./page";

// The personality results: the student's strengths, where finishing personality leads.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const render = async () =>
  renderToStaticMarkup(
    (await InstrumentPage({ params: Promise.resolve({ instrument: "personality" }), searchParams: Promise.resolve({}) } as PageProps<"/discover/[instrument]">)) as ReactNode,
  );

beforeEach(async () => {
  const db = await createTestDb();
  state.db = db;
  await db.insert(schema.occupations).values({ code: "19-2031.00", title: "Chemists", jobZone: 4, description: "" });
  await db.insert(schema.occupationInterests).values(
    (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: "19-2031.00", interest, score: interest === "I" ? 7 : 2 })),
  );
  await db.insert(schema.occupationWorkStyles).values(WORK_STYLES.map((s, i) => ({ occupationCode: "19-2031.00", style: s.id, impact: i % 3, distinctiveRank: null })));
  await loadOccupationProfiles(db, { fresh: true });
  const res = await registerStudent(db, { displayName: "Sam", email: "sam@example.com", password: "correct horse battery", birthDate: "2012-05-01", grade: 8 });
  if (!res.ok) throw new Error(res.error);
  state.user = { id: res.value.userId, role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 8 };
});

afterEach(() => {
  state.db = null;
  state.user = null;
});

async function finish(instrument: "interests" | "personality", answer: (item: { id: string; area?: Riasec; keyed?: 1 | -1 }) => number) {
  const db = state.db!;
  const userId = state.user!.id;
  const start = await startOrResumeAttempt(db, userId, instrument);
  if (!start.ok) throw new Error();
  const items = instrument === "interests" ? INTEREST_ITEMS : PERSONALITY_ITEMS;
  await saveResponses(db, userId, start.attempt.id, Object.fromEntries(items.map((i) => [i.id, answer(i)])));
  await completeAttempt(db, userId, start.attempt.id);
  await computeMatches(db, userId);
}

describe("/discover/personality once it's done", () => {
  it("shows five strengths with what they mean for school and work, and links to the updated matches", async () => {
    await finish("interests", (i) => (i.area === "I" ? 5 : 2));
    // Very quiet, very organized and curious, middling warmth, often stressed.
    await finish("personality", (i) => {
      const item = PERSONALITY_ITEMS.find((p) => p.id === i.id)!;
      const agree = { extraversion: 1, agreeableness: 3, conscientiousness: 5, neuroticism: 5, intellect: 4 }[item.factor];
      return item.keyed === 1 ? agree : 6 - agree;
    });
    const html = await render();
    const t = text(html);
    expect(t).toContain("Your strengths");
    // Standouts first, quiet included as a strength, staying calm last and gentle.
    const order = ["Organization", "Social energy", "Curiosity", "Warmth", "Staying calm"].map((name) => t.indexOf(`${name} `));
    expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(t).toContain("Thoughtful");
    expect(t).toContain("Quiet focus helps in every kind of job, including jobs with lots of people.");
    expect(t).toContain("Feels things deeply");
    expect(t.match(/At school/g)).toHaveLength(5);
    expect(t.match(/At work/g)).toHaveLength(5);
    expect(t).toContain("Your matches now give a small boost to careers that especially call for your strengths.");
    expect(t).toContain("Staying calm never changes which careers we suggest to you.");
    expect(t).toContain("See my updated matches");
    expect(html).toContain('href="/discover/results"');
    expect(t).toMatch(/How you see yourself can change as you grow — you can retake it after/);
    expect(t).not.toMatch(/\b(weak|bad at|shouldn't|can't)\b/i);
  });

  it("doesn't say the matches use strengths when they were made before strengths counted", async () => {
    await finish("interests", (i) => (i.area === "I" ? 5 : 2));
    await finish("personality", () => 4);
    const run = await latestMatchRun(state.db!, state.user!.id);
    await state.db!.update(schema.matchRuns).set({ scoringVersion: "1" });
    expect(run?.personalityAttemptId).not.toBeNull();
    const t = text(await render());
    expect(t).toContain("The next time your matches are updated, careers that especially call for your strengths will get a small boost.");
    expect(t).toContain("See my career matches");
    expect(t).not.toContain("updated matches");
  });

  it("points to interests when there are no matches yet", async () => {
    await finish("personality", () => 3);
    const html = await render();
    expect(text(html)).toContain("Finish the interests activity to get career matches.");
    expect(html).toContain('href="/discover/interests"');
    expect(html).not.toContain('href="/discover/results"');
  });
});
