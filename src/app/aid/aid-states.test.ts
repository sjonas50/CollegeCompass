import { afterEach, describe, expect, it, vi } from "vitest";
import enContent from "@/content/aid-guide/en.json";
import { getSection, loadGuide } from "@/lib/aid-guide";
import { parseGuide } from "@/lib/aid-guide/schema";
import { contentForStates, sectionsForStates, stateNames } from "@/lib/aid-guide/states";
import type { SessionUser } from "@/lib/auth/sessions";
import { indexPage, sectionPage, text } from "./page-test-utils";

// State tags in the real English guide: a signed-in student's own state's programs come first
// ("For Tennessee"), tagged items say which state they're for, and a state the guide doesn't
// cover yet is pointed to "Find your state's programs". Spanish has no tags yet.

const viewer = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: async () => viewer.user }));

afterEach(() => {
  viewer.user = null;
});

const studentIn = (homeState: string | null): SessionUser => ({
  id: "00000000-0000-4000-8000-000000000001",
  role: "student",
  displayName: "Ana",
  username: null,
  householdId: null,
  parentManaged: false,
  grade: 12,
  homeState,
});

/** The "For <state>" panel's text, or "" when there isn't one. */
const panel = (html: string) => text(/<section aria-labelledby="for-your-state"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "");

describe("state tags in the guide", () => {
  it("are checked like the rest of the content", () => {
    const raw = JSON.parse(JSON.stringify(enContent));
    expect(parseGuide(raw, "en").ok).toBe(true);
    // A known state, once each.
    raw.sections[0].blocks[0] = { ...raw.sections[0].blocks[0], states: ["TX", "TX"] };
    expect(parseGuide(raw, "en")).toMatchObject({ ok: false, issues: [expect.stringContaining("List each state once.")] });
    raw.sections[0].blocks[0] = { ...raw.sections[0].blocks[0], states: ["Texas"] };
    expect(parseGuide(raw, "en")).toMatchObject({ ok: false, issues: [expect.stringContaining('Unknown state code "Texas"')] });
  });

  it("keep items as plain text for everything that reads them, with the states alongside", () => {
    const section = getSection("en", "state-aid-and-promise-programs")!;
    const seniors = section.blocks.find((b) => b.heading === "Seniors (class of 2027): check these dates now")!;
    if (!("items" in seniors)) throw new Error("expected a list");
    expect(seniors.items.every((i) => typeof i === "string")).toBe(true);
    expect(seniors.itemStates?.[0]).toEqual(["TN"]);
    expect(contentForStates(section, ["TX"])).toEqual([
      { kind: "item", text: expect.stringMatching(/^Texas: File the FAFSA by Jan\. 15, 2027/), states: ["IL", "KY", "MO", "TX"] },
    ]);
    expect(sectionsForStates(loadGuide("en"), ["TN"]).map((s) => s.id)).toEqual([
      "fafsa-step-by-step",
      "state-aid-and-promise-programs",
      "training-programs-and-apprenticeships",
    ]);
    expect(stateNames(["IL", "KY", "TX"])).toBe("Illinois, Kentucky and Texas");
    // Spanish isn't tagged yet.
    expect(sectionsForStates(loadGuide("es"), ["TN"])).toEqual([]);
  });
});

describe("the guide's pages", () => {
  it("show a Tennessee student Tennessee's programs first", async () => {
    viewer.user = studentIn("TN");
    const html = await sectionPage("en", "state-aid-and-promise-programs");
    const first = panel(html);
    expect(first).toContain("For Tennessee");
    expect(first).toContain("Tennessee Promise (every step is required): Apply by Nov. 2, 2026.");
    expect(first).toContain("Tennessee Promise, continued");
    expect(first).not.toContain("Oklahoma's Promise");
    // The panel comes before the section's own blocks.
    expect(html.indexOf('id="for-your-state"')).toBeLessThan(html.indexOf('<h2 id="seniors-class-of-2027-check-these-dates-now"'));
    const index = await indexPage("en");
    expect(panel(index)).toContain("These parts of the guide have dates and programs for Tennessee");
    expect(index).toContain('href="/aid/en/state-aid-and-promise-programs"');
  });

  it("tag each state's items for everyone, visitors included", async () => {
    const html = await sectionPage("en", "state-aid-and-promise-programs");
    expect(panel(html)).toBe("");
    expect(text(html)).toContain("For Oklahoma Oklahoma's Promise");
    expect(text(html)).toContain("For Illinois, Kentucky, Missouri and Texas Texas: File the FAFSA");
  });

  it("point a student whose state the guide doesn't cover yet to finding their programs", async () => {
    viewer.user = studentIn("UT");
    const html = await sectionPage("en", "state-aid-and-promise-programs");
    expect(text(html)).toContain("This guide doesn't list Utah's own programs yet. Here's how to find them");
    expect(html).toContain('href="#find-your-state-s-programs"');
    expect(html).toContain('id="find-your-state-s-programs"');
    // Other sections don't mention it.
    expect(text(await sectionPage("en", "loans-wisely"))).not.toContain("doesn't list Utah");
    expect(panel(await indexPage("en"))).toContain("This guide doesn't list Utah's own programs yet.");
  });

  it("leave the Spanish guide and students without a state as they were", async () => {
    viewer.user = studentIn("TN");
    expect(panel(await sectionPage("es", "state-aid-and-promise-programs"))).toBe("");
    viewer.user = studentIn(null);
    expect(panel(await sectionPage("en", "state-aid-and-promise-programs"))).toBe("");
  });
});
