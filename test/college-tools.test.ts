import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { registerStudent } from "@/lib/accounts";
import { listSections } from "@/lib/aid-guide";
import { insertColleges, insertPrograms } from "@/lib/colleges/test-fixtures";
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
    expect(out.major).toMatch(/Registered Nursing/);
    expect(out.results.map((r: { name: string }) => r.name)).toEqual(["Lakeside Community College", "Prairie State University"]);
    expect(out.results[0]).toMatchObject({ netPriceAverage: 0, page: "/colleges/1002" });
    expect(out.results[0].netPriceByIncome["0-30000"]).toBe(0);
    expect(out.moreResults).toMatch(/^\/colleges\?/);
  });

  it("explains a bad state and an unknown major instead of guessing", async () => {
    expect((await run("search_colleges", { state: "Narnia" })).error).toMatch(/state/i);
    expect((await run("search_colleges", { major: "underwater basket weaving" })).note).toMatch(/No college programs/);
  });

  it("returns one college's costs, outcomes and programs, optionally for one major", async () => {
    const out = await run("get_college", { unitId: 1001, major: "51.38" });
    expect(out).toMatchObject({ name: "Prairie State University", netPriceAverage: 14_000, completionRatePercent: 60, page: "/colleges/1001" });
    expect(out.programs).toEqual([
      { credential: expect.any(String), title: "Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing", medianEarnings4yr: 78_000, medianDebt: 23_000 },
    ]);
    expect((await run("get_college", { unitId: 999999 })).error).toBeTruthy();
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
