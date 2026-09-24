import { describe, expect, it } from "vitest";
import { type SubscriptionStatus, subscriptionStatusEnum } from "@/db/schema";
import { type BillingRow, DAY_MS, type GrantRow, addMonths, daysLeft, evaluateAccess, isGrantActive, subscriptionGrantsAccess } from "./entitlement";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const START = new Date("2026-09-01T15:00:00Z");
const at = (ms: number) => new Date(START.getTime() + ms);
const trial: GrantRow = { kind: "trial", startsAt: START, endsAt: at(14 * DAY_MS) };
const billing = (status: SubscriptionStatus | null, extra: Partial<BillingRow> = {}): BillingRow => ({
  status,
  plan: "monthly",
  currentPeriodEnd: at(30 * DAY_MS),
  cancelAtPeriodEnd: false,
  ...extra,
});
const evaluate = (grants: GrantRow[], now: Date, b: BillingRow | null = null) => evaluateAccess({ householdId: HOUSEHOLD, grants, billing: b }, now);

describe("grants", () => {
  it("run from their start up to (not including) their end", () => {
    expect(isGrantActive(trial, at(-1))).toBe(false);
    expect(isGrantActive(trial, START)).toBe(true);
    expect(isGrantActive(trial, at(14 * DAY_MS - 1))).toBe(true);
    expect(isGrantActive(trial, at(14 * DAY_MS))).toBe(false);
  });

  it("with no end never run out", () => {
    expect(isGrantActive({ startsAt: START, endsAt: null }, new Date("2040-01-01T00:00:00Z"))).toBe(true);
  });

  it("count days left rounded up, never below zero", () => {
    expect(daysLeft(at(14 * DAY_MS), START)).toBe(14);
    expect(daysLeft(at(14 * DAY_MS), at(13 * DAY_MS + 1))).toBe(1);
    expect(daysLeft(at(14 * DAY_MS), at(20 * DAY_MS))).toBe(0);
    expect(daysLeft(null, START)).toBeNull();
  });
});

describe("the trial", () => {
  it("gives full access for its 14 days and not a moment after", () => {
    const first = evaluate([trial], START);
    expect(first).toMatchObject({ full: true, sources: ["trial"], trial: { active: true, daysLeft: 14 } });
    expect(evaluate([trial], at(14 * DAY_MS - 1)).full).toBe(true);
    const after = evaluate([trial], at(14 * DAY_MS));
    expect(after).toMatchObject({ full: false, sources: [], trial: { active: false, daysLeft: 0 } });
  });

  it("doesn't start early", () => {
    expect(evaluate([trial], at(-60_000)).full).toBe(false);
  });
});

describe("free access", () => {
  const year = (from: Date): GrantRow => ({ kind: "free_access", startsAt: from, endsAt: addMonths(from, 12) });

  it("gives full access for its months, after the trial too", () => {
    const later = at(100 * DAY_MS);
    const access = evaluate([trial, year(at(10 * DAY_MS))], later);
    expect(access).toMatchObject({ full: true, sources: ["free_access"], trial: { active: false } });
    expect(access.freeAccess?.endsAt?.toISOString()).toBe("2027-09-11T15:00:00.000Z");
  });

  it("can be renewed only once fewer than 30 days are left", () => {
    const grant = year(START);
    const end = grant.endsAt!;
    const before = evaluate([grant], new Date(end.getTime() - 31 * DAY_MS));
    expect(before.canRenewFreeAccess).toBe(false);
    expect(before.freeAccessRenewableFrom?.toISOString()).toBe(new Date(end.getTime() - 30 * DAY_MS).toISOString());
    // Exactly 30 days left is not "fewer than 30".
    expect(evaluate([grant], new Date(end.getTime() - 30 * DAY_MS)).canRenewFreeAccess).toBe(false);
    const inside = evaluate([grant], new Date(end.getTime() - 29 * DAY_MS));
    expect(inside).toMatchObject({ full: true, canRenewFreeAccess: true, freeAccessRenewableFrom: null });
    // After it ends, it can be turned on again.
    expect(evaluate([grant], end)).toMatchObject({ full: false, canRenewFreeAccess: true });
  });

  it("counts the renewal that runs longest", () => {
    const first = year(START);
    const renewal: GrantRow = { kind: "free_access", startsAt: at(350 * DAY_MS), endsAt: addMonths(first.endsAt!, 12) };
    const access = evaluate([first, renewal], at(360 * DAY_MS));
    expect(access.freeAccess?.endsAt).toEqual(renewal.endsAt);
    expect(access.canRenewFreeAccess).toBe(false);
  });

  it("is available to ask for when the household never had it", () => {
    expect(evaluate([trial], START).canRenewFreeAccess).toBe(true);
    expect(evaluateAccess({ householdId: null, grants: [], billing: null }, START).canRenewFreeAccess).toBe(false);
  });
});

describe("subscriptions", () => {
  it("give access while active, trialing or past due (Stripe is retrying) and not otherwise", () => {
    const expected: Record<SubscriptionStatus, boolean> = {
      active: true,
      trialing: true,
      past_due: true,
      incomplete: false,
      incomplete_expired: false,
      canceled: false,
      unpaid: false,
      paused: false,
    };
    for (const status of subscriptionStatusEnum.enumValues) {
      expect(subscriptionGrantsAccess(status), status).toBe(expected[status]);
      const access = evaluate([], START, billing(status));
      expect(access.full, status).toBe(expected[status]);
      expect(access.subscription?.grantsAccess, status).toBe(expected[status]);
    }
    expect(subscriptionGrantsAccess(null)).toBe(false);
    expect(evaluate([], START, billing(null)).full).toBe(false);
  });

  it("keep access after the trial ends", () => {
    expect(evaluate([trial], at(40 * DAY_MS), billing("active"))).toMatchObject({ full: true, sources: ["subscription"] });
    expect(evaluate([trial], at(40 * DAY_MS), billing("canceled"))).toMatchObject({ full: false, sources: [] });
  });

  it("are listed first when several things give access", () => {
    const comp: GrantRow = { kind: "comp", startsAt: START, endsAt: null };
    const free: GrantRow = { kind: "free_access", startsAt: START, endsAt: addMonths(START, 12) };
    expect(evaluate([trial, free, comp], at(DAY_MS), billing("active")).sources).toEqual(["subscription", "comp", "free_access", "trial"]);
  });
});

describe("no household", () => {
  it("means no access, whatever rows are passed", () => {
    const access = evaluateAccess({ householdId: null, grants: [{ kind: "comp", startsAt: START, endsAt: null }], billing: billing("active") }, START);
    expect(access.full).toBe(false);
    expect(access.sources).toEqual([]);
  });
});

describe("addMonths", () => {
  it("keeps the day of the month, or uses the month's last day", () => {
    expect(addMonths(new Date("2026-09-24T18:00:00Z"), 12).toISOString()).toBe("2027-09-24T18:00:00.000Z");
    expect(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths(new Date("2028-02-29T12:00:00Z"), 12).toISOString()).toBe("2029-02-28T12:00:00.000Z");
    expect(addMonths(new Date("2026-03-31T00:00:00Z"), 1).toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });
});
