import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";
import { updateMatchesAction } from "@/app/actions/discover";
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
    // Only the strengths above the middle count, and the page names them.
    expect(t).toContain(
      "Your matches now give a small boost to careers that call for your organization and curiosity. Your interests still count the most, and a lower score never pushes a career down.",
    );
    expect(t).toContain("Staying calm never changes which careers we suggest to you.");
    expect(t).toContain("See my updated matches");
    expect(html).toContain('href="/discover/results"');
    expect(t).toMatch(/How you see yourself can change as you grow — you can retake it after/);
    expect(t).not.toMatch(/\b(weak|bad at|shouldn't|can't)\b/i);
  });

  it("offers to update matches made before strengths counted, and then says they count", async () => {
    await finish("interests", (i) => (i.area === "I" ? 5 : 2));
    // "Moderately accurate" for every statement that describes the trait.
    await finish("personality", (i) => (i.keyed === 1 ? 4 : 2));
    const run = await latestMatchRun(state.db!, state.user!.id);
    expect(run?.personalityAttemptId).not.toBeNull();
    // Matches from before this release: version 1 recorded personality without using it.
    await state.db!.update(schema.matchRuns).set({ scoringVersion: "1" });
    let t = text(await render());
    expect(t).toContain(
      "Your matches were made before your strengths counted. Update them to give a small boost to careers that call for your social energy, warmth, organization and curiosity.",
    );
    expect(t).toContain("Update my matches");
    expect(t).not.toContain("updated matches");

    await updateMatchesAction();
    const updated = await latestMatchRun(state.db!, state.user!.id);
    expect(updated?.id).not.toBe(run?.id);
    expect(updated?.scoringVersion).toBe("2");
    t = text(await render());
    expect(t).toContain("Your matches now give a small boost to careers that call for your social energy, warmth, organization and curiosity.");
    expect(t).toContain("See my updated matches");
    expect(t).not.toContain("Update my matches");

    // Pressing it again changes nothing.
    await updateMatchesAction();
    expect((await latestMatchRun(state.db!, state.user!.id))?.id).toBe(updated?.id);
  });

  it("doesn't promise a boost when no work styles are loaded", async () => {
    await state.db!.delete(schema.occupationWorkStyles);
    await loadOccupationProfiles(state.db!, { fresh: true });
    await finish("interests", (i) => (i.area === "I" ? 5 : 2));
    await finish("personality", (i) => (i.keyed === 1 ? 5 : 1));
    const run = await latestMatchRun(state.db!, state.user!.id);
    expect(run).toMatchObject({ scoringVersion: "2", personalityAttemptId: null });
    const t = text(await render());
    expect(t).toContain("Your answers didn't change your matches. Your interests decide them.");
    expect(t).not.toMatch(/small boost|Update my matches|updated matches/);
    await updateMatchesAction();
    expect((await latestMatchRun(state.db!, state.user!.id))?.id).toBe(run?.id);
  });

  it("says the matches didn't change when no strength is above the middle", async () => {
    await finish("interests", (i) => (i.area === "I" ? 5 : 2));
    // Quiet and hands-on, and in the middle on warmth and organization.
    await finish("personality", (i) => {
      const item = PERSONALITY_ITEMS.find((p) => p.id === i.id)!;
      const agree = { extraversion: 2, agreeableness: 3, conscientiousness: 3, neuroticism: 3, intellect: 1 }[item.factor];
      return item.keyed === 1 ? agree : 6 - agree;
    });
    const t = text(await render());
    expect(t).toContain("Thoughtful");
    expect(t).toContain("Hands-on");
    expect(t).toContain("Your answers didn't change your matches. Your interests decide them.");
    expect(t).not.toMatch(/small boost|call for your/);
    expect(t).toContain("See my career matches");
  });

  it("points to interests when there are no matches yet", async () => {
    await finish("personality", () => 3);
    const html = await render();
    expect(text(html)).toContain("Finish the interests activity to get career matches. Your interests will decide them.");
    expect(html).toContain('href="/discover/interests"');
    expect(html).not.toContain('href="/discover/results"');
  });

  it("names the strengths that will count once there are matches", async () => {
    await finish("personality", (i) => {
      const item = PERSONALITY_ITEMS.find((p) => p.id === i.id)!;
      const agree = { extraversion: 3, agreeableness: 5, conscientiousness: 3, neuroticism: 3, intellect: 3 }[item.factor];
      return item.keyed === 1 ? agree : 6 - agree;
    });
    expect(text(await render())).toContain(
      "Finish the interests activity to get career matches. They'll give a small boost to careers that call for your warmth, but your interests count the most.",
    );
  });
});

describe("/discover/personality before it's taken", () => {
  it("tells the student their strengths can count a little in matches", async () => {
    const t = text(await render());
    expect(t).toContain(
      "This shows your strengths and how you like to work. It can also give a small boost to careers that call for your strengths. Your interests still count the most.",
    );
  });
});
