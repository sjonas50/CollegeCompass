import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import {
  MAX_LIST_ENTRIES,
  addCollege,
  addCustom,
  collegeListForCounselor,
  getEntry,
  getEntryWithScorecard,
  listAidOffers,
  listEntries,
  listEntriesWithScorecard,
  listStatusFor,
  listSummary,
  lowestNetPriceIds,
  removeEntry,
  updateEntry,
  upcomingDeadlines,
} from "@/lib/applications/service";
import { deleteStudent, exportStudentData } from "@/lib/privacy";

// College list, application tracker and aid comparison, against a real (in-memory) database.

// 11 a.m. in California on September 24, 2026.
const NOW = new Date("2026-09-24T18:00:00Z");

let db: Db;
let ana: string;
let ben: string;

async function student(displayName: string, grade = 12) {
  const [row] = await db
    .insert(schema.users)
    .values({ role: "student", displayName, passwordHash: "not-a-real-hash", grade, gradeSchoolYear: 2026 })
    .returning({ id: schema.users.id });
  return row.id;
}

async function addOrThrow(userId: string, unitId: number) {
  const res = await addCollege(db, userId, unitId);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

async function customOrThrow(userId: string, name: string, kind: "college" | "program" = "program") {
  const res = await addCustom(db, userId, { name, kind });
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(schema.colleges).values([
    { unitId: 100001, name: "North State University", city: "Fargo", state: "ND", avgNetPrice: 14250 },
    { unitId: 100002, name: "Lakeside Community College", city: "Duluth", state: "MN", avgNetPrice: -800 },
    { unitId: 100003, name: "Private Small College", avgNetPrice: null },
  ]);
  ana = await student("Ana");
  ben = await student("Ben");
});

describe("adding colleges", () => {
  it("adds a Scorecard college with its name saved", async () => {
    const res = await addCollege(db, ana, 100001);
    expect(res).toMatchObject({ ok: true, alreadyListed: false });
    if (!res.ok) return;
    expect(res.value).toMatchObject({ unitId: 100001, name: "North State University", kind: "college", status: "considering", checklist: {} });
    expect(res.value).not.toHaveProperty("userId");

    // The saved name stays even if the reference data changes later.
    await db.update(schema.colleges).set({ name: "North State U (renamed)" }).where(eq(schema.colleges.unitId, 100001));
    expect((await listEntries(db, ana))[0].name).toBe("North State University");
  });

  it("says a college is already listed instead of adding it twice", async () => {
    const first = await addOrThrow(ana, 100001);
    const again = await addCollege(db, ana, 100001);
    expect(again).toMatchObject({ ok: true, alreadyListed: true });
    if (again.ok) expect(again.value.id).toBe(first.id);
    expect(await listEntries(db, ana)).toHaveLength(1);
  });

  it("lets two students list the same college", async () => {
    await addOrThrow(ana, 100001);
    expect(await addCollege(db, ben, 100001)).toMatchObject({ ok: true, alreadyListed: false });
  });

  it("only adds colleges that exist", async () => {
    expect(await addCollege(db, ana, 999999)).toEqual({ ok: false, error: "college_not_found" });
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(await addCollege(db, ana, bad), String(bad)).toEqual({ ok: false, error: "college_not_found" });
    }
    expect(await listEntries(db, ana)).toHaveLength(0);
  });

  it("adds custom colleges and programs, checking the input", async () => {
    const program = await customOrThrow(ana, "  Electrician   apprenticeship (IBEW) ");
    expect(program).toMatchObject({ unitId: null, name: "Electrician apprenticeship (IBEW)", kind: "program" });
    await customOrThrow(ana, "University of Toronto", "college");
    // Two custom entries with no unitId don't clash with each other.
    await customOrThrow(ana, "Electrician apprenticeship (IBEW)");

    const bad = await addCustom(db, ana, { name: "", kind: "trade" });
    expect(bad.ok).toBe(false);
    if (!bad.ok && bad.error === "invalid") {
      expect(bad.errors.name).toEqual(["Give it a name."]);
      expect(bad.errors.kind).toBeDefined();
    } else {
      throw new Error("expected invalid");
    }
    expect(await listEntries(db, ana)).toHaveLength(3);
  });

  it(`holds at most ${MAX_LIST_ENTRIES} entries`, async () => {
    await addOrThrow(ana, 100001);
    for (let i = 1; i < MAX_LIST_ENTRIES; i++) await customOrThrow(ana, `Program ${i}`);
    expect(await listStatusFor(db, ana, 100002)).toMatchObject({ listed: false, count: MAX_LIST_ENTRIES, full: true });

    expect(await addCustom(db, ana, { name: "One more", kind: "program" })).toEqual({ ok: false, error: "limit" });
    expect(await addCollege(db, ana, 100002)).toEqual({ ok: false, error: "limit" });
    // Already-listed still answers kindly on a full list.
    expect(await addCollege(db, ana, 100001)).toMatchObject({ ok: true, alreadyListed: true });
    expect(await listEntries(db, ana)).toHaveLength(MAX_LIST_ENTRIES);
    // Another student isn't affected.
    expect((await addCollege(db, ben, 100002)).ok).toBe(true);
  });

  it("stops quick parallel adds at the limit", async () => {
    for (let i = 0; i < MAX_LIST_ENTRIES - 1; i++) await customOrThrow(ana, `Program ${i}`);
    const results = await Promise.all([
      addCustom(db, ana, { name: "A", kind: "program" }),
      addCustom(db, ana, { name: "B", kind: "program" }),
      addCollege(db, ana, 100001),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listEntries(db, ana)).toHaveLength(MAX_LIST_ENTRIES);
  });

  it("reports list status for the add button", async () => {
    expect(await listStatusFor(db, ana, 100001)).toEqual({ listed: false, entryId: null, count: 0, full: false });
    const entry = await addOrThrow(ana, 100001);
    expect(await listStatusFor(db, ana, 100001)).toEqual({ listed: true, entryId: entry.id, count: 1, full: false });
    expect(await listStatusFor(db, ben, 100001)).toMatchObject({ listed: false });
    expect(await listStatusFor(db, ana, Number.NaN)).toEqual({ listed: false, entryId: null, count: 1, full: false });
  });
});

describe("updating entries", () => {
  it("saves status, deadline, notes, checklist and aid offer, and bumps updatedAt", async () => {
    const entry = await addOrThrow(ana, 100001);
    const later = new Date(NOW.getTime() + 60_000);
    const res = await updateEntry(
      db,
      ana,
      entry.id,
      {
        status: "applying",
        deadlineType: "early_action",
        deadline: "2026-11-01",
        notes: "  Ask about the honors program ",
        checklist: { transcriptRequested: true },
        aidOffer: { costOfAttendance: "28,000", grants: "7,395", federalLoans: "5500", parentLoans: "" },
      },
      later,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({
      status: "applying",
      deadlineType: "early_action",
      deadline: "2026-11-01",
      notes: "Ask about the honors program",
      checklist: { transcriptRequested: true },
      aidOffer: { costOfAttendance: 28000, grants: 7395, federalLoans: 5500 },
    });
    expect(res.value.updatedAt.getTime()).toBe(later.getTime());
    expect(res.value.createdAt.getTime()).toBe(entry.createdAt.getTime());
  });

  it("merges checklist items and clears fields given as blank", async () => {
    const entry = await addOrThrow(ana, 100001);
    await updateEntry(db, ana, entry.id, { deadline: "2026-11-01", deadlineType: "regular", notes: "Hi", checklist: { transcriptRequested: true }, aidOffer: { grants: "100" } }, NOW);
    const res = await updateEntry(db, ana, entry.id, { deadline: "", deadlineType: "none", notes: " ", checklist: { applicationSubmitted: true }, aidOffer: { grants: "" } }, NOW);
    if (!res.ok) throw new Error(res.error);
    expect(res.value).toMatchObject({
      deadline: null,
      deadlineType: null,
      notes: null,
      aidOffer: null,
      checklist: { transcriptRequested: true, applicationSubmitted: true },
    });
  });

  it("leaves out fields it wasn't given", async () => {
    const entry = await addOrThrow(ana, 100001);
    await updateEntry(db, ana, entry.id, { notes: "Keep me", status: "applied" }, NOW);
    const res = await updateEntry(db, ana, entry.id, { deadline: "2026-12-01" }, NOW);
    if (!res.ok) throw new Error(res.error);
    expect(res.value).toMatchObject({ notes: "Keep me", status: "applied", deadline: "2026-12-01" });
  });

  it("returns field errors and saves nothing when the input is wrong", async () => {
    const entry = await addOrThrow(ana, 100001);
    const res = await updateEntry(db, ana, entry.id, { status: "applied", deadline: "2030-01-01", aidOffer: { grants: "-4" } }, NOW);
    expect(res.ok).toBe(false);
    if (res.ok || res.error !== "invalid") throw new Error("expected invalid");
    expect(res.errors.deadline).toEqual(["Pick a date within two years of today."]);
    expect(res.errors["aidOffer.grants"]).toBeDefined();
    expect((await getEntry(db, ana, entry.id))?.status).toBe("considering");
  });

  it("keeps an old saved deadline when other fields change", async () => {
    const entry = await addOrThrow(ana, 100001);
    await updateEntry(db, ana, entry.id, { deadline: "2026-01-15" }, NOW);
    // Three years later the saved date is out of the window, but re-saving it is fine.
    const later = new Date("2029-02-01T18:00:00Z");
    expect((await updateEntry(db, ana, entry.id, { deadline: "2026-01-15", notes: "Old one" }, later)).ok).toBe(true);
    expect((await updateEntry(db, ana, entry.id, { deadline: "2026-01-16" }, later)).ok).toBe(false);
  });

  it("never touches another student's entry", async () => {
    const bens = await addOrThrow(ben, 100001);
    expect(await getEntry(db, ana, bens.id)).toBeNull();
    expect(await updateEntry(db, ana, bens.id, { status: "declined", notes: "hijacked" }, NOW)).toEqual({ ok: false, error: "not_found" });
    expect(await removeEntry(db, ana, bens.id)).toEqual({ ok: false, error: "not_found" });
    expect(await getEntry(db, ben, bens.id)).toMatchObject({ status: "considering", notes: null });
  });

  it("treats malformed ids as not found", async () => {
    for (const bad of ["", "not-a-uuid", "' OR 1=1 --"]) {
      expect(await getEntry(db, ana, bad)).toBeNull();
      expect(await updateEntry(db, ana, bad, { notes: "x" }, NOW)).toEqual({ ok: false, error: "not_found" });
      expect(await removeEntry(db, ana, bad)).toEqual({ ok: false, error: "not_found" });
    }
  });

  it("removes an entry", async () => {
    const entry = await customOrThrow(ana, "Welding certificate");
    expect(await removeEntry(db, ana, entry.id)).toEqual({ ok: true, value: { name: "Welding certificate" } });
    expect(await removeEntry(db, ana, entry.id)).toEqual({ ok: false, error: "not_found" });
    expect(await listEntries(db, ana)).toHaveLength(0);
  });
});

describe("Scorecard context and aid comparison", () => {
  it("attaches Scorecard data, and explains what's missing", async () => {
    await addOrThrow(ana, 100001);
    await addOrThrow(ana, 100003);
    await customOrThrow(ana, "Line worker apprenticeship");
    // A college that later disappears from the reference data keeps its entry.
    await db.insert(schema.colleges).values({ unitId: 100004, name: "Gone College" });
    await addOrThrow(ana, 100004);
    await db.delete(schema.colleges).where(eq(schema.colleges.unitId, 100004));

    const rows = await listEntriesWithScorecard(db, ana);
    // Entries added in the same instant can tie on createdAt, so look them up by name.
    expect(Object.fromEntries(rows.map((r) => [r.name, r.scorecard]))).toEqual({
      "North State University": { found: true, avgNetPrice: 14250, city: "Fargo", state: "ND" },
      "Private Small College": { found: true, avgNetPrice: null, city: null, state: null },
      "Line worker apprenticeship": null,
      "Gone College": { found: false, avgNetPrice: null, city: null, state: null },
    });

    // The same for one entry, and still only the owner's.
    const gone = rows.find((r) => r.name === "Gone College")!;
    expect((await getEntryWithScorecard(db, ana, gone.id))?.scorecard).toEqual({ found: false, avgNetPrice: null, city: null, state: null });
    const north = rows.find((r) => r.name === "North State University")!;
    expect(await getEntryWithScorecard(db, ana, north.id)).toEqual(north);
    expect(await getEntryWithScorecard(db, ben, north.id)).toBeNull();
    expect(await getEntryWithScorecard(db, ana, "not-an-id")).toBeNull();
  });

  it("compares only entries with an offer and finds the lowest net price", async () => {
    const north = await addOrThrow(ana, 100001);
    const lake = await addOrThrow(ana, 100002);
    await addOrThrow(ana, 100003);
    const custom = await customOrThrow(ana, "Coding bootcamp");
    await updateEntry(db, ana, north.id, { aidOffer: { costOfAttendance: "30000", grants: "10000", parentLoans: "5000" } }, NOW);
    await updateEntry(db, ana, lake.id, { aidOffer: { costOfAttendance: "12000", grants: "7395", scholarships: "6000" } }, NOW);
    await updateEntry(db, ana, custom.id, { aidOffer: { grants: "1000" } }, NOW);

    const offers = await listAidOffers(db, ana);
    const byName = (name: string) => offers.find((o) => o.name === name);
    expect(offers.map((o) => o.name).sort()).toEqual(["Coding bootcamp", "Lakeside Community College", "North State University"]);
    expect(byName("North State University")?.comparison).toMatchObject({ netPrice: 20000, hasParentLoans: true });
    expect(byName("Lakeside Community College")?.comparison).toMatchObject({ netPrice: 0, giftExceedsCost: true });
    expect(byName("Lakeside Community College")?.scorecard).toMatchObject({ avgNetPrice: -800 });
    expect(byName("Coding bootcamp")).toMatchObject({ scorecard: null, comparison: { netPrice: null } });
    expect(lowestNetPriceIds(offers)).toEqual(new Set([lake.id]));
    expect(lowestNetPriceIds(offers.filter((o) => o.id === north.id))).toEqual(new Set());
    expect(await listAidOffers(db, ben)).toEqual([]);
  });
});

describe("counselor summaries", () => {
  it("summarizes the list without notes, row ids or the student's name", async () => {
    const north = await addOrThrow(ana, 100001);
    const custom = await customOrThrow(ana, "Ana's cousin's welding shop apprenticeship");
    await updateEntry(
      db,
      ana,
      north.id,
      {
        status: "applying",
        deadlineType: "regular",
        deadline: "2027-01-15",
        notes: "My phone is 555-123-4567, secret note",
        checklist: { transcriptRequested: true, fafsaListed: true },
        aidOffer: { costOfAttendance: "30000", grants: "10000", federalLoans: "5500" },
      },
      NOW,
    );

    const summary = await listSummary(db, ana, NOW);
    // Same-instant adds can tie on createdAt, so compare in a fixed order.
    summary.sort((a, b) => a.kind.localeCompare(b.kind));
    expect(summary).toEqual([
      {
        name: "North State University",
        kind: "college",
        unitId: 100001,
        status: "applying",
        submitted: false,
        deadlineType: "regular",
        deadline: "2027-01-15",
        daysLeft: 113,
        pastDue: false,
        checklist: { done: 2, total: 8 },
        aid: expect.objectContaining({ costOfAttendance: 30000, giftAid: 10000, netPrice: 20000, loans: 5500, paidNow: 14500, hasParentLoans: false }),
      },
      {
        name: "[name]'s cousin's welding shop apprenticeship",
        kind: "program",
        unitId: null,
        status: "considering",
        submitted: false,
        deadlineType: null,
        deadline: null,
        daysLeft: null,
        pastDue: false,
        checklist: { done: 0, total: 8 },
        aid: null,
      },
    ]);
    const json = JSON.stringify(summary);
    for (const secret of [north.id, custom.id, ana, "secret note", "555-123-4567", "notes", "warnings"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("says which deadlines have passed and gives today's date, so the counselor never has to guess", async () => {
    const add = async (name: string, deadline: string, extra: Record<string, unknown> = {}) => {
      const e = await customOrThrow(ana, name, "college");
      const res = await updateEntry(db, ana, e.id, { deadline, ...extra }, NOW);
      if (!res.ok) throw new Error(res.error);
    };
    await add("Missed", "2026-09-15", { status: "applying" });
    await add("Sent on time", "2026-09-01", { status: "applied" });
    await add("Today", "2026-09-24");
    await add("Next year", "2027-02-01");

    const out = await collegeListForCounselor(db, ana, NOW);
    expect(out.today).toBe("2026-09-24");
    const byName = Object.fromEntries(out.list.map((e) => [e.name, { daysLeft: e.daysLeft, pastDue: e.pastDue }]));
    expect(byName).toEqual({
      Missed: { daysLeft: -9, pastDue: true },
      "Sent on time": { daysLeft: -23, pastDue: false },
      Today: { daysLeft: 0, pastDue: false },
      "Next year": { daysLeft: 130, pastDue: false },
    });
    expect(out.upcoming.map((d) => d.name)).toEqual(["Today"]);
    expect(JSON.stringify(out)).not.toMatch(/"id"|"notes"/);
  });

  it("lists unsent applications due in the next two weeks, soonest first", async () => {
    const add = async (name: string, deadline: string, extra: Record<string, unknown> = {}) => {
      const e = await customOrThrow(ana, name, "college");
      const res = await updateEntry(db, ana, e.id, { deadline, ...extra }, NOW);
      if (!res.ok) throw new Error(res.error);
    };
    await add("Due today", "2026-09-24");
    await add("Day 14", "2026-10-08", { deadlineType: "priority" });
    await add("Day 15", "2026-10-09");
    await add("Yesterday", "2026-09-23");
    await add("Day 3", "2026-09-27", { deadlineType: "early_action" });
    await add("Sent", "2026-09-30", { status: "applied" });
    await add("Checked off", "2026-10-01", { checklist: { applicationSubmitted: true } });
    await customOrThrow(ana, "No deadline");
    const bens = await customOrThrow(ben, "Ben's college", "college");
    await updateEntry(db, ben, bens.id, { deadline: "2026-09-25" }, NOW);

    const soon = await upcomingDeadlines(db, ana, NOW);
    expect(soon.map((d) => [d.name, d.daysLeft])).toEqual([
      ["Due today", 0],
      ["Day 3", 3],
      ["Day 14", 14],
    ]);
    expect(soon[1]).toEqual({ name: "Day 3", kind: "college", unitId: null, status: "considering", deadlineType: "early_action", deadline: "2026-09-27", daysLeft: 3 });
    expect(soon[0]).not.toHaveProperty("id");

    expect((await upcomingDeadlines(db, ana, NOW, 15)).map((d) => d.name)).toContain("Day 15");
    expect((await upcomingDeadlines(db, ana, NOW, 0)).map((d) => d.name)).toEqual(["Due today"]);
    // Late at night in California is still the same day there.
    expect((await upcomingDeadlines(db, ana, new Date("2026-09-25T06:30:00Z"))).map((d) => d.name)[0]).toBe("Due today");
  });
});

describe("privacy", () => {
  it("exports the college list and deletes it with the student", async () => {
    const north = await addOrThrow(ana, 100001);
    await updateEntry(db, ana, north.id, { notes: "Visit in April", aidOffer: { grants: "5000" }, checklist: { depositPaid: true } }, NOW);
    await customOrThrow(ana, "Culinary program");
    await addOrThrow(ben, 100001);

    const data = await exportStudentData(db, ana, ana);
    expect(data?.collegeList).toHaveLength(2);
    const exported = (name: string) => data?.collegeList.find((e) => e.name === name);
    expect(exported("North State University")).toMatchObject({
      id: north.id,
      unitId: 100001,
      name: "North State University",
      kind: "college",
      notes: "Visit in April",
      aidOffer: { grants: 5000 },
      checklist: { depositPaid: true },
    });
    for (const entry of data?.collegeList ?? []) {
      expect(entry).toHaveProperty("createdAt");
      expect(entry).toHaveProperty("updatedAt");
      expect(entry).not.toHaveProperty("userId");
    }
    expect(exported("Culinary program")).toMatchObject({ unitId: null, kind: "program" });

    expect(await deleteStudent(db, ana, ana)).toBe(true);
    const left = await db.select().from(schema.collegeList);
    expect(left).toHaveLength(1);
    expect(left[0].userId).toBe(ben);
  });
});
