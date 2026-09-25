import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { type BigFive, PERSONALITY_ITEMS } from "@/lib/assessments/instruments";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "@/lib/assessments/service";
import type { SessionUser } from "@/lib/auth/sessions";
import CareerPage from "./page";

// "Where your strengths help" on a career page: the career's most distinctive work styles, and for
// a student who took personality, which of them fit their strengths.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const render = async (code = "29-1141.00") =>
  renderToStaticMarkup(
    (await CareerPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve({}) } as PageProps<"/careers/[code]">)) as ReactNode,
  );

beforeEach(async () => {
  const db = await createTestDb();
  state.db = db;
  await db.insert(schema.occupations).values([
    { code: "29-1141.00", title: "Registered Nurses", description: "Assess patient health problems and needs.", jobZone: 3 },
    { code: "53-7062.00", title: "Laborers and Freight, Stock, and Material Movers, Hand", description: "Move freight.", jobZone: 1 },
  ]);
  await db.insert(schema.occupationInterests).values(
    ["29-1141.00", "53-7062.00"].flatMap((code) =>
      (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: interest === "S" ? 7 : 3 })),
    ),
  );
  // Registered Nurses' ranked work styles in O*NET 31.0 (1 is the most distinctive), and two unranked.
  const ranked = ["sincerity", "adaptability", "perseverance", "empathy", "stress_tolerance", "self_control", "social_orientation", "cooperation", "cautiousness", "integrity"];
  await db.insert(schema.occupationWorkStyles).values([
    ...ranked.map((style, i) => ({ occupationCode: "29-1141.00", style, impact: 2.2, distinctiveRank: i + 1 })),
    { occupationCode: "29-1141.00", style: "attention_to_detail", impact: 3, distinctiveRank: null },
    { occupationCode: "29-1141.00", style: "humility", impact: 1.28, distinctiveRank: null },
  ]);
});

afterEach(() => {
  state.db = null;
  state.user = null;
});

async function signInStudent(personality?: Record<BigFive, number>) {
  const db = state.db!;
  const res = await registerStudent(db, { displayName: "Sam", email: "sam@example.com", password: "correct horse battery", birthDate: "2010-05-01", grade: 10 });
  if (!res.ok) throw new Error(res.error);
  state.user = { id: res.value.userId, role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 10 };
  if (!personality) return;
  // Answers that score each trait as given (1–5 on every statement, reversed where keyed −1).
  const answer = (score: number) => 1 + Math.round((score / 100) * 4);
  const start = await startOrResumeAttempt(db, res.value.userId, "personality");
  if (!start.ok) throw new Error();
  await saveResponses(
    db,
    res.value.userId,
    start.attempt.id,
    Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, i.keyed === 1 ? answer(personality[i.factor]) : 6 - answer(personality[i.factor])])),
  );
  await completeAttempt(db, res.value.userId, start.attempt.id);
}

describe("/careers/[code] strengths", () => {
  it("shows a signed-out visitor the career's five most distinctive work styles, with nothing personal", async () => {
    const t = text(await render());
    expect(t).toContain("Strengths that help in this work");
    expect(t).toMatch(/Sincerity\. .* Adaptability\. .* Perseverance\. .* Empathy\. .* Handling pressure\./);
    expect(t).not.toContain("Self-control");
    expect(t).not.toContain("Attention to detail");
    expect(t).not.toMatch(/Where your strengths help|Fits your strength|Skills you can build|Also important in this work|Find your strengths/);
    expect(t).toContain("O*NET made these ratings with a mix of AI and expert judgment, so treat them as a starting point.");
  });

  it("links styles to a student's strengths, and shows styles no trait is linked to without anything personal", async () => {
    // Warm and curious, in the middle on organization, quiet, and often stressed.
    await signInStudent({ extraversion: 0, agreeableness: 100, conscientiousness: 50, neuroticism: 100, intellect: 75 });
    const html = await render();
    const t = text(html);
    expect(t).toContain("Where your strengths help");
    // The middle of the scale is a strength too ("Organized when it counts" on the strengths page).
    expect(t).toMatch(
      /Your strengths that fit Adaptability\. .* Fits your strength: Curious Perseverance\. .* Fits your strength: Organized when it counts Empathy\. .* Fits your strength: Caring Also important in this work/,
    );
    // Honesty and handling pressure aren't linked to any trait: never framed as something to build.
    expect(t).toMatch(/Also important in this work Sincerity\. Being genuine and honest with people\. Handling pressure\./);
    expect(t).not.toContain("Skills you can build");
    expect(html).toContain('href="/discover/personality"');
    // Handling pressure is never tied to how calm the student says they are.
    expect(t).not.toMatch(/Staying calm|Feels things deeply/);
  });

  it("calls styles linked to a student's low traits skills anyone can build, under a neutral heading", async () => {
    // Quiet and hands-on, direct and spontaneous: every career trait low.
    await signInStudent({ extraversion: 0, agreeableness: 25, conscientiousness: 25, neuroticism: 50, intellect: 25 });
    const t = text(await render());
    expect(t).toContain("Strengths that help in this work");
    expect(t).not.toMatch(/Where your strengths help|Your strengths that fit|Fits your strength/);
    expect(t).toMatch(
      /Skills you can build Anyone can grow these with practice, in class, on a team, in a club or at a job\. Adaptability\. .* Perseverance\. .* Empathy\. .* Also important in this work Sincerity\. .* Handling pressure\./,
    );
  });

  it("asks a student who hasn't taken personality to find their strengths", async () => {
    await signInStudent();
    const t = text(await render());
    expect(t).toContain("Strengths that help in this work");
    expect(t).toContain("Find your strengths to see which of these fit you (5 min)");
  });

  it("has no strengths section for a career without work styles", async () => {
    const t = text(await render("53-7062.00"));
    expect(t).not.toMatch(/Strengths that help|Where your strengths help/);
  });
});
