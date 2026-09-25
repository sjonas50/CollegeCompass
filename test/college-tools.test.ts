import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { listSections } from "@/lib/aid-guide";
import { insertColleges, insertMajorSearchData, insertPrograms } from "@/lib/colleges/test-fixtures";
import { collegeTools } from "@/lib/counselor/college-tools";
import { counselorExtraTools } from "@/lib/counselor/extra-tools";

const now = new Date("2026-10-05T12:00:00Z");
let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await insertColleges(db, [
    { unitId: 1001, name: "Prairie State University", state: "IL", avgNetPrice: 14_000 },
    { unitId: 1002, name: "Lakeside Community College", state: "IL", predominantDegree: 2, avgNetPrice: -500, netPriceByIncome: { "0-30000": -1_200 } },
    { unitId: 1003, name: "Gulf Coast University", state: "TX", avgNetPrice: 9_000 },
  ]);
  await insertPrograms(db, [
    { unitId: 1001, cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing.", medianEarnings4yr: 78_000, medianDebt: 23_000 },
    { unitId: 1002, cip4: "51.38", title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing.", credentialLevel: 2 },
    { unitId: 1003, cip4: "11.07", title: "Computer Science." },
  ]);
});

async function run(name: string, input: object) {
  const tool = collegeTools(db).find((t) => t.name === name)!;
  return JSON.parse(String(await tool.run(input as never)));
}

describe("counselor college tools", () => {
  it("finds colleges by a major in plain words and state, cheapest first, with $0 for negative prices", async () => {
    const out = await run("search_colleges", { major: "registered nursing", state: "Illinois" });
    expect(out.major).toMatchObject({ cip4: "51.38", title: expect.stringMatching(/^Registered Nursing/) });
    expect(out.results.map((r: { name: string }) => r.name)).toEqual(["Lakeside Community College", "Prairie State University"]);
    expect(out.results[0]).toMatchObject({ netPriceAverage: 0, page: "/colleges/1002" });
    expect(out.results[0].netPriceByIncome["0-30000"]).toBe(0);
    expect(out.moreResults).toBe("/colleges?state=IL&major=51.38&sort=net_price");
    // Every result is public, so the tool says their prices are in-state; transfers lower completion rates.
    expect(out.notes.join(" ")).toMatch(/students who live in the college's state/);
    expect(out.notes.join(" ")).toMatch(/transfer/);
  });

  it("explains a bad state and an unknown major instead of guessing", async () => {
    expect((await run("search_colleges", { state: "Narnia" })).error).toMatch(/state/i);
    expect((await run("search_colleges", { major: "underwater basket weaving" })).note).toMatch(/No college programs/);
  });

  it("returns one college's costs, outcomes and programs, optionally for one major", async () => {
    const out = await run("get_college", { unitId: 1001, major: "51.38" });
    expect(out).toMatchObject({ name: "Prairie State University", netPriceAverage: 14_000, completionRatePercent: 60, page: "/colleges/1001" });
    expect(out.programs).toEqual([
      {
        credential: "Bachelor's degree",
        title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing",
        cip4: "51.38",
        medianEarnings4yr: 78_000,
        medianDebtOfBorrowers: 23_000,
      },
    ]);
    expect(out).not.toHaveProperty("allPrograms");
    expect((await run("get_college", { unitId: 999999 })).error).toBeTruthy();
  });

  it("gives public colleges' prices as in-state, with an out-of-state estimate", async () => {
    const out = await run("get_college", { unitId: 1001 });
    // The fixture: $28,000 cost of attendance, $10,000 in-state and $25,000 out-of-state tuition.
    expect(out).toMatchObject({ costOfAttendance: 28_000, costOfAttendanceOutOfStateEstimate: 43_000 });
    expect(out.notes[0]).toMatch(/for students who live in the college's state/);
    expect(out.notes.join(" ")).toMatch(/Students who didn't borrow aren't counted/);
  });

  it("reads the aid guide by section, with the page to link", async () => {
    const [first] = listSections("en");
    expect((await run("get_aid_guide", {})).sections.length).toBeGreaterThan(0);
    const out = await run("get_aid_guide", { section: first.id });
    expect(out).toMatchObject({ title: first.title, page: `/aid/en/${first.id}` });
    expect(out.text.length).toBeGreaterThan(50);
    expect((await run("get_aid_guide", { section: first.id, language: "es" })).page).toBe(`/aid/es/${first.id}`);
  });
});

describe("college tools with real major names", () => {
  beforeEach(async () => {
    // Offering College 1–10 offer welding (48.05) and so on, as in the real data but scaled down.
    await insertMajorSearchData(db, { "48.05": 10, "15.06": 6, "46.03": 7, "51.06": 8, "11.01": 16, "11.07": 10, "51.38": 12, "51.39": 9 });
  });

  it("finds trades and careers by everyday words and by get_career's 6-digit codes", async () => {
    const electrician = await run("search_colleges", { major: "electrician" });
    expect(electrician).toMatchObject({ total: 7, major: { cip4: "46.03", includes: "Electrician" } });
    expect((await run("search_colleges", { major: "dental hygiene" })).major).toMatchObject({ cip4: "51.06" });
    expect(await run("search_colleges", { major: "48.0508" })).toMatchObject({ total: 10, major: { cip4: "48.05", title: "Precision Metal Working" } });
    expect((await run("search_colleges", { major: "Welding Technology/Welder" })).major.cip4).toBe("48.05");
  });

  it("offers the most widely offered families to choose from, with college counts", async () => {
    const welding = await run("search_colleges", { major: "welding" });
    expect(welding.choices).toEqual([
      { cip4: "48.05", title: "Precision Metal Working", colleges: 10, includes: "Welding Technology/Welder" },
      { cip4: "15.06", title: "Industrial Production Technologies/Technicians", colleges: 6, includes: "Welding Engineering Technology/Technician" },
    ]);
    expect(welding.moreChoices).toBe(false);
    const nursing = await run("search_colleges", { major: "nursing" });
    expect(nursing.choices.map((c: { cip4: string }) => c.cip4)).toEqual(["51.38", "51.39"]);
  });

  it("looks a college up by name, best match first unless asked to sort", async () => {
    // Real College Scorecard names (June 2026); the beauty and barber schools cost less.
    await insertColleges(db, [
      { unitId: 2001, name: "Ohio State Beauty Academy", city: "Lima", state: "OH", control: 3, enrollment: 91, avgNetPrice: 9_000 },
      { unitId: 2002, name: "Ohio State College of Barber Styling", city: "Columbus", state: "OH", control: 3, enrollment: 406, avgNetPrice: 12_000 },
      { unitId: 2003, name: "Ohio State University-Main Campus", city: "Columbus", state: "OH", enrollment: 45_638, avgNetPrice: 20_000 },
      { unitId: 2004, name: "Paul Mitchell the School-Costa Mesa", city: "Costa Mesa", state: "CA", control: 3, enrollment: 395, avgNetPrice: 8_000 },
      { unitId: 2005, name: "Massachusetts Institute of Technology", city: "Cambridge", state: "MA", control: 2, enrollment: 4_535, avgNetPrice: 21_000 },
    ]);
    const names = (out: { results: { name: string }[] }) => out.results.map((r) => r.name);

    // Before: Ohio State Beauty Academy first, sorted by net price.
    const ohioState = await run("search_colleges", { name: "Ohio State" });
    expect(names(ohioState)).toEqual(["Ohio State University-Main Campus", "Ohio State College of Barber Styling", "Ohio State Beauty Academy"]);
    expect(ohioState.moreResults).toBe("/colleges?q=Ohio+State");
    expect(names(await run("search_colleges", { name: "MIT" }))[0]).toBe("Massachusetts Institute of Technology");

    const cheapest = await run("search_colleges", { name: "Ohio State", sort: "net_price" });
    expect(names(cheapest)[0]).toBe("Ohio State Beauty Academy");
    expect(cheapest.moreResults).toBe("/colleges?q=Ohio+State&sort=net_price");
  });

  it("searches by city", async () => {
    await insertColleges(db, [{ unitId: 1004, name: "Huston-Tillotson University", city: "Austin", state: "TX" }]);
    const out = await run("search_colleges", { name: "Austin" });
    expect(out.results.map((r: { name: string }) => r.name)).toEqual(["Huston-Tillotson University"]);
  });

  it("lists a college's programs with its main credential first, and finds a major by plain words", async () => {
    // A university with more certificates than the tool lists, plus two computer science families.
    await insertColleges(db, [{ unitId: 2001, name: "Big State University", predominantDegree: 3 }]);
    await insertPrograms(db, [
      ...Array.from({ length: 70 }, (_, i) => ({ unitId: 2001, cip4: `30.${String(i + 10)}`, title: `Certificate Topic ${i}.`, credentialLevel: 1 })),
      { unitId: 2001, cip4: "11.07", title: "Computer Science.", credentialLevel: 3, medianEarnings4yr: 81_000 },
      { unitId: 2001, cip4: "11.01", title: "Computer and Information Sciences, General.", credentialLevel: 2 },
      { unitId: 2001, cip4: "52.02", title: "Business Administration, Management and Operations.", credentialLevel: 3 },
    ]);

    const all = await run("get_college", { unitId: 2001 });
    expect(all).not.toHaveProperty("programs");
    expect(all.allPrograms.map((g: { credential: string; count: number }) => [g.credential, g.count])).toEqual([
      ["Bachelor's degrees", 2],
      ["Associate degrees", 1],
      ["Certificates", 70],
    ]);
    expect(all.allPrograms[0].titles).toEqual(["Business Administration, Management and Operations", "Computer Science"]);
    expect(all.allPrograms[2]).toMatchObject({ notListed: 10 });
    expect(all.allPrograms[2].titles).toHaveLength(60);

    const cs = await run("get_college", { unitId: 2001, major: "computer science" });
    expect(cs.programs.map((p: { cip4: string; credential: string }) => [p.cip4, p.credential])).toEqual([
      ["11.07", "Bachelor's degree"],
      ["11.01", "Associate degree"],
    ]);
    expect(cs.programs[0].medianEarnings4yr).toBe(81_000);

    const none = await run("get_college", { unitId: 2001, major: "welding" });
    expect(none.programs).toEqual([]);
    expect(none.programNote).toMatch(/No program here matches/);
    expect(none.allPrograms).toHaveLength(3);
  });
});

describe("get_my_college_list", () => {
  it("returns only the student's own list and upcoming deadlines, with no notes or row ids", async () => {
    const reg = async (name: string, email: string) => {
      const r = await registerStudent(db, { displayName: name, email, password: "correct horse battery", birthDate: "2009-01-15", grade: 12 }, now);
      if (!r.ok) throw new Error(r.error);
      return r.value.userId;
    };
    const ana = await reg("Ana", "ana@example.com");
    const ben = await reg("Ben", "ben@example.com");
    await db.insert(schema.collegeList).values([
      { userId: ana, unitId: 1001, name: "Prairie State University", deadline: "2026-10-20", notes: "private note" },
      { userId: ben, unitId: 1003, name: "Gulf Coast University" },
    ]);
    const tools = await counselorExtraTools(db, { id: ana, grade: 12 }, { now });
    const out = JSON.parse(String(await tools.find((t) => t.name === "get_my_college_list")!.run({} as never)));
    expect(out.list.map((e: { name: string }) => e.name)).toEqual(["Prairie State University"]);
    expect(out.upcoming).toHaveLength(1);
    expect(JSON.stringify(out)).not.toMatch(/private note|"id"/);
  });
});
