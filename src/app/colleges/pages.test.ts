import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CareerPage from "@/app/careers/[code]/page";
import { type Db, createTestDb } from "@/db";
import { cipSocLinks, majors, occupationInterests, occupations } from "@/db/schema";
import { insertColleges, insertMajorSearchData, insertPrograms } from "@/lib/colleges/test-fixtures";
import CollegePage, { generateMetadata } from "./[unitId]/page";
import CollegesPage from "./page";

// Server-rendered checks for the public college pages, with the database mocked.

const state = vi.hoisted(() => ({ db: null as Db | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: async () => null, requireUser: async () => null }));
// An async server component with its own tests (src/app/applications/pages.test.ts); these pages
// are rendered synchronously here.
vi.mock("@/components/add-to-list", () => ({ AddToListButton: () => null }));

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
    expect(lakeside).toContain("Graduation rate 60%");
    expect(lakeside).toContain("Earnings 10 years after starting $50,000 a year");
    expectCleanNumbers(html);
  });

  it("says a public college's prices are for in-state students", async () => {
    const words = text(await searchPage());
    // Cards are in name order: Canyon, then Lakeside.
    const canyon = words.slice(words.indexOf("Canyon Technical Institute"), words.indexOf("Lakeside State University"));
    const lakeside = words.slice(words.indexOf("Lakeside State University"), words.indexOf("What these numbers mean"));
    expect(lakeside).toContain("Average net price after grants, in-state $15,000 a year");
    expect(lakeside).toContain("After grants, in-state students paid about $9,000 to $21,000 a year");
    expect(lakeside).toContain("Sticker price before aid, in-state: $28,000 a year");
    expect(lakeside).toContain("Students from other states usually pay more at public colleges.");
    // Canyon is for-profit: its prices apply to everyone.
    expect(canyon).toContain("Average net price after grants $0 a year");
    expect(canyon).not.toMatch(/in-state|other states/);
  });

  it("notes that transfers count against a community college's graduation rate", async () => {
    await insertColleges(state.db!, [{ unitId: 4, name: "Mesa Community College", predominantDegree: 2, completionRate: 0.2 }]);
    const words = text(await searchPage());
    expect(words.slice(words.indexOf("Mesa Community College"))).toContain("Graduation rate 20% Students who transfer out count as not graduating.");
    // Only on the community college's card.
    expect(words.match(/Students who transfer out count as not graduating/g)).toHaveLength(1);
  });

  it("shows the range across income bands and asks to pick one, without a stored band", async () => {
    const words = text(await searchPage());
    expect(words).toContain("After grants, in-state students paid about $9,000 to $21,000 a year, depending on family income.");
    expect(words).toContain("Your family's yearly income (optional)");
    expect(words).toContain("Choose a range");
  });

  it("says exactly what happens to the income range: saved in this browser, never sent", async () => {
    const words = text(await searchPage());
    expect(words).toContain(
      "Your choice is saved only in this browser, so you don't have to pick it again. It's never sent to College Compass.",
    );
    expect(words).not.toContain("We never ask for");
    expect(text(await collegePage("1"))).toContain("Saved only in this browser. Never sent to us.");
  });

  it("searches by name or city, and says so", async () => {
    const html = await searchPage({ q: "austin" });
    // Lakeside State University is in Austin; its name doesn't say so.
    expect(text(html)).toContain("Lakeside State University");
    expect(text(html)).toContain("1 college");
    expect(text(html)).toContain("College name or city");
    expect(html).not.toContain("or a city");
  });

  it("finds names however they're punctuated, best match first by default", async () => {
    await insertColleges(state.db!, [
      { unitId: 4, name: "St Olaf College", state: "MN", control: 2 },
      { unitId: 5, name: "Lakeside State Beauty Academy", state: "TX", control: 3, enrollment: 90 },
    ]);
    const olaf = await searchPage({ q: "St. Olaf" });
    expect(text(olaf)).toContain("1 college");
    expect(olaf).toContain('href="/colleges/4"');
    expect(olaf).toMatch(/<option value="relevance" selected="">Best match<\/option>/);

    // The big university before the small academy, though A to Z puts the academy first.
    const lakeside = text(await searchPage({ q: "lakeside state" }));
    expect(lakeside.indexOf("Lakeside State University")).toBeLessThan(lakeside.indexOf("Lakeside State Beauty Academy"));
    const byName = await searchPage({ q: "lakeside state", sort: "name" });
    expect(text(byName).indexOf("Lakeside State Beauty Academy")).toBeLessThan(text(byName).indexOf("Lakeside State University"));
    expect(byName).toMatch(/<option value="name" selected="">Name \(A to Z\)<\/option>/);
  });

  it("takes searches and page links to the results, not the top of the form", async () => {
    const html = await searchPage({ state: "TX" });
    expect(html).toContain('action="/colleges#results"');
    expect(html).toMatch(/id="results"/);
    // "More filters" stays a list item so browsers draw its open/closed triangle.
    expect(html).toMatch(/<summary class="(?![^"]*\bflex\b)[^"]*">More filters/);
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
    expect(html).toContain('href="/colleges?major=51.39#results"');
    expect(html).toContain('href="/colleges?major=51.38#results"');
    expect(words).toContain("Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing Offered at 1 college nationwide.");
    expect(words).not.toContain("Lakeside State University");
  });

  it("finds trades by everyday words, showing the formal name colleges use", async () => {
    await insertMajorSearchData(state.db!, { "48.05": 3, "15.06": 2 });
    const words = text(await searchPage({ mq: "welding" }));
    expect(words).toContain("Precision Metal Working Includes Welding Technology/Welder. Offered at 3 colleges nationwide.");
    expect(words).toContain(
      "Industrial Production Technologies/Technicians Includes Welding Engineering Technology/Technician. Offered at 2 colleges nationwide.",
    );

    const welder = text(await searchPage({ mq: "welder" }));
    expect(welder).toContain("Precision Metal Working (includes Welding Technology/Welder)");
    expect(welder).toContain("3 colleges");
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
    expect(first).toContain('href="/colleges?state=OH&amp;page=2#results"');
    expect(first).toMatch(/aria-current="page"[^>]*>.*?1</);
    expect(first).not.toContain("Previous");

    const last = await searchPage({ state: "OH", page: "3" });
    expect(text(last)).toContain("Showing 41–45.");
    expect(text(last)).toContain("College 45");
    expect(last).toContain('href="/colleges?state=OH#results"');
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

  it("says a public college's net price and cost of attendance are for in-state students, with an out-of-state estimate", async () => {
    const words = text(await collegePage("110635"));
    expect(words).toContain("After grants, in-state students paid about $0 to $24,000 a year, depending on family income.");
    expect(words).toContain(
      "At public colleges, these prices are for students who live in the college's state. If you live in another state, you'll likely pay more.",
    );
    expect(words).toContain("Average net price for in-state students, all income ranges $15,000 a year");
    expect(words).toContain("Average net price per year for in-state students, by family income");
    expect(words).toContain("Cost of attendance, in-state $28,000 a year");
    // $28,000 plus the $15,000 more that out-of-state students pay in tuition.
    expect(words).toContain("Cost of attendance, out-of-state (estimate) $43,000 a year");

    const forProfit = text(await collegePage("2"));
    expect(forProfit).not.toMatch(/in-state students|out-of-state \(estimate\)|live in the college's state\. If/);
  });

  it("shows one tuition line when everyone pays the same tuition", async () => {
    await insertColleges(state.db!, [
      // Harvard, June 2026 release.
      { unitId: 3, name: "Harvard University", control: 2, costOfAttendance: 86_926, tuitionInState: 61_676, tuitionOutOfState: 61_676 },
      { unitId: 4, name: "Flat Rate State College", control: 1, tuitionInState: 7_000, tuitionOutOfState: 7_000 },
    ]);
    const harvard = text(await collegePage("3"));
    expect(harvard).toContain("Cost of attendance $86,926 a year Tuition and fees $61,676 a year");
    expect(harvard).not.toMatch(/Tuition and fees, (in|out-of)-state/);

    const flat = text(await collegePage("4"));
    expect(flat).toContain("Tuition and fees $7,000 a year");
    expect(flat).not.toContain("Public colleges charge less tuition");
    // A public college that charges more out of state keeps both lines and the note.
    expect(text(await collegePage("110635"))).toContain("Public colleges charge less tuition to students who live in their state.");
  });

  it("explains graduation rates and debt accurately", async () => {
    await insertColleges(state.db!, [{ unitId: 3, name: "Hill Country College", predominantDegree: 2, completionRate: 0.2 }]);
    const words = text(await collegePage("3"));
    expect(words).toContain("Graduation rate 20% Students who transfer out count as not graduating.");
    expect(words).toContain("Many community college students plan to transfer");
    expect(words).toContain("Typical federal loan debt $19,000 Typical (median) federal loan debt of graduates who took out federal loans.");
    expect(words).toContain("Students who didn't borrow aren't counted");
    expect(text(await collegePage("2"))).toContain("Graduation rate 60%");
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
    // Mostly a bachelor's college, so its bachelor's degrees come first.
    expect(words.indexOf("Bachelor's degrees (2 programs)")).toBeLessThan(words.indexOf("Associate degrees (1 program)"));
    expect(words).toContain("Undergraduate programs: 2 bachelor's degrees, 1 associate degree.");
    expect(words).toContain("Debt is the typical federal loan debt of graduates who took out federal loans.");
  });

  it("marks long program lists as a toggle that says whether it's open", async () => {
    await insertPrograms(
      state.db!,
      Array.from({ length: 11 }, (_, i) => ({ unitId: 110635, cip4: `30.${String(i + 10)}`, title: `Topic ${i}.`, credentialLevel: 1 })),
    );
    const html = await collegePage("110635");
    expect(html).toMatch(/<details class="group[^"]*"><summary class="(?![^"]*\bflex\b)[^"]*">/);
    expect(text(html)).toContain("Show all 11 programs Hide the list");
  });

  it("highlights the major a student searched for", async () => {
    const words = text(await collegePage("110635", { major: "51.38" }));
    expect(words).toContain("The major you searched for: Registered Nursing Bachelor's degree");
    expect(text(await collegePage("110635", { major: "junk" }))).not.toContain("The major you searched for");
  });

  it("explains missing data in plain words", async () => {
    const html = await collegePage("2");
    const words = text(html);
    expect(words).toContain("This college didn't report prices by family income.");
    expect(words).toContain("didn't report an average net price");
    expect(words).toContain("Search its website for “net price calculator”");
    expect(words).toContain("Admission rate Not reported No admission rate is listed.");
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
  const careerPage = (code: string) =>
    render(CareerPage({ params: Promise.resolve({ code }), searchParams: Promise.resolve({}) } as PageProps<"/careers/[code]">));

  async function insertCareer(code: string, title: string, jobZone: number, links: [string, string][]) {
    const db = state.db!;
    await db.insert(occupations).values({ code, title, description: "What the work is.", jobZone });
    await db.insert(occupationInterests).values([
      { occupationCode: code, interest: "I", score: 6 },
      { occupationCode: code, interest: "S", score: 5 },
    ]);
    if (!links.length) return;
    await db.insert(majors).values(links.map(([cipCode, t]) => ({ cipCode, title: t }))).onConflictDoNothing();
    await db.insert(cipSocLinks).values(links.map(([cipCode]) => ({ cipCode, socCode: code.slice(0, 7) })));
  }

  it("links each related major that colleges offer to a college search", async () => {
    await insertCareer("15-1252.00", "Software Developers", 4, [["11.0701", "Computer Science"]]);
    await insertColleges(state.db!, [{ unitId: 1, name: "Lakeside State University" }]);
    await insertPrograms(state.db!, [{ unitId: 1, cip4: "11.07", title: "Computer Science." }]);

    const html = await careerPage("15-1252.00");
    expect(html).toContain('href="/colleges?major=11.07"');
    expect(text(html)).toContain("Find colleges for Computer Science");
  });

  it("puts majors colleges offer first and never links to an empty search", async () => {
    // Physician Assistants: in the real crosswalk, the first 15 majors by title were all 60.09xx
    // residencies, each linking to a search with no colleges.
    await insertCareer("29-1071.00", "Physician Assistants", 5, [
      ["60.0901", "Physician Assistant Residency/Fellowship Program, General"],
      ["60.0902", "Cardiology Physician Assistant Residency/Fellowship Program"],
      ["51.0912", "Physician Assistant"],
      ["26.0102", "Biomedical Sciences, General"],
      ["30.4301", "Geobiology"],
    ]);
    await insertColleges(state.db!, [{ unitId: 1, name: "Lakeside State University" }]);
    await insertPrograms(state.db!, [
      { unitId: 1, cip4: "26.01", title: "Biology, General." },
      { unitId: 1, cip4: "51.09", title: "Allied Health Diagnostic, Intervention, and Treatment Professions." },
    ]);

    const html = await careerPage("29-1071.00");
    const words = text(html);
    expect(words).not.toContain("Residency");
    expect(words).toContain("Biomedical Sciences, General Find colleges for Biomedical Sciences, General Physician Assistant Studied after college Geobiology");
    expect(words).toContain("“Studied after college” means graduate or professional school");
    expect(html).toContain('href="/colleges?major=26.01"');
    // Physician assistant programs are master's programs, so no link to 51.09's EMT and other programs.
    expect(html).not.toContain("major=51.09");
    // No college offers geobiology (30.43), so no link.
    expect(html).not.toContain("major=30.43");
    expect(html).not.toMatch(/major=6[01]\./);
  });

  it("explains careers reached through training when no major leads there", async () => {
    await insertCareer("27-1023.00", "Floral Designers", 2, []);
    expect(text(await careerPage("27-1023.00"))).toContain("usually reached through training or experience");
  });
});
