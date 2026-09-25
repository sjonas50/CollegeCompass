import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { accessGrants, billingAccounts, households, parentInvites, parentStudentLinks, users } from "@/db/schema";
import { type AccessSource, type HouseholdAccess, evaluateAccess, isGrantActive } from "./access/entitlement";
import { formatAccessDate } from "./access/describe";
import { audit } from "./audit";
import { isUnder13 } from "./auth/age";
import { endPlanWithoutStudents } from "./billing/checkout";
import { type Stripe, getStripe } from "./billing/stripe";

// A student sees the parents or guardians linked to their account, and a teen who owns their
// account can remove one: say, when a forwarded invitation reached the wrong adult. Removing
// unlinks them and gives the teen a household of their own. The parent keeps their household, its
// plan and everything else that's theirs; the teen takes the free access they turned on.

// Transactions and the database share the query API every helper here uses.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Conn = Db | Tx;
type Grant = typeof accessGrants.$inferSelect;

// ---------------------------------------------------------------------------
// What goes with the teen
// ---------------------------------------------------------------------------

/**
 * The household's grants that go with a student who leaves it:
 * - `moved`: free access the student turned on (running or ended), which is theirs;
 * - `trial`: the family's trial while it's running, copied with the same dates, so the student
 *   keeps the days left but never gets more.
 * Everything else stays: the plan, free access someone else turned on, sponsored seats and comps.
 */
function carriedGrants(grants: Grant[], studentId: string, now: Date) {
  const moved = grants.filter((g) => g.kind === "free_access" && g.grantedByUserId === studentId);
  const running = grants.filter((g) => g.kind === "trial" && isGrantActive(g, now));
  const end = (g: Grant) => g.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const trial = running.reduce<Grant | null>((best, g) => (!best || end(g) > end(best) ? g : best), null);
  return { moved, trial };
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
      /** The first thing giving full access now that stays with the parent, if any. */
      leftBehind: AccessSource | null;
      /** The student is 13 or older, so they could turn on free access themselves. */
      canTurnOnFreeAccess: boolean;
    };

/** How the student sees a link: an invitation they sent (with the address they typed), or their parent set up the account. */
export type LinkOrigin = { kind: "invite"; sentTo: string | null } | { kind: "set_up" } | { kind: "other" };

export type LinkedParent = {
  id: string;
  displayName: string;
  linkedAt: Date;
  origin: LinkOrigin;
  /** Null when the student can't remove them: a child the parent set up under 13 (parentManaged). */
  removal: RemovalAccess | null;
};

async function removalAccess(
  db: Conn,
  student: { id: string; householdId: string | null; birthDate: string | null },
  parentHouseholdId: string | null,
  now: Date,
): Promise<RemovalAccess> {
  const from = student.householdId;
  if (!from || from !== parentHouseholdId) return { kind: "unchanged" };
  const [grants, [billing]] = await Promise.all([
    db.select().from(accessGrants).where(eq(accessGrants.householdId, from)),
    db.select().from(billingAccounts).where(eq(billingAccounts.householdId, from)),
  ]);
  const { moved, trial } = carriedGrants(grants, student.id, now);
  const shared = evaluateAccess({ householdId: from, grants, billing: billing ?? null }, now);
  const after = evaluateAccess({ householdId: from, grants: trial ? [...moved, trial] : moved, billing: null }, now);
  const othersFreeAccess = grants.some((g) => g.kind === "free_access" && g.grantedByUserId !== student.id && isGrantActive(g, now));
  const leftBehind =
    shared.sources.find((s) => s === "subscription" || s === "sponsored" || s === "comp" || (s === "free_access" && othersFreeAccess)) ?? null;
  return {
    kind: "split",
    now: shared,
    after,
    leftBehind,
    canTurnOnFreeAccess: Boolean(student.birthDate && !isUnder13(student.birthDate, now)),
  };
}

/**
 * The parents and guardians linked to a student, oldest link first, for that student's own
 * Settings: never call it for anyone else. Each shows how they were linked (for an invitation, the
 * address the student typed) and, unless a parent set the account up under 13, what removing them
 * would do to the student's access.
 */
export async function listLinkedParents(db: Db, studentId: string, now = new Date()): Promise<LinkedParent[]> {
  if (!z.uuid().safeParse(studentId).success) return [];
  const [student] = await db
    .select({
      id: users.id,
      role: users.role,
      parentManaged: users.parentManaged,
      householdId: users.householdId,
      birthDate: users.birthDate,
      username: users.username,
    })
    .from(users)
    .where(eq(users.id, studentId));
  if (!student || student.role !== "student") return [];

  const parents = await db
    .select({ id: users.id, displayName: users.displayName, householdId: users.householdId, linkedAt: parentStudentLinks.createdAt })
    .from(parentStudentLinks)
    .innerJoin(users, eq(users.id, parentStudentLinks.parentUserId))
    .where(eq(parentStudentLinks.studentUserId, studentId))
    .orderBy(asc(parentStudentLinks.createdAt), asc(users.id));
  if (!parents.length) return [];

  const invites = await db
    .select({ acceptedByUserId: parentInvites.acceptedByUserId, sentTo: parentInvites.sentTo })
    .from(parentInvites)
    .where(
      and(
        eq(parentInvites.studentUserId, studentId),
        isNotNull(parentInvites.acceptedAt),
        inArray(
          parentInvites.acceptedByUserId,
          parents.map((p) => p.id),
        ),
      ),
    )
    .orderBy(desc(parentInvites.acceptedAt));

  return Promise.all(
    parents.map(async (p): Promise<LinkedParent> => {
      const invite = invites.find((i) => i.acceptedByUserId === p.id);
      // Only parents create accounts with usernames; teens who sign up use their email.
      const origin: LinkOrigin = invite ? { kind: "invite", sentTo: invite.sentTo } : student.username ? { kind: "set_up" } : { kind: "other" };
      return {
        id: p.id,
        displayName: p.displayName,
        linkedAt: p.linkedAt,
        origin,
        removal: student.parentManaged ? null : await removalAccess(db, student, p.householdId, now),
      };
    }),
  );
}

const dateOf = (d: Date | null | undefined) => (d ? formatAccessDate(d) : null);

/**
 * What the confirm step tells the teen about their access, before they remove `name`. It matches
 * removeLinkedParent: the plan and anything else on the parent's side stays there; free access the
 * teen turned on and the days left on a running trial come along.
 */
export function removalAccessNote(name: string, removal: RemovalAccess): string {
  if (removal.kind === "unchanged") return "Your access stays the same.";
  const { now, after, leftBehind, canTurnOnFreeAccess } = removal;
  if (!now.full) return `Your family doesn't have full access right now. Removing ${name} won't change that.`;

  const theirs =
    leftBehind === "subscription"
      ? `${name}'s plan`
      : leftBehind === "free_access"
        ? `The free access on ${name}'s account`
        : leftBehind
          ? `The full access on ${name}'s account`
          : null;
  const turnOn = "you can turn on free access yourself. It's free, and you won't need any documents.";

  if (after.full) {
    const kept = after.sources[0];
    const until = kept === "free_access" ? dateOf(after.freeAccess?.endsAt) : dateOf(after.trial?.endsAt);
    const keep =
      kept === "free_access"
        ? `You keep the free access you turned on${until ? `. It lasts until ${until}` : ""}.`
        : `You keep your free trial${until ? `. It ends on ${until}` : ""}.`;
    const later = kept === "trial" && canTurnOnFreeAccess ? ` After that, ${turnOn}` : "";
    return `${theirs ? `${theirs} stays with them. ` : ""}${keep}${later}`;
  }

  const source =
    leftBehind === "subscription"
      ? `${name}'s plan`
      : leftBehind === "free_access"
        ? `free access on ${name}'s account`
        : `${name}'s account`;
  const next = canTurnOnFreeAccess
    ? `After you remove them, ${turnOn}`
    : "After you remove them, you won't have full access. Your activities, career matches and college search stay free.";
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
  | "not_linked";

export type RemoveParentResult =
  | {
      ok: true;
      /** The student moved out of the household they shared with the parent, into a new one. */
      householdMoved: boolean;
      /** Free-access grants the student turned on that came along. */
      grantsMoved: number;
      /** The days left on a running trial came along. */
      trialCarried: boolean;
      /** The parent's plan was set to end at its period end: it no longer covers any student. */
      planEnding: boolean;
    }
  | { ok: false; error: RemoveParentError };

/**
 * A teen who owns their account removes a linked parent or guardian. Call it only with the signed-in
 * student's own id. A child a parent set up under 13 (parentManaged) can't: that parent manages the
 * account.
 *
 * - The link goes, so the parent no longer sees the teen or acts for them. The invitation that
 *   parent accepted goes too, with the address the teen typed, so its link stops working.
 * - When they share a household (they do once linked), the teen moves to a new household of their
 *   own. Free access the teen turned on comes along, and so do the days left on a running trial
 *   (copied, never extended). The plan and everything else stays with the parent's household. A
 *   household that would otherwise have no grants gets a trial of no length, so a new one isn't
 *   started for it (see getHouseholdAccess): removing a parent never starts a new trial.
 * - If the teen was the household's last student, a plan that renews is set to end with the period
 *   it's paid through (endPlanWithoutStudents). The parent keeps the time they paid for.
 *
 * Nothing is emailed to the parent. The audit entry holds only ids and counts.
 */
export async function removeLinkedParent(
  db: Db,
  studentId: string,
  parentId: string,
  deps: { stripe?: Stripe | null; now?: Date } = {},
): Promise<RemoveParentResult> {
  const now = deps.now ?? new Date();
  if (!z.uuid().safeParse(studentId).success) return { ok: false, error: "not_found" };
  if (!z.uuid().safeParse(parentId).success) return { ok: false, error: "not_linked" };
  const fail = (error: RemoveParentError) => ({ ok: false as const, error });

  const result = await db.transaction(async (tx) => {
    // Locked, so a second click (or a second tab) waits and then finds no link.
    const [student] = await tx
      .select({ role: users.role, parentManaged: users.parentManaged, householdId: users.householdId })
      .from(users)
      .where(eq(users.id, studentId))
      .for("update");
    if (!student || student.role !== "student") return fail("not_found");
    if (student.parentManaged) return fail("parent_managed");

    const removed = await tx
      .delete(parentStudentLinks)
      .where(and(eq(parentStudentLinks.studentUserId, studentId), eq(parentStudentLinks.parentUserId, parentId)))
      .returning({ parentId: parentStudentLinks.parentUserId });
    if (!removed.length) return fail("not_linked");
    await tx.delete(parentInvites).where(and(eq(parentInvites.studentUserId, studentId), eq(parentInvites.acceptedByUserId, parentId)));

    const [parent] = await tx.select({ householdId: users.householdId }).from(users).where(eq(users.id, parentId));
    const from = student.householdId;
    if (!from || from !== parent?.householdId) {
      return { ok: true as const, from: null, grantsMoved: 0, trialCarried: false };
    }

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
    return { ok: true as const, from, grantsMoved: moved.length, trialCarried: Boolean(trial) };
  });
  if (!result.ok) return result;

  // Outside the transaction: this may call Stripe (and never throws).
  const plan = result.from ? await endPlanWithoutStudents(db, deps.stripe === undefined ? getStripe() : deps.stripe, result.from, now) : "none";
  const outcome = {
    householdMoved: result.from !== null,
    grantsMoved: result.grantsMoved,
    trialCarried: result.trialCarried,
    planEnding: plan === "ending",
  };
  await audit(db, "parent_link.removed_by_student", { actorUserId: studentId, subjectUserId: parentId, metadata: outcome });
  return { ok: true, ...outcome };
}
