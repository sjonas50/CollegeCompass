import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { accessGrants, billingAccounts, households, users } from "@/db/schema";
import { env } from "@/env";
import { audit } from "../audit";
import { isUnder13 } from "../auth/age";
import {
  type BillingRow,
  DAY_MS,
  type GrantRow,
  type HouseholdAccess,
  addMonths,
  evaluateAccess,
  freeAccessRenewalOpens,
  isGrantActive,
} from "./entitlement";

// ---------------------------------------------------------------------------
// Reading access
// ---------------------------------------------------------------------------

async function loadAccessRows(db: Db, householdId: string): Promise<{ grants: GrantRow[]; billing: BillingRow | null }> {
  const [grants, billing] = await Promise.all([
    db
      .select({ kind: accessGrants.kind, startsAt: accessGrants.startsAt, endsAt: accessGrants.endsAt })
      .from(accessGrants)
      .where(eq(accessGrants.householdId, householdId)),
    db
      .select({
        status: billingAccounts.status,
        plan: billingAccounts.plan,
        currentPeriodEnd: billingAccounts.currentPeriodEnd,
        cancelAtPeriodEnd: billingAccounts.cancelAtPeriodEnd,
      })
      .from(billingAccounts)
      .where(eq(billingAccounts.householdId, householdId)),
  ]);
  return { grants, billing: billing[0] ?? null };
}

/**
 * A household's access right now. Households from before trials existed (no grants and no billing
 * account, ever) get their trial here, starting at this first check, once.
 */
export async function getHouseholdAccess(db: Db, householdId: string, now = new Date()): Promise<HouseholdAccess> {
  let rows = await loadAccessRows(db, householdId);
  if (rows.grants.length === 0 && !rows.billing && (await startFirstCheckTrial(db, householdId, now))) {
    rows = await loadAccessRows(db, householdId);
  }
  return evaluateAccess({ householdId, ...rows }, now);
}

/**
 * The access of the household `userId` belongs to. This is the check for every gated page, action
 * and route: it reads the household from the database, not from the session.
 */
export async function getUserAccess(db: Db, userId: string, now = new Date()): Promise<HouseholdAccess> {
  const [user] = await db.select({ householdId: users.householdId }).from(users).where(eq(users.id, userId));
  if (!user?.householdId) return evaluateAccess({ householdId: null, grants: [], billing: null }, now);
  return getHouseholdAccess(db, user.householdId, now);
}

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

/** The trial grant for a household created at `startsAt` (TRIAL_DAYS long). */
export function trialGrant(householdId: string, startsAt: Date, grantedByUserId: string | null = null) {
  return {
    householdId,
    kind: "trial" as const,
    startsAt,
    endsAt: new Date(startsAt.getTime() + env().TRIAL_DAYS * DAY_MS),
    grantedByUserId,
  };
}

/** Records a new household's trial. Called after the household (and its first user) is created. */
export async function auditTrialStarted(db: Db, userId: string | null, firstCheck = false) {
  await audit(db, "access.trial_started", {
    subjectUserId: userId,
    metadata: firstCheck ? { days: env().TRIAL_DAYS, firstCheck: true } : { days: env().TRIAL_DAYS },
  });
}

/** Starts a trial for a household that has never had a grant or a billing account. */
async function startFirstCheckTrial(db: Db, householdId: string, now: Date): Promise<boolean> {
  const started = await db.transaction(async (tx) => {
    // Locking the household makes "once" hold when two requests check at the same moment.
    const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
    if (!household) return false;
    const [grant] = await tx.select({ id: accessGrants.id }).from(accessGrants).where(eq(accessGrants.householdId, householdId)).limit(1);
    const [billing] = await tx
      .select({ id: billingAccounts.householdId })
      .from(billingAccounts)
      .where(eq(billingAccounts.householdId, householdId));
    if (grant || billing) return false;
    await tx.insert(accessGrants).values(trialGrant(householdId, now));
    return true;
  });
  if (started) await auditTrialStarted(db, null, true);
  return started;
}

// ---------------------------------------------------------------------------
// Free access
// ---------------------------------------------------------------------------

export type FreeAccessError =
  /** Only parents and students can ask. */
  | "not_allowed"
  /** Students under 13 ask their parent. */
  | "under_13"
  | "no_household"
  /** Free access is already on, with 30 or more days left. */
  | "not_yet_renewable";

export type FreeAccessEligibility =
  | { ok: true; access: HouseholdAccess }
  | { ok: false; error: FreeAccessError; access: HouseholdAccess | null };

/**
 * Whether `userId` may turn on (or renew) free access for their household: parents, and students 13
 * or older. No documents and no reasons are asked for or stored.
 */
export async function freeAccessEligibility(db: Db, userId: string, now = new Date()): Promise<FreeAccessEligibility> {
  const [user] = await db
    .select({ role: users.role, birthDate: users.birthDate, householdId: users.householdId })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return { ok: false, error: "not_allowed", access: null };
  const access = user.householdId ? await getHouseholdAccess(db, user.householdId, now) : null;
  if (user.role !== "parent" && user.role !== "student") return { ok: false, error: "not_allowed", access };
  // A student without a birth date on file is treated as under 13.
  if (user.role === "student" && (!user.birthDate || isUnder13(user.birthDate, now))) {
    return { ok: false, error: "under_13", access };
  }
  if (!access) return { ok: false, error: "no_household", access: null };
  if (!access.canRenewFreeAccess) return { ok: false, error: "not_yet_renewable", access };
  return { ok: true, access };
}

export type FreeAccessResult =
  | { ok: true; endsAt: Date; renewal: boolean }
  | { ok: false; error: FreeAccessError; renewableFrom?: Date | null };

/**
 * Turns on FREE_ACCESS_MONTHS of full access for the user's household, or renews it in its last 30
 * days (see freeAccessRenewalOpens). A renewal adds the months to the current end date, so renewing
 * early never costs days.
 */
export async function grantFreeAccess(db: Db, userId: string, now = new Date()): Promise<FreeAccessResult> {
  const eligible = await freeAccessEligibility(db, userId, now);
  if (!eligible.ok) return { ok: false, error: eligible.error, renewableFrom: eligible.access?.freeAccessRenewableFrom ?? null };
  const householdId = eligible.access.householdId!;
  const months = env().FREE_ACCESS_MONTHS;

  const result = await db.transaction(async (tx): Promise<FreeAccessResult> => {
    await tx.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
    // Re-read under the lock, so two submissions at once can't both add a year.
    const running = (
      await tx
        .select({ startsAt: accessGrants.startsAt, endsAt: accessGrants.endsAt })
        .from(accessGrants)
        .where(and(eq(accessGrants.householdId, householdId), eq(accessGrants.kind, "free_access")))
        .orderBy(desc(accessGrants.endsAt))
    ).filter((g) => isGrantActive(g, now));
    const current = running[0] ?? null;
    const opens = current?.endsAt ? freeAccessRenewalOpens(current.endsAt) : null;
    if (current && (opens === null || now.getTime() < opens.getTime())) {
      return { ok: false, error: "not_yet_renewable", renewableFrom: opens };
    }
    const endsAt = addMonths(current?.endsAt ?? now, months);
    await tx.insert(accessGrants).values({ householdId, kind: "free_access", startsAt: now, endsAt, grantedByUserId: userId });
    return { ok: true, endsAt, renewal: current !== null };
  });

  if (result.ok) {
    await audit(db, "access.free_access_granted", { actorUserId: userId, metadata: { months, renewal: result.renewal } });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * The household's access for a student's data export: each grant's kind and dates, and the
 * subscription's status, plan and period end. Stripe ids and who granted what are left out.
 */
export async function exportHouseholdAccess(db: Db, householdId: string | null, now = new Date()) {
  if (!householdId) return { fullAccess: false, grants: [], subscription: null };
  const [grants, billing] = await Promise.all([
    db
      .select({ kind: accessGrants.kind, startsAt: accessGrants.startsAt, endsAt: accessGrants.endsAt })
      .from(accessGrants)
      .where(eq(accessGrants.householdId, householdId))
      .orderBy(accessGrants.startsAt, accessGrants.createdAt),
    db
      .select({
        status: billingAccounts.status,
        plan: billingAccounts.plan,
        currentPeriodEnd: billingAccounts.currentPeriodEnd,
        cancelAtPeriodEnd: billingAccounts.cancelAtPeriodEnd,
      })
      .from(billingAccounts)
      .where(eq(billingAccounts.householdId, householdId)),
  ]);
  const access = evaluateAccess({ householdId, grants, billing: billing[0] ?? null }, now);
  return { fullAccess: access.full, grants, subscription: billing[0] ?? null };
}

/**
 * Which of these households have full access now, in two queries (for batch jobs like the weekly
 * reminder emails). Unlike getHouseholdAccess, it never starts a first-check trial.
 */
export async function householdsWithFullAccess(db: Db, householdIds: string[], now = new Date()): Promise<Set<string>> {
  const ids = [...new Set(householdIds)];
  if (!ids.length) return new Set();
  const [grants, billing] = await Promise.all([
    db
      .select({ householdId: accessGrants.householdId, kind: accessGrants.kind, startsAt: accessGrants.startsAt, endsAt: accessGrants.endsAt })
      .from(accessGrants)
      .where(inArray(accessGrants.householdId, ids)),
    db
      .select({
        householdId: billingAccounts.householdId,
        status: billingAccounts.status,
        plan: billingAccounts.plan,
        currentPeriodEnd: billingAccounts.currentPeriodEnd,
        cancelAtPeriodEnd: billingAccounts.cancelAtPeriodEnd,
      })
      .from(billingAccounts)
      .where(inArray(billingAccounts.householdId, ids)),
  ]);
  const full = new Set<string>();
  for (const householdId of ids) {
    const access = evaluateAccess(
      {
        householdId,
        grants: grants.filter((g) => g.householdId === householdId),
        billing: billing.find((b) => b.householdId === householdId) ?? null,
      },
      now,
    );
    if (access.full) full.add(householdId);
  }
  return full;
}
