import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addNorthStarAction, removeNorthStarAction } from "@/app/actions/discover";
import CareerPage from "@/app/careers/[code]/page";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { emptySavedAssessment } from "@/lib/assessments/anonymous";
import { INTEREST_ITEMS, type Riasec } from "@/lib/assessments/instruments";
import type { SessionUser } from "@/lib/auth/sessions";
import { CareerList, Results, resultsHeading } from "./free-results";

// The free results page in the browser, and the way back to it from a career.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null, redirects: [] as string[] }));
vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  // The north star actions end with a redirect, so recording it is enough.
  redirect: (url: string) => {
    state.redirects.push(url);
  },
  notFound: () => {},
}));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const answersWith = (answer: Partial<Record<Riasec, number>>) => Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, answer[i.area] ?? 1]));

afterEach(() => {
  state.db = null;
  state.user = null;
  state.redirects = [];
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

  it("says no area stands out when every area leaned toward 'Dislike'", () => {
    const t = text(renderToStaticMarkup(createElement(Results, { answers: answersWith({ C: 2 }), viewer: "visitor" })));
    expect(t).toContain("No area stands out. Overall you leaned toward disliking all six");
    expect(t).not.toMatch(/Your code is|Conventional stands out/);
    expect(t).toContain("take the quiz again and go with your gut on each activity");
  });

  it("never ranks an area the visitor disliked as an interest", () => {
    // "Dislike" on every social activity: Social scored 10 of 40, and the code is "ASR".
    const t = text(renderToStaticMarkup(createElement(Results, { answers: answersWith({ A: 5, S: 2 }), viewer: "visitor" })));
    expect(t).toContain("Artistic stands out. You leaned toward disliking the other five areas.");
    expect(t).not.toMatch(/Your code is|No area stands out/);
  });

  it("keeps the code for a clear profile", () => {
    const t = text(renderToStaticMarkup(createElement(Results, { answers: answersWith({ A: 5, S: 4, E: 3 }), viewer: "visitor" })));
    expect(t).toContain("Your code is ASE : Artistic, Social, Enterprising.");
    expect(t).not.toContain("No area stands out");
  });

  it("links to browse more careers in each top interest area, and only those", () => {
    const html = renderToStaticMarkup(createElement(Results, { answers: answersWith({ A: 5, S: 2 }), viewer: "visitor" }));
    expect(text(html)).toContain("Want more ideas? Browse all the careers built around each of your top interests. Art, music and writing (Artistic)");
    expect(hrefs(html).filter((h) => h.startsWith("/careers?area="))).toEqual(["/careers?area=A#results"]);
    const flat = renderToStaticMarkup(createElement(Results, { answers: answersWith({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 }), viewer: "visitor" }));
    expect(text(flat)).not.toContain("Want more ideas?");
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

  const careerPage = async (search: Record<string, string>) => {
    const page = CareerPage({ params: Promise.resolve({ code: "27-1024.00" }), searchParams: Promise.resolve(search) } as PageProps<"/careers/[code]">);
    return renderToStaticMarkup((await page) as ReactNode);
  };
  const careerLinks = async (search: Record<string, string>) =>
    [...(await careerPage(search)).matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);

  async function signInStudent() {
    const res = await registerStudent(state.db!, {
      displayName: "Sam",
      email: "sam@example.com",
      password: "correct horse battery",
      birthDate: "2010-05-01",
      grade: 10,
    });
    if (!res.ok) throw new Error(res.error);
    state.user = { id: res.value.userId, role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 10 };
    return res.value.userId;
  }

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
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

  it("makes both links 44px tall", async () => {
    const html = await careerPage({ from: "quiz" });
    for (const label of ["Back to my results", "Search more careers"]) {
      const link = new RegExp(`<a[^>]*>${label}</a>`).exec(html)?.[0];
      expect(link, label).toMatch(/class="[^"]*\binline-flex\b[^"]*\bmin-h-11\b/);
    }
  });

  it("keeps the way back to the free results after a student stars or unstars the career", async () => {
    const userId = await signInStudent();
    expect(await careerPage({ from: "quiz" })).toContain('<input type="hidden" name="from" value="quiz"/>');
    expect(await careerPage({})).not.toContain('name="from"');

    await addNorthStarAction(form({ code: "27-1024.00", from: "quiz" }));
    await removeNorthStarAction(form({ code: "27-1024.00", from: "quiz" }));
    await addNorthStarAction(form({ code: "27-1024.00" }));
    await removeNorthStarAction(form({ code: "27-1024.00", from: "https://example.com" }));
    await removeNorthStarAction(form({ code: "27-1024.00", from: "quiz", back: "dashboard" }));
    expect(state.redirects).toEqual([
      "/careers/27-1024.00?starred=1&from=quiz",
      "/careers/27-1024.00?from=quiz",
      "/careers/27-1024.00?starred=1",
      "/careers/27-1024.00",
      "/dashboard",
    ]);

    // At the limit, the notice and the way back both survive.
    await state.db!.insert(schema.northStarGoals).values([
      { userId, occupationCode: "11-1011.00", title: "Chief Executives" },
      { userId, occupationCode: "15-1252.00", title: "Software Developers" },
    ]);
    state.redirects = [];
    await addNorthStarAction(form({ code: "27-1024.00", from: "quiz" }));
    expect(state.redirects).toEqual(["/careers/27-1024.00?limit=1&from=quiz"]);
  });

  it("sends a student back to their own results, with the search too", async () => {
    state.user = { id: crypto.randomUUID(), role: "student", displayName: "Sam", username: null, householdId: null, parentManaged: false, grade: 10 };
    const links = await careerLinks({});
    expect(links).toContainEqual(["/discover/results", "Back to my results"]);
    expect(links).toContainEqual(["/careers", "Search more careers"]);
    expect(await careerLinks({ from: "quiz" })).toContainEqual(["/try/results", "Back to my results"]);
  });
});
