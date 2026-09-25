import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { accessGrants, billingAccounts, households, parentInvites, parentStudentLinks, users } from "@/db/schema";
import { type AccessSource, type HouseholdAccess, evaluateAccess, isGrantActive, subscriptionGrantsAccess } from "./access/entitlement";
import { formatAccessDate } from "./access/describe";
import { audit } from "./audit";
import { isUnder13 } from "./auth/age";
import { type PasswordChangeError, preparePasswordChange, savePasswordChange } from "./auth/change-password";
import type { SessionUser } from "./auth/sessions";
import { queueCleanup, runQueuedCleanup } from "./billing/cleanup";
import { type Stripe, errorName, getStripe } from "./billing/stripe";

// A student sees the parents or guardians linked to their account, and a teen who owns their
// account can remove one: say, when a forwarded invitation reached the wrong adult. Removing
// unlinks them and gives the teen a household of their own. The parent keeps their household, its
// plan and everything else that's theirs; the teen takes what's theirs: the free access they turned
// on and grants given for them. A parent who set the account up chose its password, so removing
// them takes a new one.

type Grant = typeof accessGrants.$inferSelect;
type Billing = typeof billingAccounts.$inferSelect;

/**
 * A parent who set up the account (the only way to get a username login) chose its password,
 * unless they were linked later by an invitation the student sent.
 */
function parentChosePassword(student: { username: string | null }, acceptedInvite: boolean): boolean {
  return Boolean(student.username) && !acceptedInvite;
}

// ---------------------------------------------------------------------------
// What goes with the teen
// ---------------------------------------------------------------------------

const notEnded = (g: Grant, now: Date) => g.endsAt === null || g.endsAt.getTime() > now.getTime();
const endOf = (g: Grant) => g.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;

/**
 * The household's grants, split for a student who leaves it:
 * - `moved`: the student's own. Free access they turned on (running or ended), and grants given
 *   for them (forUserId) that haven't ended: a sponsorship or comp staff gave them, the time paid
 *   on their old plan, or the trial they brought along;
 * - `trial`: the family's trial while it's running, copied with the same dates when it runs longer
 *   than any trial of theirs, so the student keeps the days left but never gets more;
 * - `staying`: everything else. The plan, free access someone else turned on, and sponsored or
 *   comp access given to the whole family.
 */
function carriedGrants(grants: Grant[], studentId: string, now: Date) {
  const theirs = (g: Grant) => (g.kind === "free_access" && g.grantedByUserId === studentId) || (g.forUserId === studentId && notEnded(g, now));
  const moved = grants.filter(theirs);
  const staying = grants.filter((g) => !theirs(g));
  const ownTrialEnd = Math.max(Number.NEGATIVE_INFINITY, ...moved.filter((g) => g.kind === "trial" && isGrantActive(g, now)).map(endOf));
  const family = staying.filter((g) => g.kind === "trial" && isGrantActive(g, now));
  const longest = family.reduce<Grant | null>((best, g) => (!best || endOf(g) > endOf(best) ? g : best), null);
  return { moved, staying, trial: longest && endOf(longest) > ownTrialEnd ? longest : null };
}

// ---------------------------------------------------------------------------
// What the student sees
// ---------------------------------------------------------------------------

/** What removing a parent would do to the student's access (see removalAccessNote). */
export type RemovalAccess =
  /** The student doesn't share a household with this parent, so their access doesn't change. */
  | { kind: "unchanged" }
  | {
      kind: "split";
      /** The shared household's access now. */
      now: HouseholdAccess;
      /** The student's access in a household of their own afterwards. */
      after: HouseholdAccess;
      /** The first thing giving full access now that stays with the parent's household, if any. */
      leftBehind: AccessSource | null;
      /** The student is 13 or older, so they could turn on free access themselves. */
      canTurnOnFreeAccess: boolean;
    };

/**
 * How the student sees a link: an invitation they sent (with the address they typed), or their
 * parent set up the account (and so chose its password).
 */
export type LinkOrigin = { kind: "invite"; sentTo: string | null } | { kind: "set_up" } | { kind: "other" };

export type LinkedParent = {
  id: string;
  displayName: string;
  linkedAt: Date;
  origin: LinkOrigin;
  /** Null when the student can't remove them: a child the parent set up under 13 (parentManaged). */
  removal: RemovalAccess | null;
};

/** Removing a parent the student shares a household with splits it like this (see carriedGrants). */
function splitAccess(
  household: { id: string; grants: Grant[]; billing: Billing | null },
  studentId: string,
  canTurnOnFreeAccess: boolean,
  now: Date,
): RemovalAccess {
  const { id: householdId, grants, billing } = household;
  const { moved, staying, trial } = carriedGrants(grants, studentId, now);
  const shared = evaluateAccess({ householdId, grants, billing }, now);
  const after = evaluateAccess({ householdId, grants: trial ? [...moved, trial] : moved, billing: null }, now);
  // A trial on the parent's side isn't lost: the student keeps its days.
  const stays = evaluateAccess({ householdId, grants: staying, billing }, now);
  const leftBehind = stays.sources.find((s) => s !== "trial") ?? null;
  return { kind: "split", now: shared, after, leftBehind, canTurnOnFreeAccess };
}

/** The signed-in student, as their session has them. */
export type LinkedStudent = Pick<SessionUser, "id" | "role" | "parentManaged" | "householdId" | "username">;

/**
 * The parents and guardians linked to a student, oldest link first, for that student's own
 * Settings: pass the signed-in student, never anyone else. Each shows how they were linked (for an
 * invitation, the address the student typed) and, unless a parent set the account up under 13,
 * what removing them would do to the student's access. Two round trips, however many parents.
 */
export async function listLinkedParents(db: Db, student: LinkedStudent, now = new Date()): Promise<LinkedParent[]> {
  if (student.role !== "student" || !z.uuid().safeParse(student.id).success) return [];
  const parents = await db
    .select({ id: users.id, displayName: users.displayName, householdId: users.householdId, linkedAt: parentStudentLinks.createdAt })
    .from(parentStudentLinks)
    .innerJoin(users, eq(users.id, parentStudentLinks.parentUserId))
    .where(eq(parentStudentLinks.studentUserId, student.id))
    .orderBy(asc(parentStudentLinks.createdAt), asc(users.id));
  if (!parents.length) return [];

  // Every parent the student shares a household with splits it the same way, so it's read once.
  const from = student.householdId;
  const splits = !student.parentManaged && from !== null && parents.some((p) => p.householdId === from);
  const [invites, grants, [billing], [row]] = await Promise.all([
    db
      .select({ acceptedByUserId: parentInvites.acceptedByUserId, sentTo: parentInvites.sentTo })
      .from(parentInvites)
      .where(
        and(
          eq(parentInvites.studentUserId, student.id),
          isNotNull(parentInvites.acceptedAt),
          inArray(
            parentInvites.acceptedByUserId,
            parents.map((p) => p.id),
          ),
        ),
      )
      .orderBy(desc(parentInvites.acceptedAt)),
    splits ? db.select().from(accessGrants).where(eq(accessGrants.householdId, from)) : Promise.resolve([]),
    splits ? db.select().from(billingAccounts).where(eq(billingAccounts.householdId, from)) : Promise.resolve([]),
    splits ? db.select({ birthDate: users.birthDate }).from(users).where(eq(users.id, student.id)) : Promise.resolve([]),
  ]);
  const split =
    splits && from
      ? splitAccess({ id: from, grants, billing: billing ?? null }, student.id, Boolean(row?.birthDate && !isUnder13(row.birthDate, now)), now)
      : null;

  return parents.map((p): LinkedParent => {
    const invite = invites.find((i) => i.acceptedByUserId === p.id);
    const origin: LinkOrigin = invite
      ? { kind: "invite", sentTo: invite.sentTo }
      : parentChosePassword(student, false)
        ? { kind: "set_up" }
        : { kind: "other" };
    const removal: RemovalAccess | null = student.parentManaged ? null : split && p.householdId === from ? split : { kind: "unchanged" };
    return { id: p.id, displayName: p.displayName, linkedAt: p.linkedAt, origin, removal };
  });
}

const dateOf = (d: Date | null | undefined) => (d ? formatAccessDate(d) : null);

/**
 * What the confirm step tells the teen about their access, before they remove `name`. It matches
 * removeLinkedParent: the plan and anything else on the parent's side stays there; free access the
 * teen turned on, grants given for them and the days left on a running trial come along. Sponsored
 * or comp access given to the whole family stays with it, and isn't credited to the parent: it may
 * have been meant for the teen, so they're told to contact us.
 */
export function removalAccessNote(name: string, removal: RemovalAccess): string {
  if (removal.kind === "unchanged") return "Your access stays the same.";
  const { now, after, leftBehind, canTurnOnFreeAccess } = removal;
  if (!now.full) return `Your family doesn't have full access right now. Removing ${name} won't change that.`;

  const given = leftBehind === "sponsored" || leftBehind === "comp";
  const askUs = "If it was meant for you, contact us and we'll help.";
  const theirs =
    leftBehind === "subscription"
      ? `${name}'s plan stays with them.`
      : leftBehind === "free_access"
        ? `The free access on ${name}'s account stays with them.`
        : given
          ? `The full access given to the family account you share with ${name} stays with that account. ${askUs}`
          : null;
  const turnOn = "you can turn on free access yourself. It's free, and you won't need any documents.";

  if (after.full) {
    const kept = after.sources[0];
    const keep =
      kept === "sponsored" || kept === "comp"
        ? `You keep the full access given to you${dateOf(after.other?.endsAt) ? `. It lasts until ${dateOf(after.other?.endsAt)}` : ""}.`
        : kept === "free_access"
          ? `You keep the free access you turned on${dateOf(after.freeAccess?.endsAt) ? `. It lasts until ${dateOf(after.freeAccess?.endsAt)}` : ""}.`
          : `You keep your free trial${dateOf(after.trial?.endsAt) ? `. It ends on ${dateOf(after.trial?.endsAt)}` : ""}.`;
    const later = kept === "trial" && canTurnOnFreeAccess ? ` After that, ${turnOn}` : "";
    return `${theirs ? `${theirs} ` : ""}${keep}${later}`;
  }

  const next = canTurnOnFreeAccess
    ? `After you remove them, ${turnOn}`
    : "After you remove them, you won't have full access. Your activities, career matches and college search stay free.";
  if (given) return `Your full access was given to the family account you share with ${name}, and it stays with that account. ${askUs} ${next}`;
  const source = leftBehind === "subscription" ? `${name}'s plan` : leftBehind === "free_access" ? `free access on ${name}'s account` : `${name}'s account`;
  return `Your full access comes from ${source}, and it stays with them. ${next}`;
}

// ---------------------------------------------------------------------------
// Removing
// ---------------------------------------------------------------------------

export type RemoveParentError =
  /** Not a student account. */
  | "not_found"
  /** A child a parent set up under 13: that parent manages the account. */
  | "parent_managed"
  /** That parent isn't linked to this student (already removed, or never was). */
  | "not_linked"
  /** That parent set up the account and chose its password, so removing them takes a new one. */
  | "password_required"
  /** The new password wasn't accepted (see preparePasswordChange). */
  | Exclude<PasswordChangeError, "not_found" | "parent_managed">;

export type RemoveParentResult =
  | {
      ok: true;
      /** The student moved out of the household they shared with the parent, into a new one. */
      householdMoved: boolean;
      /** Grants that came along: free access the student turned on and grants given for them. */
      grantsMoved: number;
      /** The days left on a running trial came along. */
      trialCarried: boolean;
      /** The parent's plan is set to end at its period end: it no longer covers any student. */
      planEnding: boolean;
      /** The student's password changed, and every session ended: the caller starts a new one. */
      passwordChanged: boolean;
    }
  | { ok: false; error: RemoveParentError };

/**
 * A teen who owns their account removes a linked parent or guardian. Call it only with the signed-in
 * student's own id. A child a parent set up under 13 (parentManaged) can't: that parent manages the
 * account.
 *
 * - A parent who set up the account chose its password, so removing them takes a new one
 *   (`password`: the current one and the new one). It's saved in the same transaction, and every
 *   session ends, so that parent can't sign in as the teen afterwards. A new password given when
 *   it isn't needed is saved too.
 * - The link goes, so the parent no longer sees the teen or acts for them. The invitation that
 *   parent accepted goes too, with the address the teen typed, so its link stops working.
 * - When they share a household (they do once linked), the teen moves to a new household of their
 *   own with what's theirs (see carriedGrants): free access they turned on, grants given for them,
 *   and the days left on a running trial (copied, never extended). The plan and everything else
 *   stays with the parent's household. A household that would otherwise have no grants gets a
 *   trial of no length, so a new one isn't started for it (see getHouseholdAccess): removing a
 *   parent never starts a new trial.
 * - If the teen was the household's last student, a plan that renews is set to end with the period
 *   it's paid through. The parent keeps the time they paid for. The Stripe change is queued in the
 *   same transaction and tried right after it, so a crash in between leaves it to the daily sweep;
 *   a failure there never undoes or hides the removal.
 *
 * Nothing is emailed to the parent. The audit entry, written with the removal, holds only ids,
 * counts and yes/no answers.
 */
export async function removeLinkedParent(
  db: Db,
  studentId: string,
  parentId: string,
  deps: { stripe?: Stripe | null; now?: Date; password?: { current: string; next: string } } = {},
): Promise<RemoveParentResult> {
  const now = deps.now ?? new Date();
  if (!z.uuid().safeParse(studentId).success) return { ok: false, error: "not_found" };
  if (!z.uuid().safeParse(parentId).success) return { ok: false, error: "not_linked" };
  const fail = (error: RemoveParentError) => ({ ok: false as const, error });

  // Checked (and the new one hashed) before the transaction: it's slow on purpose.
  const prepared = deps.password ? await preparePasswordChange(db, studentId, deps.password, now) : null;
  if (prepared && !prepared.ok) return fail(prepared.error);

  const result = await db.transaction(async (tx) => {
    // Locked, so a second click (or a second tab) waits and then finds no link.
    const [student] = await tx
      .select({ role: users.role, parentManaged: users.parentManaged, householdId: users.householdId, username: users.username })
      .from(users)
      .where(eq(users.id, studentId))
      .for("update");
    if (!student || student.role !== "student") return fail("not_found");
    if (student.parentManaged) return fail("parent_managed");

    const [link] = await tx
      .select({ parentId: parentStudentLinks.parentUserId })
      .from(parentStudentLinks)
      .where(and(eq(parentStudentLinks.studentUserId, studentId), eq(parentStudentLinks.parentUserId, parentId)));
    if (!link) return fail("not_linked");
    const [invite] = await tx
      .select({ id: parentInvites.id })
      .from(parentInvites)
      .where(and(eq(parentInvites.studentUserId, studentId), eq(parentInvites.acceptedByUserId, parentId), isNotNull(parentInvites.acceptedAt)))
      .limit(1);
    if (parentChosePassword(student, Boolean(invite)) && !prepared) return fail("password_required");
    // Nothing is written before this point, so returning a failure saves nothing.
    if (prepared && !(await savePasswordChange(tx, prepared.change))) return fail("wrong_password");
    const passwordChanged = Boolean(prepared);

    await tx.delete(parentStudentLinks).where(and(eq(parentStudentLinks.studentUserId, studentId), eq(parentStudentLinks.parentUserId, parentId)));
    await tx.delete(parentInvites).where(and(eq(parentInvites.studentUserId, studentId), eq(parentInvites.acceptedByUserId, parentId)));

    const [parent] = await tx.select({ householdId: users.householdId }).from(users).where(eq(users.id, parentId));
    const from = student.householdId;
    const outcome = { householdMoved: false, grantsMoved: 0, trialCarried: false, planEnding: false, passwordChanged };
    let planJob: string | null = null;

    if (from && from === parent?.householdId) {
      // Locked like grantFreeAccess does, so free access turned on at the same moment lands on one
      // side or the other, never both.
      await tx.select({ id: households.id }).from(households).where(eq(households.id, from)).for("update");
      const grants = await tx.select().from(accessGrants).where(eq(accessGrants.householdId, from));
      const { moved, trial } = carriedGrants(grants, studentId, now);

      const [own] = await tx.insert(households).values({ createdAt: now }).returning({ id: households.id });
      await tx.update(users).set({ householdId: own.id }).where(eq(users.id, studentId));
      if (moved.length) {
        await tx
          .update(accessGrants)
          .set({ householdId: own.id })
          .where(
            inArray(
              accessGrants.id,
              moved.map((g) => g.id),
            ),
          );
      }
      if (trial) {
        await tx.insert(accessGrants).values({ householdId: own.id, kind: "trial", startsAt: trial.startsAt, endsAt: trial.endsAt, createdAt: now });
      } else if (!moved.length) {
        await tx.insert(accessGrants).values({ householdId: own.id, kind: "trial", startsAt: now, endsAt: now, createdAt: now });
      }
      Object.assign(outcome, { householdMoved: true, grantsMoved: moved.length, trialCarried: Boolean(trial) });

      // The last student left, so a plan that still gives access covers nobody: it ends with the
      // period it's paid through instead of renewing (the parent who pays can keep it going).
      const [remaining] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.householdId, from), eq(users.role, "student")))
        .limit(1);
      const [billing] = remaining ? [] : await tx.select().from(billingAccounts).where(eq(billingAccounts.householdId, from));
      if (billing && subscriptionGrantsAccess(billing.status)) {
        outcome.planEnding = true;
        if (billing.stripeSubscriptionId && !billing.cancelAtPeriodEnd) {
          planJob = await queueCleanup(tx, { action: "cancel_at_period_end", stripeSubscriptionId: billing.stripeSubscriptionId }, now);
        }
      }
    }

    await audit(tx, "parent_link.removed_by_student", { actorUserId: studentId, subjectUserId: parentId, metadata: outcome });
    return { ok: true as const, outcome, planJob };
  });
  if (!result.ok) return result;

  if (result.planJob) {
    try {
      await runQueuedCleanup(db, deps.stripe === undefined ? getStripe() : deps.stripe, result.planJob, now);
    } catch (error) {
      // The job stays queued for the daily sweep; the removal is done either way.
      console.error("[billing] couldn't set a plan to end", errorName(error));
    }
  }
  return { ok: true, ...result.outcome };
}
