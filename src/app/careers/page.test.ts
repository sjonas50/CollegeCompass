import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb } from "@/db";
import { occupationInterests, occupations } from "@/db/schema";
import { RIASEC, type Riasec } from "@/lib/assessments/instruments";
import { CAREER_PAGE_SIZE } from "@/lib/careers-search";
import { withLeadInterests } from "@/lib/reference/parsers";
import CareersPage, { generateMetadata } from "./page";

// Server-rendered checks for career search and browsing, with the database mocked.

const state = vi.hoisted(() => ({ db: null as Db | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
/** Where the links marked as the current page lead. */
const currentPageLinks = (html: string) => [...html.matchAll(/<a aria-current="page"[^>]*href="([^"]*)"/g)].map((m) => m[1]);
const searchPage = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await CareersPage({ searchParams: Promise.resolve(params) } as PageProps<"/careers">));

beforeEach(async () => {
  state.db = await createTestDb();
  await state.db.insert(occupations).values([
    ...Array.from({ length: 30 }, (_, i) => ({
      code: `25-${String(1100 + i)}.00`,
      title: `Subject ${String(i + 1).padStart(2, "0")} Teachers, Postsecondary`,
      description: "What the work is.",
      jobZone: 5,
    })),
    { code: "25-2022.00", title: "Middle School Teachers, Except Special and Career/Technical Education", description: "Teach.", jobZone: 4 },
    { code: "29-1141.00", title: "Registered Nurses", description: "Care for patients.", jobZone: 3 },
  ]);
});

afterEach(() => {
  state.db = null;
});

describe("/careers search", () => {
  it("says how many careers match and links to every page of them", async () => {
    const html = await searchPage({ q: "teacher" });
    const words = text(html);
    // The old search stopped at 30 without saying so.
    expect(words).toContain("31 careers match “teacher”");
    expect(words).toContain(`Titles that match your words most closely come first. Showing 1–${CAREER_PAGE_SIZE}.`);
    expect(words).not.toContain("Best matches first");
    expect(words).toContain("Add another word to narrow the list");
    // Middle school teachers before the college teaching jobs, though all match "teacher" as closely.
    expect(words).toMatch(/Middle School Teachers, Except Special and Career\/Technical Education Considerable preparation Subject 01 Teachers, Postsecondary/);
    expect(html).toContain('href="/careers?q=teacher&amp;page=2#results"');
    expect(html.match(/href="\/careers\/25-/g)).toHaveLength(CAREER_PAGE_SIZE);

    const last = await searchPage({ q: "teacher", page: "2" });
    expect(text(last)).toContain("Showing 26–31.");
    expect(text(last)).toContain("Subject 30 Teachers, Postsecondary");
    expect(last).toContain('href="/careers?q=teacher#results"');
  });

  it("lists a short result without page links", async () => {
    const html = await searchPage({ q: "nurse" });
    expect(text(html)).toContain("1 career matches “nurse”");
    expect(html).toContain('href="/careers/29-1141.00"');
    expect(html).not.toContain("Pages of results");
    expect(text(html)).not.toContain("Showing");
  });

  it("suggests a word for the person who does the job when nothing matches", async () => {
    const words = text(await searchPage({ q: "biology" }));
    expect(words).toContain("No careers found");
    expect(words).toContain("like “biologist” instead of “biology”");
    expect(words).not.toContain("Try a shorter word");
  });

  it("links to browsing by interest area from every results page", async () => {
    for (const q of ["teacher", "nurse", "biology"]) {
      const html = await searchPage({ q });
      expect(html).toContain('href="/careers#browse"');
      expect(text(html)).toContain("Browse careers by interest area");
    }
  });

  it("shows the search box and the interest areas before a search", async () => {
    const html = await searchPage();
    expect(html).toContain('name="q"');
    expect(html).not.toContain('id="results"');
    expect(html).toContain('id="browse"');
  });
});

describe("/careers browse by interest area", () => {
  beforeEach(async () => {
    // 30 college teaching jobs lead with Social, the nurses with Social and Investigative (tied).
    await state.db!.insert(occupationInterests).values(
      withLeadInterests([
        ...Array.from({ length: 30 }, (_, i) => `25-${String(1100 + i)}.00`).flatMap((code) => scores(code, { S: 6, I: 5 })),
        ...scores("25-2022.00", { S: 7, A: 4 }),
        ...scores("29-1141.00", { S: 6, I: 6, R: 4 }),
      ]),
    );
  });

  const scores = (code: string, s: Partial<Record<Riasec, number>>) =>
    RIASEC.map((interest) => ({ occupationCode: code, interest, score: s[interest] ?? 1 }));

  it("lists the six areas by plain name, with their RIASEC names and how many careers each has", async () => {
    const html = await searchPage();
    const words = text(html);
    expect(words).toContain("Browse by interest area");
    expect(words).toContain("Building and fixing things Realistic · 0 careers");
    expect(words).toContain("Helping and teaching people Social · 32 careers");
    expect(words).toContain("Science and solving problems Investigative · 1 career ");
    for (const area of RIASEC) expect(html).toContain(`href="/careers?area=${area}#results"`);
  });

  it("lists an area's careers A to Z with college teaching jobs last, in pages, with the level to pick", async () => {
    const html = await searchPage({ area: "S" });
    const words = text(html);
    expect(words).toContain("Helping and teaching people (Social)");
    expect(words).toContain("32 careers have this as their top interest area");
    expect(words).toContain(`Showing 1–${CAREER_PAGE_SIZE} of 32. Listed A to Z, with college teaching jobs last.`);
    expect(words).toMatch(/Middle School Teachers, Except Special and Career\/Technical Education Considerable preparation Registered Nurses Medium preparation Subject 01 Teachers, Postsecondary/);
    expect(html.match(/href="\/careers\/[^"]+"/g)).toHaveLength(CAREER_PAGE_SIZE);
    // Page links land on the list, level links on the levels.
    expect(html).toContain('href="/careers?area=S&amp;page=2#list"');
    expect(html).toContain('id="list"');
    // Each area chip names the area as the results pages do, by RIASEC name too.
    for (const chip of ["Building and fixing things (Realistic)", "Science and solving problems (Investigative)", "Keeping things organized (Conventional)"]) {
      expect(words).toContain(chip);
    }
    // The area and the level shown are marked as chosen ("true"), and only the page number as the
    // current page, so screen readers hear one current page.
    expect(html).toMatch(
      /<a aria-current="true"[^>]*href="\/careers\?area=S#results"><span>Helping and teaching people <span[^>]*>\(Social\)<\/span><\/span><\/a>/,
    );
    expect(html).toMatch(/<a aria-current="true"[^>]*href="\/careers\?area=S#levels">Any amount/);
    expect(html.match(/aria-current="true"/g)).toHaveLength(2);
    expect(currentPageLinks(html)).toEqual(["/careers?area=S#list"]);
    // Screen readers hear "careers" after each count.
    expect(words).toContain("Any amount (32 careers )");
    expect(words).toContain("Medium preparation (1 career )");
    expect(words).toContain("Extensive preparation (30 careers )");
    expect(html).toContain('href="/careers?area=S&amp;level=5#levels"');
    expect(html).toContain('id="levels"');
  });

  it("shows one level, and keeps it on the page links", async () => {
    const html = await searchPage({ area: "s", level: "5", page: "2" });
    const words = text(html);
    expect(words).toContain("Extensive preparation: Usually a graduate degree");
    expect(words).toContain("Showing 26–30 of 30.");
    expect(html).toContain('href="/careers?area=S&amp;level=5#list"');
    expect(html).toMatch(/aria-current="true"[^>]*>Extensive preparation/);
    expect(html).toMatch(/aria-current="true"[^>]*href="\/careers\?area=S#results"/);
    expect(currentPageLinks(html)).toEqual(["/careers?area=S&amp;level=5&amp;page=2#list"]);
    expect(words).not.toContain("Registered Nurses");
  });

  it("says so when no career in the area needs that level", async () => {
    const words = text(await searchPage({ area: "S", level: "2" }));
    expect(words).toContain("No careers in this area usually need some preparation. See every level");
  });

  it("lists a career tied between two areas in both", async () => {
    expect(text(await searchPage({ area: "I" }))).toContain("Registered Nurses");
    expect(text(await searchPage({ area: "S" }))).toContain("Registered Nurses");
  });

  it("searches when there are words to search for, and shows the areas for an unknown one", async () => {
    expect(text(await searchPage({ q: "nurse", area: "S" }))).toContain("1 career matches “nurse”");
    const unknown = await searchPage({ area: "Z" });
    expect(unknown).toContain('id="browse"');
    expect(unknown).not.toContain('id="results"');
  });

  it("names the area in the page title", async () => {
    const title = async (params: Record<string, string>) =>
      (await generateMetadata({ searchParams: Promise.resolve(params) } as PageProps<"/careers">)).title;
    expect(await title({ area: "R" })).toBe("Careers: Building and fixing things");
    expect(await title({})).toBe("Explore careers");
    expect(await title({ q: "nurse", area: "R" })).toBe("Explore careers");
  });
});
