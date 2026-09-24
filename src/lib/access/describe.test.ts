import { describe, expect, it } from "vitest";
import type { SubscriptionStatus } from "@/db/schema";
import { CRISIS_LINE, LOCKED_COUNSELOR_NOTICE, describeAccess, formatAccessDate, formatStartDate } from "./describe";
import { type BillingRow, DAY_MS, type GrantRow, addMonths, evaluateAccess } from "./entitlement";

const NOW = new Date("2026-09-24T18:00:00Z");
const H = "00000000-0000-4000-8000-000000000001";
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const trialFrom = (start: Date): GrantRow => ({ kind: "trial", startsAt: start, endsAt: new Date(start.getTime() + 14 * DAY_MS) });
const sub = (status: SubscriptionStatus, extra: Partial<BillingRow> = {}): BillingRow => ({
  status,
  plan: "annual",
  currentPeriodEnd: new Date("2027-09-24T18:00:00Z"),
  cancelAtPeriodEnd: false,
  ...extra,
});
const describeFor = (grants: GrantRow[], billing: BillingRow | null, audience: "student" | "parent" = "student") =>
  describeAccess(evaluateAccess({ householdId: H, grants, billing }, NOW), audience);

describe("describeAccess", () => {
  it("counts down a trial", () => {
    expect(describeFor([trialFrom(ago(4))], null)).toEqual({
      headline: "Your free trial has 10 days left.",
      detail: "It ends on October 4, 2026.",
      tone: "ok",
    });
    expect(describeFor([trialFrom(new Date(NOW.getTime() - 14 * DAY_MS + 3_600_000))], null)).toMatchObject({
      headline: "Your free trial has less than a day left.",
      tone: "attention",
    });
  });

  it("says when a trial ended", () => {
    expect(describeFor([trialFrom(ago(30))], null)).toEqual({ headline: "Your free trial ended on September 8, 2026.", tone: "locked" });
  });

  it("gives free access's end date, and says when it can be renewed", () => {
    const free: GrantRow = { kind: "free_access", startsAt: ago(100), endsAt: addMonths(ago(100), 12) };
    expect(describeFor([free], null)).toMatchObject({ headline: "Your family has free access until June 16, 2027.", tone: "ok" });
    const ending: GrantRow = { kind: "free_access", startsAt: ago(350), endsAt: new Date(NOW.getTime() + 10 * DAY_MS) };
    expect(describeFor([ending], null)).toMatchObject({ detail: "It ends soon, and it can be renewed now.", tone: "attention" });
    const ended: GrantRow = { kind: "free_access", startsAt: ago(400), endsAt: ago(35) };
    expect(describeFor([trialFrom(ago(420)), ended], null).headline).toBe("Your family's free access ended on August 20, 2026.");
  });

  it("describes a plan to a parent and to a student", () => {
    expect(describeFor([], sub("active"), "parent")).toEqual({ headline: "Your yearly plan is active.", detail: "It renews on September 24, 2027.", tone: "ok" });
    expect(describeFor([], sub("active"), "student").headline).toBe("Your family has a College Compass plan. Everything is unlocked.");
    expect(describeFor([], sub("active", { cancelAtPeriodEnd: true }), "parent")).toMatchObject({
      headline: "Your yearly plan is set to end on September 24, 2027.",
      tone: "attention",
    });
    expect(describeFor([], sub("past_due"), "parent")).toMatchObject({ headline: "Your last payment didn't go through.", tone: "attention" });
    expect(describeFor([], sub("past_due"), "student").detail).toBe("Ask your parent or guardian to check billing in their account.");
  });

  it("says a plan ended, but not for a checkout that never finished", () => {
    expect(describeFor([trialFrom(ago(60))], sub("canceled", { currentPeriodEnd: ago(5) }), "parent").headline).toBe("Your plan has ended.");
    expect(describeFor([trialFrom(ago(60))], sub("incomplete_expired"), "parent").headline).toBe("Your free trial ended on August 9, 2026.");
    expect(describeFor([], null).headline).toBe("Your family doesn't have full access right now.");
  });

  it("formats end dates in US Pacific time, and start dates as UTC calendar days", () => {
    expect(formatAccessDate(new Date("2026-10-09T05:00:00Z"))).toBe("October 8, 2026");
    // Midnight UTC is the evening before in the US: the day shown has begun everywhere by then.
    expect(formatStartDate(new Date("2027-08-25T00:00:00Z"))).toBe("August 25, 2027");
  });

  it("keeps the crisis line in the counselor's locked notice", () => {
    expect(LOCKED_COUNSELOR_NOTICE).toContain(CRISIS_LINE);
    expect(CRISIS_LINE).toBe("If you're going through something hard, call or text 988 any time.");
  });
});
