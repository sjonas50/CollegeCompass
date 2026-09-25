import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import { createChildAccount, registerParent, registerStudent } from "@/lib/accounts";
import { verifyParentConsent } from "@/lib/consent/verifier";
import { schoolSettingsFromForm } from "./form";
import { copySchoolSettings, exportSchoolData, saveSchoolSettings, schoolSettings, viewerHomeState, viewerStates } from "./student";
import { SCHOOLS, insertSchools } from "./test-fixtures";

const NOW = new Date("2026-09-25T12:00:00Z"); // school year 2026-27
const PASSWORD = "correct horse battery";
let db: Db;

async function student(grade = 10, name = "Ana") {
  const res = await registerStudent(db, { displayName: name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD, birthDate: "2011-01-15", grade }, NOW);
  if (!res.ok) throw new Error(res.error);
  return res.value.userId;
}

beforeEach(async () => {
  db = await createTestDb();
  await insertSchools(db);
});

describe("saveSchoolSettings", () => {
  it("saves a state and a school from the directory, from this school year", async () => {
    const id = await student();
    expect(await saveSchoolSettings(db, id, { state: "TX", current: { choice: "listed", schoolRef: SCHOOLS.austinHigh.schoolRef } }, { by: "student", now: NOW })).toEqual({ ok: true });
    const settings = await schoolSettings(db, id);
    expect(settings).toMatchObject({
      homeState: "TX",
      plannerState: "TX",
      current: { role: "current", choice: "listed", school: { name: "Austin High School", city: "Austin" }, noLongerListed: false, fromSchoolYear: 2026, setBy: "student" },
      next: null,
    });
  });

  it("marks only Utah, Tennessee and Texas for full class planning", async () => {
    const id = await student();
    await saveSchoolSettings(db, id, { state: "OH", current: { choice: "prefer_not_to_say" } }, { by: "student", now: NOW });
    expect(await schoolSettings(db, id)).toMatchObject({ homeState: "OH", plannerState: null, current: { choice: "prefer_not_to_say", school: null } });
  });

  it("refuses a school from another state, an unknown school, a made-up state, and a school without a state", async () => {
    const id = await student();
    const save = (input: Parameters<typeof saveSchoolSettings>[2]) => saveSchoolSettings(db, id, input, { by: "student", now: NOW });
    expect(await save({ state: "UT", current: { choice: "listed", schoolRef: SCHOOLS.austinHigh.schoolRef } })).toEqual({ ok: false, error: "school_other_state" });
    expect(await save({ state: "TX", current: { choice: "listed", schoolRef: "nces:000000000000" } })).toEqual({ ok: false, error: "school_not_found" });
    expect(await save({ state: "XX" })).toEqual({ ok: false, error: "invalid_state" });
    expect(await save({ state: null, current: { choice: "not_listed", name: "Oak Hill" } })).toEqual({ ok: false, error: "state_required" });
    // Nothing was saved.
    expect(await schoolSettings(db, id)).toMatchObject({ homeState: null, current: null });
  });

  it("keeps the family's words for a school that isn't listed, cleaned up", async () => {
    const id = await student();
    const name = `  Oak\tHill\n Academy ${"x".repeat(200)}`;
    await saveSchoolSettings(db, id, { state: "TN", current: { choice: "not_listed", name } }, { by: "parent", now: NOW });
    const settings = await schoolSettings(db, id);
    expect(settings?.current).toMatchObject({ choice: "not_listed", school: null, setBy: "parent" });
    expect(settings?.current?.notListedName).toMatch(/^Oak Hill Academy x+$/);
    expect(settings?.current?.notListedName).toHaveLength(120);
  });

  it("starts over when the state changes, and keeps the school's first year when it's the same school", async () => {
    const id = await student();
    await saveSchoolSettings(db, id, { state: "TX", current: { choice: "listed", schoolRef: SCHOOLS.austinHigh.schoolRef } }, { by: "student", now: NOW });
    // A year later, saved again with the same school: still "from" 2026.
    const later = new Date("2027-09-10T12:00:00Z");
    await saveSchoolSettings(db, id, { state: "TX", current: { choice: "listed", schoolRef: SCHOOLS.austinHigh.schoolRef } }, { by: "student", now: later });
    expect((await schoolSettings(db, id))?.current?.fromSchoolYear).toBe(2026);
    // Only the state is sent (the school question left alone): the school stays.
    await saveSchoolSettings(db, id, { state: "TX" }, { by: "student", now: later });
    expect((await schoolSettings(db, id))?.current?.school?.name).toBe("Austin High School");
    // A move to Utah clears the Texas school.
    await saveSchoolSettings(db, id, { state: "UT" }, { by: "student", now: later });
    expect(await schoolSettings(db, id)).toMatchObject({ homeState: "UT", current: null, next: null });
    // Clearing the state clears everything.
    await saveSchoolSettings(db, id, { state: "UT", current: { choice: "listed", schoolRef: SCHOOLS.herriman.schoolRef } }, { by: "student", now: later });
    await saveSchoolSettings(db, id, { state: null }, { by: "student", now: later });
    expect(await db.select().from(schema.studentSchools)).toEqual([]);
    expect((await schoolSettings(db, id))?.homeState).toBeNull();
  });

  it("saves the high school after a junior high, starting the year after its last grade", async () => {
    // An 8th grader at a Utah 7-9 junior high goes to a 10-12 high school in fall 2028.
    const id = await student(8);
    await saveSchoolSettings(
      db,
      id,
      { state: "UT", current: { choice: "listed", schoolRef: SCHOOLS.utahJunior.schoolRef }, next: { choice: "listed", schoolRef: SCHOOLS.herriman.schoolRef } },
      { by: "student", now: NOW },
    );
    expect(await schoolSettings(db, id)).toMatchObject({
      current: { school: { name: "Copper Mountain Middle" }, fromSchoolYear: 2026 },
      next: { role: "next", school: { name: "Herriman High" }, fromSchoolYear: 2028 },
    });
    // "Not sure yet" removes it.
    await saveSchoolSettings(db, id, { state: "UT", next: { choice: "clear" } }, { by: "student", now: NOW });
    expect((await schoolSettings(db, id))?.next).toBeNull();
    // A next school that isn't listed starts after the current school's last grade too.
    await saveSchoolSettings(db, id, { state: "UT", next: { choice: "not_listed" } }, { by: "student", now: NOW });
    expect((await schoolSettings(db, id))?.next).toMatchObject({ choice: "not_listed", notListedName: null, fromSchoolYear: 2028 });
    // Moving to a school that goes through 12th grade drops the next school.
    await saveSchoolSettings(db, id, { state: "UT", current: { choice: "listed", schoolRef: SCHOOLS.herriman.schoolRef } }, { by: "student", now: NOW });
    expect((await schoolSettings(db, id))?.next).toBeNull();
  });

  it("shows a school a newer directory dropped", async () => {
    const id = await student();
    await saveSchoolSettings(db, id, { state: "TN", current: { choice: "listed", schoolRef: SCHOOLS.alcoa.schoolRef } }, { by: "student", now: NOW });
    await db.delete(schema.schools);
    expect((await schoolSettings(db, id))?.current).toMatchObject({ choice: "listed", school: null, noLongerListed: true });
  });

  it("clears the counselor's saved contexts when the state changes, and writes no audit entry", async () => {
    const id = await student();
    await db.insert(schema.counselorConversations).values({ userId: id, context: "saved", contextBuiltAt: NOW });
    await saveSchoolSettings(db, id, { state: "TN", current: { choice: "listed", schoolRef: SCHOOLS.alcoa.schoolRef } }, { by: "student", now: NOW });
    const [conv] = await db.select().from(schema.counselorConversations).where(eq(schema.counselorConversations.userId, id));
    expect(conv.context).toBeNull();
    const audit = await db.select().from(schema.auditLog);
    expect(audit.map((a) => a.action)).not.toContain(expect.stringMatching(/school|state/));
    expect(JSON.stringify(audit)).not.toMatch(/Alcoa|470006000235|nces:/);
  });

  it("refuses accounts that aren't students", async () => {
    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: PASSWORD });
    if (!parent.ok) throw new Error();
    expect(await saveSchoolSettings(db, parent.value.userId, { state: "TX" }, { by: "parent", now: NOW })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("the settings form", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("reads each answer", () => {
    expect(schoolSettingsFromForm(form({ state: "TX", school: "ref:nces:483510003969" }))).toEqual({
      state: "TX",
      current: { choice: "listed", schoolRef: "nces:483510003969" },
      next: undefined,
    });
    expect(schoolSettingsFromForm(form({ state: "TX", school: "not_listed", notListedName: " Oak Hill " }))).toMatchObject({
      current: { choice: "not_listed", name: "Oak Hill" },
    });
    expect(schoolSettingsFromForm(form({ state: "TX", school: "prefer_not_to_say", nextSchool: "not_sure" }))).toEqual({
      state: "TX",
      current: { choice: "prefer_not_to_say" },
      next: { choice: "clear" },
    });
    // "keep" and nothing checked leave the school as it is; no state clears it.
    expect(schoolSettingsFromForm(form({ state: "UT", school: "keep", nextSchool: "keep" }))).toEqual({ state: "UT", current: undefined, next: undefined });
    expect(schoolSettingsFromForm(form({ state: "" }))).toEqual({ state: null, current: undefined, next: undefined });
  });
});

describe("parents and siblings", () => {
  async function family() {
    const parent = await registerParent(db, { displayName: "Rosa", email: "rosa@example.com", password: PASSWORD });
    if (!parent.ok) throw new Error();
    const rosa = parent.value.userId;
    const consent = await verifyParentConsent({ parentUserId: rosa, attested: true });
    const kid = async (name: string, grade: number) => {
      const res = await createChildAccount(db, rosa, { displayName: name, username: name.toLowerCase(), password: PASSWORD, birthDate: "2014-03-01", grade }, consent, NOW);
      if (!res.ok) throw new Error(res.error);
      return res.value.userId;
    };
    return { rosa, leo: await kid("Leo", 7), mia: await kid("Mia", 8) };
  }

  it("copies one child's state and schools to a sibling", async () => {
    const { leo, mia } = await family();
    await saveSchoolSettings(
      db,
      mia,
      { state: "UT", current: { choice: "listed", schoolRef: SCHOOLS.utahJunior.schoolRef }, next: { choice: "listed", schoolRef: SCHOOLS.herriman.schoolRef } },
      { by: "parent", now: NOW },
    );
    expect(await copySchoolSettings(db, mia, leo, { now: NOW })).toEqual({ ok: true });
    expect(await schoolSettings(db, leo)).toMatchObject({
      homeState: "UT",
      current: { school: { name: "Copper Mountain Middle" }, setBy: "parent" },
      // Leo is in 7th grade, so he starts high school a year after Mia.
      next: { school: { name: "Herriman High" }, fromSchoolYear: 2029 },
    });
  });

  it("gives a parent their children's states, and one state to start searches from", async () => {
    const { rosa, leo, mia } = await family();
    const parent = { id: rosa, role: "parent" };
    expect(await viewerStates(db, parent)).toEqual([]);
    await saveSchoolSettings(db, leo, { state: "TX" }, { by: "parent", now: NOW });
    expect(await viewerStates(db, parent)).toEqual(["TX"]);
    expect(await viewerHomeState(db, parent)).toBe("TX");
    await saveSchoolSettings(db, mia, { state: "UT" }, { by: "parent", now: NOW });
    expect(await viewerStates(db, parent)).toEqual(["TX", "UT"]);
    // Two states: no single one to start from.
    expect(await viewerHomeState(db, parent)).toBeNull();
    expect(await viewerStates(db, { id: leo, role: "student", homeState: "TX" })).toEqual(["TX"]);
    expect(await viewerStates(db, { id: leo, role: "student" })).toEqual(["TX"]);
    expect(await viewerStates(db, null)).toEqual([]);
  });
});

describe("exportSchoolData", () => {
  it("names the school and place, and says when it's not in the list", async () => {
    const id = await student(8);
    await saveSchoolSettings(
      db,
      id,
      { state: "UT", current: { choice: "listed", schoolRef: SCHOOLS.utahJunior.schoolRef }, next: { choice: "not_listed", name: "Oak Hill" } },
      { by: "student", now: NOW },
    );
    const data = await exportSchoolData(db, id);
    expect(data).toEqual({
      homeState: "UT",
      schools: [
        expect.objectContaining({
          role: "current",
          choice: "listed",
          school: { name: "Copper Mountain Middle", city: "Herriman", state: "UT", directoryId: SCHOOLS.utahJunior.schoolRef },
          notListedName: null,
          fromSchoolYear: 2026,
          setBy: "student",
        }),
        expect.objectContaining({ role: "next", choice: "not_listed", school: null, notListedName: "Oak Hill" }),
      ],
    });
  });
});
