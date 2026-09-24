import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CareerPage from "@/app/careers/[code]/page";
import { type Db, createTestDb } from "@/db";
import { cipSocLinks, majors, occupationInterests, occupations } from "@/db/schema";
import { insertColleges, insertPrograms } from "@/lib/colleges/test-fixtures";
import CollegePage, { generateMetadata } from "./[unitId]/page";
import CollegesPage from "./page";

// Server-rendered checks for the public college pages, with the database mocked.

const state = vi.hoisted(() => ({ db: null as Db | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: async () => null, requireUser: async () => null }));

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);

const searchPage = (params: Record<string, string> = {}) =>
  render(CollegesPage({ searchParams: Promise.resolve(params) } as PageProps<"/colleges">));
const collegePage = (unitId: string, params: Record<string, string> = {}) =>
  render(
    CollegePage({ params: Promise.resolve({ unitId }), searchParams: Promise.resolve(params) } as PageProps<"/colleges/[unitId]">),
  );

/** Never show raw missing-data markers or a negative price. */
function expectCleanNumbers(html: string) {
  const words = text(html);
  expect(words).not.toMatch(/\bnull\b|\bNaN\b|\bundefined\b|\bPS\b|-\$|\$-/);
}

afterEach(() => {
  state.db = null;
});

beforeEach(async () => {
  state.db = await createTestDb();
});

describe("/colleges search page", () => {
  beforeEach(async () => {
    await insertColleges(state.db!, [
      { unitId: 1, name: "Lakeside State University", city: "Austin", state: "TX", enrollment: 22_000 },
      {
        unitId: 2,
        name: "Canyon Technical Institute",
        state: "AZ",
        control: 3,
        predominantDegree: 1,
        avgNetPrice: -1_200,
        costOfAttendance: null,
        completionRate: null,
        medianEarnings10yr: null,
        netPriceByIncome: null,
        enrollment: null,
      },
      { unitId: 3, name: "Anywhere Online University", onlineOnly: true },
    ]);
    await insertPrograms(state.db!, [
      { unitId: 1, cip4: "11.07", title: "Computer Science." },
      { unitId: 1, cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing." },
      { unitId: 2, cip4: "51.39", title: "Practical Nursing, Vocational Nursing and Nursing Assistants.", credentialLevel: 1 },
    ]);
  });

  it("shows result cards with net price before the sticker price", async () => {
    const html = await searchPage();
    const words = text(html);
    expect(words).toContain("2 colleges");
    expect(words).not.toContain("Anywhere Online University");
    expect(html).toContain('href="/colleges/1"');

    const lakeside = words.slice(words.indexOf("Lakeside State University"));
    expect(lakeside).toContain("Austin, TX · Public · Large (22,000 undergraduates) · Mostly bachelor's degrees");
    expect(lakeside.indexOf("Average net price")).toBeLessThan(lakeside.indexOf("Sticker price"));
    expect(lakeside).toContain("$15,000 a year");
    expect(lakeside).toContain("Sticker price before aid: $28,000 a year");
    expect(lakeside).toContain("Graduation rate 60%");
    expect(lakeside).toContain("Earnings 10 years after starting $50,000 a year");
    expectCleanNumbers(html);
  });

  it("shows the range across income bands and asks to pick one, without a stored band", async () => {
    const words = text(await searchPage());
    expect(words).toContain("After grants, students paid about $9,000 to $21,000 a year, depending on family income.");
    expect(words).toContain("Your family's yearly income (optional)");
    expect(words).toContain("Choose a range");
  });

  it("shows $0 when aid exceeds the cost, plain words for missing data, and a for-profit note", async () => {
    const words = text(await searchPage({ q: "canyon" }));
    expect(words).toContain("$0 a year");
    expect(words).toContain("grants and scholarships were more than the cost");
    expect(words).toContain("Sticker price before aid: not reported");
    expect(words).toContain("Graduation rate Not reported");
    expect(words).toContain("compare its graduation rate, earnings and debt");
    expect(text(await searchPage({ q: "lakeside" }))).not.toContain("for-profit college");
  });

  it("never puts family income in the search form or links", async () => {
    const html = await searchPage({ state: "TX" });
    const form = /<form[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
    expect(form).toContain('name="q"');
    expect(form).not.toMatch(/income|0-30000|110001-plus/i);
    // The income picker has no name, so it can never be submitted.
    expect(html).not.toMatch(/<select[^>]*name="[^"]*income/i);
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) expect(href).not.toMatch(/income|band|30000/i);
  });

  it("includes online-only colleges only when asked", async () => {
    expect(text(await searchPage({ online: "1" }))).toContain("Anywhere Online University");
  });

  it("shows a chosen major as a removable chip and keeps it on result links", async () => {
    const html = await searchPage({ major: "11.07", state: "TX" });
    const words = text(html);
    expect(words).toContain("Computer Science");
    expect(words).toContain("Remove major: Computer Science");
    expect(html).toContain('type="hidden" name="major" value="11.07"');
    expect(html).toContain('href="/colleges?state=TX"');
    expect(html).toContain('href="/colleges/1?major=11.07"');
    expect(words).toContain("1 college");
  });

  it("asks which major when typed words match several", async () => {
    const html = await searchPage({ mq: "nursing" });
    const words = text(html);
    expect(words).toContain("Which major do you mean?");
    expect(html).toContain('href="/colleges?major=51.39"');
    expect(html).toContain('href="/colleges?major=51.38"');
    expect(words).not.toContain("Lakeside State University");
  });

  it("uses the only matching major directly", async () => {
    const html = await searchPage({ mq: "computer" });
    expect(text(html)).toContain("Remove major: Computer Science");
    expect(html).toContain('href="/colleges/1?major=11.07"');
  });

  it("explains when no major matches and searches every major", async () => {
    const words = text(await searchPage({ mq: "astronomy" }));
    expect(words).toContain("We couldn't find a major matching “astronomy”");
    expect(words).toContain("2 colleges");
  });

  it("shows an empty state with tips", async () => {
    const html = await searchPage({ q: "zzz", state: "TX" });
    const words = text(html);
    expect(words).toContain("No colleges found");
    expect(words).toContain("Check the spelling");
    expect(words).toContain("Try a nearby state");
    expect(html).toContain('href="/colleges"');
    expect(html).not.toContain("Pages of results");
  });

  it("explains the numbers and credits the data source", async () => {
    const words = text(await searchPage());
    expect(words).toContain("What these numbers mean");
    expect(words).toContain("average for students who got federal financial aid");
    expect(words).toContain("net price calculator gives you a personal estimate");
    expect(words).toContain("Data: College Scorecard , U.S. Department of Education (June 2026 data release)");
  });
});

describe("/colleges pagination", () => {
  it("links to other pages and marks the current one", async () => {
    await insertColleges(
      state.db!,
      Array.from({ length: 45 }, (_, i) => ({ unitId: 1000 + i, name: `College ${String(i + 1).padStart(2, "0")}`, state: "OH" })),
    );
    const first = await searchPage({ state: "OH" });
    expect(text(first)).toContain("45 colleges");
    expect(text(first)).toContain("Showing 1–20.");
    expect(first).toContain('href="/colleges?state=OH&amp;page=2"');
    expect(first).toMatch(/aria-current="page"[^>]*>.*?1</);
    expect(first).not.toContain("Previous");

    const last = await searchPage({ state: "OH", page: "3" });
    expect(text(last)).toContain("Showing 41–45.");
    expect(text(last)).toContain("College 45");
    expect(last).toContain('href="/colleges?state=OH"');
    expect(last).not.toMatch(/rel="next"/);
  });
});

describe("/colleges/[unitId] detail page", () => {
  beforeEach(async () => {
    await insertColleges(state.db!, [
      {
        unitId: 110635,
        name: "Lakeside State University",
        city: "Austin",
        state: "TX",
        url: "www.lakeside.edu",
        netPriceCalculatorUrl: "https://lakeside.edu/npc",
        netPriceByIncome: { "0-30000": -800, "30001-48000": 8_200, "110001-plus": 24_000 },
        admissionRate: 0.82,
        hispanicServing: true,
      },
      { unitId: 2, name: "Quiet College", netPriceCalculatorUrl: null, url: null, avgNetPrice: null, netPriceByIncome: null, admissionRate: null, control: 3 },
    ]);
    await insertPrograms(state.db!, [
      { unitId: 110635, cip4: "51.38", title: "Registered Nursing.", credentialLevel: 3, medianEarnings4yr: 72_000, medianDebt: 24_000 },
      { unitId: 110635, cip4: "51.38", title: "Registered Nursing.", credentialLevel: 2, medianEarnings4yr: 61_000, medianDebt: null },
      { unitId: 110635, cip4: "11.07", title: "Computer Science.", credentialLevel: 3 },
    ]);
  });

  it("shows net price first, then sticker price and outcomes", async () => {
    const html = await collegePage("110635");
    const words = text(html);
    expect(words).toContain("Lakeside State University");
    expect(words).toContain("Austin, Texas · Public · Mostly bachelor's degrees");
    const net = words.indexOf("Net price: what students paid");
    const sticker = words.indexOf("Sticker price: the full price before aid");
    expect(net).toBeGreaterThan(-1);
    expect(net).toBeLessThan(sticker);
    expect(sticker).toBeLessThan(words.indexOf("Graduation, earnings and debt"));
    expect(words).toContain("After grants, students paid about $0 to $24,000 a year, depending on family income.");
    expect(words).toContain("Average net price, all income ranges $15,000 a year");
    expect(words).toContain("Cost of attendance $28,000 a year");
    expect(words).toContain("Tuition and fees, in-state $10,000 a year");
    expect(words).toContain("Tuition and fees, out-of-state $25,000 a year");
    expect(words).toContain("Earnings 10 years after starting $50,000 a year");
    expect(words).toContain("Typical federal loan debt $19,000");
    expect(words).toContain("Students with a Pell Grant 35%");
    expect(words).toContain("Size Medium (8,000 undergraduates)");
    expect(words).toContain("Admission rate 82% Like most colleges, this one admits most of the students who apply.");
    expect(words).toContain("Hispanic-serving institution");
    expectCleanNumbers(html);
  });

  it("lists every income band, showing $0 when aid exceeds the cost and explaining gaps", async () => {
    const words = text(await collegePage("110635"));
    expect(words).toContain("$0–$30,000 $0 Aid was more than the cost");
    expect(words).toContain("$30,001–$48,000 $8,200");
    expect(words).toContain("$48,001–$75,000 Not reported");
    expect(words).toContain("too few students in that income range got federal aid");
    expect(words).toContain("Pick your family's income range below");
  });

  it("links to the net price calculator, website and College Scorecard in new tabs", async () => {
    const html = await collegePage("110635");
    expect(html).toMatch(/<a href="https:\/\/lakeside.edu\/npc" target="_blank" rel="noopener noreferrer"[^>]*>Get your own estimate/);
    expect(html).toContain('href="https://www.lakeside.edu/" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="https://collegescorecard.ed.gov/school/?110635" target="_blank" rel="noopener noreferrer"');
    expect(text(html)).toContain("Data: College Scorecard , U.S. Department of Education (June 2026 data release)");
  });

  it("groups programs by credential with earnings and debt, or a plain note when missing", async () => {
    const words = text(await collegePage("110635"));
    expect(words).toContain("Associate degrees (1 program) Registered Nursing Earnings 4 years after finishing $61,000 a year");
    expect(words).toContain("Typical federal loan debt Not enough graduates to report");
    expect(words).toContain("Bachelor's degrees (2 programs) Computer Science Not enough graduates to report.");
    expect(words).toContain("Undergraduate programs: 1 associate degree, 2 bachelor's degrees.");
  });

  it("highlights the major a student searched for", async () => {
    const words = text(await collegePage("110635", { major: "51.38" }));
    expect(words).toContain("The major you searched for: Registered Nursing Associate degree");
    expect(text(await collegePage("110635", { major: "junk" }))).not.toContain("The major you searched for");
  });

  it("explains missing data in plain words", async () => {
    const html = await collegePage("2");
    const words = text(html);
    expect(words).toContain("This college didn't report prices by family income.");
    expect(words).toContain("didn't report an average net price");
    expect(words).toContain("Search its website for “net price calculator”");
    expect(words).toContain("Admission rate Not reported");
    expect(words).toContain("open admission");
    expect(words).toContain("programs aren't in the College Scorecard data yet");
    expect(words).toContain("This is a for-profit college.");
    expect(html).not.toContain("Get your own estimate");
    expectCleanNumbers(html);
  });

  it("is not found for unknown or non-numeric ids", async () => {
    for (const id of ["999999", "abc", "0", "12abc", "-5", "1e5"]) {
      await expect(collegePage(id)).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    }
  });

  it("titles the page with the college's name", async () => {
    const meta = (unitId: string) => generateMetadata({ params: Promise.resolve({ unitId }) } as PageProps<"/colleges/[unitId]">);
    expect((await meta("110635")).title).toBe("Lakeside State University");
    expect((await meta("abc")).title).toBe("College not found");
  });
});

describe("/careers/[code] college links", () => {
  it("links each related major to a college search", async () => {
    const db = state.db!;
    await db.insert(occupations).values({ code: "15-1252.00", title: "Software Developers", description: "Build software.", jobZone: 4 });
    await db.insert(occupationInterests).values([
      { occupationCode: "15-1252.00", interest: "I", score: 6 },
      { occupationCode: "15-1252.00", interest: "C", score: 5 },
    ]);
    await db.insert(majors).values([{ cipCode: "11.0701", title: "Computer Science" }]);
    await db.insert(cipSocLinks).values([{ cipCode: "11.0701", socCode: "15-1252" }]);

    const html = await render(
      CareerPage({ params: Promise.resolve({ code: "15-1252.00" }), searchParams: Promise.resolve({}) } as PageProps<"/careers/[code]">),
    );
    expect(html).toContain('href="/colleges?major=11.07"');
    expect(text(html)).toContain("Find colleges for Computer Science");
  });
});
