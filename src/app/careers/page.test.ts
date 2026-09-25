import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, createTestDb } from "@/db";
import { occupations } from "@/db/schema";
import { CAREER_PAGE_SIZE } from "@/lib/careers-search";
import CareersPage from "./page";

// Server-rendered checks for career search, with the database mocked.

const state = vi.hoisted(() => ({ db: null as Db | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
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
    expect(words).toContain(`Showing 1–${CAREER_PAGE_SIZE}.`);
    expect(words).toContain("Add another word to narrow the list");
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

  it("shows only the search box before a search", async () => {
    const html = await searchPage();
    expect(html).toContain('name="q"');
    expect(html).not.toContain('id="results"');
  });
});
