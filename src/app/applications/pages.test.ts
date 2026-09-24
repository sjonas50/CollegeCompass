import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EntryPage from "@/app/applications/[id]/page";
import ComparePage from "@/app/applications/compare/page";
import ApplicationsPage from "@/app/applications/page";
import { AddToListButton } from "@/components/add-to-list";
import { type Db, createTestDb, schema } from "@/db";
import { MAX_LIST_ENTRIES, addCollege, addCustom, updateEntry } from "@/lib/applications/service";
import type { SessionUser } from "@/lib/auth/sessions";

// Server-rendered checks for the list pages and the add button, with the session and database mocked.

const state = vi.hoisted(() => ({ db: null as Db | null, user: null as SessionUser | null }));

vi.mock("@/db", async (original) => ({ ...(await original<typeof import("@/db")>()), getDb: async () => state.db }));
vi.mock("@/lib/auth/dal", () => ({ requireUser: async () => state.user, getCurrentUser: async () => state.user }));

const NOW = new Date("2026-09-24T18:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  state.db = null;
  state.user = null;
});

async function signIn(grade: number | null, role: SessionUser["role"] = "student") {
  const db = state.db ?? (await createTestDb());
  state.db = db;
  if (!(await db.select().from(schema.colleges)).length) {
    await db.insert(schema.colleges).values([
      { unitId: 100001, name: "North State University", city: "Fargo", state: "ND", avgNetPrice: 14250 },
      { unitId: 100002, name: "Lakeside Community College", avgNetPrice: -800 },
    ]);
  }
  const [user] = await db
    .insert(schema.users)
    .values({ role, displayName: "Sam", passwordHash: "x", grade: role === "student" ? grade : null, gradeSchoolYear: 2026 })
    .returning({ id: schema.users.id });
  state.user = { id: user.id, role, displayName: "Sam", username: null, householdId: null, parentManaged: false, grade };
  return { db, id: user.id };
}

// Visible text only: React's inline form-replay <script> isn't page copy.
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);
const listPage = () => render(ApplicationsPage({ searchParams: Promise.resolve({}) } as PageProps<"/applications">));
const entryPage = (id: string) =>
  render(EntryPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as PageProps<"/applications/[id]">));

function expectNoRawValues(html: string) {
  const t = text(html);
  expect(t).not.toMatch(/\bnull\b|\bNaN\b|\bundefined\b|\bPS\b|\$-|-\$/);
}

describe("list page", () => {
  it("shows seniors the full tracker, key dates and a deadline timeline", async () => {
    const { db, id } = await signIn(12);
    const north = await addCollege(db, id, 100001);
    if (!north.ok) throw new Error();
    await updateEntry(db, id, north.value.id, { deadline: "2026-11-01", deadlineType: "early_action", checklist: { transcriptRequested: true } }, NOW);
    const late = await addCustom(db, id, { name: "Welding program", kind: "program" });
    if (!late.ok) throw new Error();
    await updateEntry(db, id, late.value.id, { deadline: "2026-09-01" }, NOW);

    const html = await listPage();
    const t = text(html);
    expect(t).toContain("My college list");
    expect(t).toContain("Upcoming deadlines");
    expect(t).toContain("Dates that have passed");
    expect(t).toContain("Some schools still take applications");
    expect(t).toContain("Early action deadline: November 1, 2026");
    expect(t).toContain("Checklist: 1 of 8 done");
    expect(t).toContain("Average net price: $14,250 a year (College Scorecard)");
    expect(t).toContain("2 of 30 spots used");
    expect(t).toContain("Key dates this year");
    expect(t).toContain("The 2027–28 FAFSA opens");
    expect(t).toContain("By October 1, 2026");
    expect(html).toContain('href="https://studentaid.gov/apply-for-aid/fafsa/fafsa-deadlines"');
    expect(html).toContain('href="/colleges"');
    expect(html).toContain('href="/aid/en/comparing-aid-offers"');
    expect(html).toContain(`href="/applications/${north.value.id}"`);
    expectNoRawValues(html);
  });

  it("frames the list as ideas for grades 7–10, without application tools or key dates", async () => {
    const { db, id } = await signIn(9);
    await addCollege(db, id, 100001);
    const t = text(await listPage());
    expect(t).toContain("Colleges and programs I'm curious about");
    expect(t).not.toContain("Key dates this year");
    expect(t).not.toContain("Checklist:");
    expect(t).not.toContain("Compare aid offers");
    expect(t).not.toContain("Upcoming deadlines");
    expect(t).toContain("Notes and details");
  });

  it("gives juniors key dates as a preview, without 'open now' nudges", async () => {
    vi.setSystemTime(new Date("2026-10-15T18:00:00Z"));
    await signIn(11);
    const t = text(await listPage());
    expect(t).toContain("Key dates this year");
    expect(t).toContain("Next fall it's your turn");
    expect(t).not.toContain("Open now");
  });

  it("marks what's open for seniors", async () => {
    vi.setSystemTime(new Date("2026-10-15T18:00:00Z"));
    await signIn(12);
    expect(text(await listPage())).toContain("Open now");
  });

  it("keeps the tools but not this year's key dates after graduation", async () => {
    await signIn(13);
    const t = text(await listPage());
    expect(t).toContain("My college list");
    expect(t).not.toContain("Key dates this year");
  });

  it("offers a kind message and hides the add form when the list is full", async () => {
    const { db, id } = await signIn(12);
    for (let i = 0; i < MAX_LIST_ENTRIES; i++) await addCustom(db, id, { name: `Program ${i}`, kind: "program" });
    const html = await listPage();
    expect(text(html)).toContain("which is the most it can hold");
    expect(html).not.toContain('name="kind"');
  });
});

describe("entry page", () => {
  it("shows the whole form for seniors, with the saved offer", async () => {
    const { db, id } = await signIn(12);
    const res = await addCollege(db, id, 100001);
    if (!res.ok) throw new Error();
    await updateEntry(db, id, res.value.id, { aidOffer: { costOfAttendance: "20000", grants: "25000", parentLoans: "4000" } }, NOW);
    const html = await entryPage(res.value.id);
    const t = text(html);
    expect(t).toContain("North State University");
    expect(t).toContain("Your saved aid offer");
    expect(t).toContain("Grants and scholarships add up to more than the cost, so the net price is $0.");
    expect(t).toContain("Parent PLUS loan");
    expect(html).toContain('name="check_fafsaListed"');
    expect(html).toContain('name="aid_costOfAttendance"');
    expect(html).toContain('type="date"');
    expect(html).not.toContain("<details");
    expectNoRawValues(html);
  });

  it("tucks application-only fields away for younger students", async () => {
    const { db, id } = await signIn(8);
    const res = await addCustom(db, id, { name: "Robotics camp", kind: "program" });
    if (!res.ok) throw new Error();
    const html = await entryPage(res.value.id);
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>You(&#x27;|')ll use these in 11th and 12th grade<\/summary>/);
    // The fields are still in the form (inside the closed section), so saving never clears them.
    expect(html).toContain('name="check_depositPaid"');
    expect(html).not.toContain("Your saved aid offer");
  });

  it("is not found for another student's entry", async () => {
    const { db } = await signIn(12);
    const [other] = await db
      .insert(schema.users)
      .values({ role: "student", displayName: "Other", passwordHash: "x", grade: 12 })
      .returning({ id: schema.users.id });
    const theirs = await addCollege(db, other.id, 100001);
    if (!theirs.ok) throw new Error();
    await expect(entryPage(theirs.value.id)).rejects.toThrow();
    await expect(entryPage("not-an-id")).rejects.toThrow();
  });
});

describe("compare page", () => {
  it("explains offers side by side and as stacked cards", async () => {
    const { db, id } = await signIn(12);
    const north = await addCollege(db, id, 100001);
    const lake = await addCollege(db, id, 100002);
    const bootcamp = await addCustom(db, id, { name: "Coding bootcamp", kind: "program" });
    if (!north.ok || !lake.ok || !bootcamp.ok) throw new Error();
    await updateEntry(db, id, north.value.id, { aidOffer: { costOfAttendance: "30000", grants: "10000", otherLoans: "3000" } }, NOW);
    await updateEntry(db, id, lake.value.id, { aidOffer: { costOfAttendance: "12000", grants: "7000" } }, NOW);
    await updateEntry(db, id, bootcamp.value.id, { aidOffer: { scholarships: "500" } }, NOW);

    const html = await render(ComparePage());
    const t = text(html);
    expect(t).toContain("Grants and scholarships don't need to be paid back. Loans do.");
    expect(t).toContain("Your aid offers side by side, for one year");
    expect(t).toContain("Lowest net price");
    expect(t).toContain("$20,000");
    expect(t).toContain("$5,000");
    expect(t).toContain("On average, aid here was more than the cost.");
    expect(t).toContain("Private loans usually cost more");
    expect(t).toContain("Needs the total cost");
    expect(html).toContain('<caption id="compare-caption"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toMatch(/class="[^"]*\bsm:hidden\b/);
    expect(html).toContain('href="/aid/en/comparing-aid-offers"');
    expectNoRawValues(html);
  });

  it("explains how to add an offer when there are none", async () => {
    await signIn(12);
    const t = text(await render(ComparePage()));
    expect(t).toContain("You haven't saved an aid offer yet.");
  });
});

describe("AddToListButton", () => {
  it("asks signed-out visitors to sign in and come back", async () => {
    state.db = await createTestDb();
    const html = await render(AddToListButton({ unitId: 100001, name: "North State University" }));
    expect(html).toContain('href="/login?next=/colleges/100001"');
    expect(text(html)).toContain("Sign in to save colleges");
  });

  it("shows parents nothing", async () => {
    await signIn(null, "parent");
    expect(await render(AddToListButton({ unitId: 100001, name: "North State University" }))).toBe("");
  });

  it("lets students add a college, or shows it's already on their list", async () => {
    const { db, id } = await signIn(10);
    const before = await render(AddToListButton({ unitId: 100001, name: "North State University" }));
    expect(text(before)).toContain("Add to my list");
    expect(before).toContain('name="unitId"');
    expect(before).toContain('value="100001"');

    await addCollege(db, id, 100001);
    const after = await render(AddToListButton({ unitId: 100001, name: "North State University" }));
    expect(text(after)).toContain("On your list");
    expect(after).toContain('href="/applications"');
    expect(after).not.toContain("<form");
  });

  it("says when the list is full", async () => {
    const { db, id } = await signIn(12);
    for (let i = 0; i < MAX_LIST_ENTRIES; i++) await addCustom(db, id, { name: `Program ${i}`, kind: "program" });
    const html = await render(AddToListButton({ unitId: 100001, name: "North State University" }));
    expect(text(html)).toContain("Your list is full");
    expect(html).not.toContain("<form");
  });

  it("ignores bad ids", async () => {
    await signIn(12);
    expect(await render(AddToListButton({ unitId: 0, name: "x" }))).toBe("");
    expect(await render(AddToListButton({ unitId: 1.5, name: "x" }))).toBe("");
  });
});
