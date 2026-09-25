import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CareerPage from "@/app/careers/[code]/page";
import { type Db, createTestDb, schema } from "@/db";
import { emptySavedAssessment } from "@/lib/assessments/anonymous";
import { INTEREST_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import type { SessionUser } from "@/lib/auth/sessions";
import { CareerList, Results, resultsHeading } from "./free-results";

// The free results page in the browser, and the way back to it from a career.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), redirect: () => {}, notFound: () => {} }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const answersWith = (answer: Partial<Record<Riasec, number>>) => Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, answer[i.area] ?? 1]));

afterEach(() => {
  state.db = null;
  state.user = null;
});

describe("free results", () => {
  it("only says 'Your direction, for now' above results", () => {
    const finished = { ...emptySavedAssessment(), answers: answersWith({ A: 5 }) };
    expect(resultsHeading(undefined)).toBe("Your direction, for now");
    expect(resultsHeading(finished)).toBe("Your direction, for now");
    // After "Take it again", or before finishing.
    expect(resultsHeading(null)).toBe("Your quiz results");
    expect(resultsHeading({ ...emptySavedAssessment(), answers: { R1: 3 } })).toBe("Your quiz results");
  });

  it("says no area stands out when every answer is the same, and offers to explore or take it again", () => {
    const html = renderToStaticMarkup(createElement(Results, { answers: answersWith({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 }), viewer: "visitor" }));
    const t = text(html);
    expect(t).toContain("No area stands out. You rated all six about the same");
    expect(t).not.toContain("Your code is");
    expect(t).toContain("take the quiz again and go with your gut on each activity");
    expect(t.match(/Take it again/g)?.length).toBeGreaterThanOrEqual(2);
    expect(hrefs(html)).toContain("/careers");
  });

  it("keeps the code for a clear profile", () => {
    const t = text(renderToStaticMarkup(createElement(Results, { answers: answersWith({ A: 5, S: 4, E: 3 }), viewer: "visitor" })));
    expect(t).toContain("Your code is ASE : Artistic, Social, Enterprising.");
    expect(t).not.toContain("No area stands out");
  });

  it("links each career with a way back here", () => {
    const html = renderToStaticMarkup(
      createElement(CareerList, {
        pathway: "degree",
        careers: [{ code: "27-1024.00", title: "Graphic Designers", pathway: "degree", fit: "Great fit", why: "Design." }],
      }),
    );
    expect(hrefs(html)).toEqual(["/careers/27-1024.00?from=quiz"]);
  });
});

describe("a career page's way back", () => {
  beforeEach(async () => {
    const db = await createTestDb();
    state.db = db;
    await db.insert(schema.occupations).values({ code: "27-1024.00", title: "Graphic Designers", description: "Design things.", jobZone: 4 });
    await db.insert(schema.occupationInterests).values([
      { occupationCode: "27-1024.00", interest: "A", score: 7 },
      { occupationCode: "27-1024.00", interest: "E", score: 3 },
    ]);
  });

  const careerLinks = async (search: Record<string, string>) => {
    const page = CareerPage({ params: Promise.resolve({ code: "27-1024.00" }), searchParams: Promise.resolve(search) } as PageProps<"/careers/[code]">);
    const html = renderToStaticMarkup((await page) as ReactNode);
    return [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  };

  it("goes back to the free results when opened from them, and still offers the search", async () => {
    const links = await careerLinks({ from: "quiz" });
    expect(links).toContainEqual(["/try/results", "Back to my results"]);
    expect(links).toContainEqual(["/careers", "Search more careers"]);
  });

  it("offers only the search to a visitor who came another way", async () => {
    const links = await careerLinks({});
    expect(links.map(([href]) => href)).not.toContain("/try/results");
    expect(links).toContainEqual(["/careers", "Search more careers"]);
  });

  it("sends a student back to their own results, with the search too", async () => {
    state.user = { id: crypto.randomUUID(), role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 10 };
    const links = await careerLinks({});
    expect(links).toContainEqual(["/discover/results", "Back to my results"]);
    expect(links).toContainEqual(["/careers", "Search more careers"]);
    expect(await careerLinks({ from: "quiz" })).toContainEqual(["/try/results", "Back to my results"]);
  });
});
