// Plain-language words for a household's access, shared by the account pages, the counselor and
// the counselor API.

import type { HouseholdAccess } from "./entitlement";

/** Shown wherever a student meets a lock. Crisis help is never behind one. */
export const CRISIS_LINE = "If you're going through something hard, call or text 988 any time.";

/** Where a locked student learns what's still free and how to unlock the rest. */
export const UNLOCK_PATH = "/account/access";
/** A parent's plan, billing and free access. */
export const BILLING_PATH = "/account/billing";
export const FREE_ACCESS_PATH = "/account/free-access";

/** What the counselor API says when the household doesn't have full access. */
export const LOCKED_COUNSELOR_NOTICE = `Chatting with the counselor is part of full access, and your family's access isn't on right now. ${CRISIS_LINE}`;

/** Parts of College Compass that never need full access. */
export const FREE_FEATURES: { href: string; label: string }[] = [
  { href: "/dashboard", label: "Your dashboard and the three discovery activities" },
  { href: "/discover/results", label: "Your results and career matches" },
  { href: "/careers", label: "Exploring careers" },
  { href: "/colleges", label: "Searching colleges and training programs" },
  { href: "/aid", label: "The guide to paying for college" },
  { href: "/privacy", label: "Privacy, settings, and your data" },
];

/** Parts that need full access. */
export const FULL_ACCESS_FEATURES = [
  "Your AI counselor",
  "Your class plan",
  "Your roadmap and weekly steps",
  "Your college list and application tracker",
];

const PLAN_NAMES = { monthly: "monthly", annual: "yearly" } as const;

/**
 * The day something ends, like "October 8, 2026", in Pacific time (the latest mainland US time
 * zone), so no family is told it lasts longer than it does.
 */
export function formatAccessDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric", year: "numeric" }).format(date);
}

/**
 * The day something becomes possible, like "you can renew it starting August 25, 2027". These start
 * at midnight UTC (see freeAccessRenewalOpens), which is the evening before everywhere in the US,
 * so the day is shown as a UTC calendar day: by the time it begins for a family, it has started.
 */
export function formatStartDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(date);
}

function daysText(days: number) {
  return days <= 1 ? "less than a day" : `${days} days`;
}

export type AccessSummary = {
  /** One short sentence about the household's access now. */
  headline: string;
  /** A second sentence with dates or what to do, if any. */
  detail?: string;
  tone: "ok" | "attention" | "locked";
};

/**
 * One or two sentences about a household's access, worded for a student ("your family") or for
 * the parent who manages it ("you").
 */
export function describeAccess(access: HouseholdAccess, audience: "student" | "parent"): AccessSummary {
  const parent = audience === "parent";
  const sub = access.subscription;
  const [source] = access.sources;

  if (source === "subscription" && sub) {
    const plan = sub.plan ? `${PLAN_NAMES[sub.plan]} ` : "";
    if (sub.status === "past_due") {
      return parent
        ? {
            headline: "Your last payment didn't go through.",
            detail: "Stripe will try again. Update your card in Manage billing so your family keeps full access.",
            tone: "attention",
          }
        : {
            headline: "Your family's plan is on, but a payment needs attention.",
            detail: "Ask your parent or guardian to check billing in their account.",
            tone: "attention",
          };
    }
    const end = sub.currentPeriodEnd ? formatAccessDate(sub.currentPeriodEnd) : null;
    if (sub.cancelAtPeriodEnd) {
      return {
        headline: parent ? `Your ${plan}plan is set to end${end ? ` on ${end}` : ""}.` : `Your family's plan ends${end ? ` on ${end}` : " soon"}.`,
        detail: parent ? "You can keep it going from Manage billing." : undefined,
        tone: "attention",
      };
    }
    return {
      headline: parent ? `Your ${plan}plan is active.` : "Your family has a College Compass plan. Everything is unlocked.",
      detail: parent && end ? `It renews on ${end}.` : undefined,
      tone: "ok",
    };
  }

  if ((source === "sponsored" || source === "comp") && access.other) {
    const end = access.other.endsAt ? ` until ${formatAccessDate(access.other.endsAt)}` : "";
    return { headline: parent ? `Your family has full access${end}.` : `Your family has full access${end}. Everything is unlocked.`, tone: "ok" };
  }

  if (source === "free_access" && access.freeAccess) {
    const end = access.freeAccess.endsAt;
    return {
      headline: end ? `Your family has free access until ${formatAccessDate(end)}.` : "Your family has free access.",
      detail: access.canRenewFreeAccess ? "It ends soon, and it can be renewed now." : undefined,
      tone: access.canRenewFreeAccess ? "attention" : "ok",
    };
  }

  if (source === "trial" && access.trial) {
    const { endsAt, daysLeft } = access.trial;
    if (endsAt === null || daysLeft === null) return { headline: "Your free trial is on.", tone: "ok" };
    return {
      headline: `Your free trial has ${daysText(daysLeft)} left.`,
      detail: `It ends on ${formatAccessDate(endsAt)}.`,
      tone: daysLeft <= 3 ? "attention" : "ok",
    };
  }

  // Locked: say what ended most recently. A checkout that never finished isn't a plan that ended.
  const endings: { text: string; at: number }[] = [];
  if (sub?.status === "paused") {
    endings.push({ text: parent ? "Your plan is paused." : "Your family's plan is paused.", at: Infinity });
  } else if (sub?.status === "canceled" || sub?.status === "unpaid") {
    endings.push({ text: parent ? "Your plan has ended." : "Your family's plan has ended.", at: sub.currentPeriodEnd?.getTime() ?? Infinity });
  }
  if (access.freeAccess?.endsAt) {
    endings.push({ text: `Your family's free access ended on ${formatAccessDate(access.freeAccess.endsAt)}.`, at: access.freeAccess.endsAt.getTime() });
  }
  if (access.trial?.endsAt) {
    endings.push({ text: `Your free trial ended on ${formatAccessDate(access.trial.endsAt)}.`, at: access.trial.endsAt.getTime() });
  }
  const latest = endings.sort((a, b) => b.at - a.at)[0];
  return { headline: latest?.text ?? "Your family doesn't have full access right now.", tone: "locked" };
}

/**
 * What a parent can do on Plan and billing, for the card that links there: a plan only while paid
 * plans are on (`plansOffered`), and free access only when it can be turned on or renewed.
 */
export function billingCardNote(access: HouseholdAccess, plansOffered: boolean): string {
  if (access.sources[0] === "subscription") return "See or change your family's plan.";
  if (access.freeAccess?.active) {
    return access.canRenewFreeAccess ? "You can renew your free access there now." : "See when your free access ends and when you can renew it.";
  }
  if (access.full && access.sources[0] !== "trial") return "See your family's access.";
  return plansOffered
    ? "Choose a plan for your family. If cost is a problem, you can turn on free access there."
    : "Paid plans aren't available yet, but you can turn on free access there.";
}
