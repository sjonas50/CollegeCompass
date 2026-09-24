import { describe, expect, it } from "vitest";
import type { ApplicationChecklist, CollegeListStatus } from "@/db/schema";
import { buildTimeline, checklistProgress, isSubmitted } from "./timeline";

const entry = (name: string, deadline: string | null, status: CollegeListStatus = "applying", checklist: ApplicationChecklist = {}) => ({
  name,
  deadline,
  status,
  checklist,
});

describe("isSubmitted", () => {
  it("counts sent applications by status or by the checklist", () => {
    expect(isSubmitted(entry("A", null, "considering"))).toBe(false);
    expect(isSubmitted(entry("A", null, "applying"))).toBe(false);
    for (const status of ["applied", "accepted", "waitlisted", "not_accepted", "enrolling", "declined"] as const) {
      expect(isSubmitted(entry("A", null, status)), status).toBe(true);
    }
    expect(isSubmitted(entry("A", null, "applying", { applicationSubmitted: true }))).toBe(true);
    expect(isSubmitted({ status: "applying", checklist: null })).toBe(false);
  });
});

describe("checklistProgress", () => {
  it("counts checked items out of 8, ignoring unknown keys", () => {
    expect(checklistProgress({})).toEqual({ done: 0, total: 8 });
    expect(checklistProgress(null)).toEqual({ done: 0, total: 8 });
    expect(checklistProgress({ applicationSubmitted: true, transcriptRequested: true, depositPaid: false })).toEqual({ done: 2, total: 8 });
    expect(checklistProgress({ applicationSubmitted: true, madeUp: true } as ApplicationChecklist)).toEqual({ done: 1, total: 8 });
  });
});

describe("buildTimeline", () => {
  const today = "2026-09-24";

  it("sorts by date and groups past due, next 30 days and later", () => {
    const t = buildTimeline(
      [
        entry("Later U", "2027-01-15"),
        entry("Soon B", "2026-10-15"),
        entry("Soon A", "2026-10-15"),
        entry("Today U", "2026-09-24"),
        entry("Day 30", "2026-10-24"),
        entry("Day 31", "2026-10-25"),
        entry("Missed", "2026-09-01"),
        entry("No date", null),
      ],
      today,
    );
    expect(t.pastDue.map((i) => i.entry.name)).toEqual(["Missed"]);
    expect(t.pastDue[0].daysLeft).toBe(-23);
    expect(t.soon.map((i) => i.entry.name)).toEqual(["Today U", "Soon A", "Soon B", "Day 30"]);
    expect(t.later.map((i) => i.entry.name)).toEqual(["Day 31", "Later U"]);
  });

  it("drops past deadlines for applications already sent, and marks upcoming sent ones", () => {
    const t = buildTimeline(
      [entry("Sent late", "2026-09-01", "applied"), entry("Sent early", "2026-10-01", "applying", { applicationSubmitted: true })],
      today,
    );
    expect(t.pastDue).toEqual([]);
    expect(t.soon).toHaveLength(1);
    expect(t.soon[0]).toMatchObject({ submitted: true, daysLeft: 7 });
  });
});
