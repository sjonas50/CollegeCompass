import { and, asc, count, eq, gt, isNull, ne, or } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { accessGrants, billingAccounts, households, parentInvites, parentStudentLinks, users } from "@/db/schema";
import { LIVE_STATUSES, subscriptionGrantsAccess } from "./access/entitlement";
import { audit } from "./audit";
import { generateToken, hashToken } from "./auth/tokens";
import type { Email } from "./email";
import { consumeRateLimit } from "./rate-limit";

// A teen who signed up on their own invites a parent or guardian to link to their account. We
// email the invitation and keep only a hash of its token: never the email address.

const DAY_MS = 24 * 60 * 60 * 1000;
export const INVITE_TTL_DAYS = 14;
/** Invitations waiting for an answer at once. */
export const MAX_PENDING_INVITES = 3;
/** Invitation emails a student can send in a day, cancelled ones included. */
export const MAX_INVITE_SENDS_PER_DAY = 5;

export const InviteEmailSchema = z.object({
  parentEmail: z.email("Enter a valid email address.").trim().toLowerCase().max(254),
});

/** Tokens are 43 base64url characters; anything much longer isn't one of ours. */
const TOKEN_MAX = 128;

// Transactions and the database share the query API every helper here uses.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Conn = Db | Tx;

function pending(now: Date) {
  return and(isNull(parentInvites.acceptedAt), gt(parentInvites.expiresAt, now));
}

async function hasLinkedParent(db: Conn, studentId: string) {
  const [link] = await db
    .select({ id: parentStudentLinks.parentUserId })
    .from(parentStudentLinks)
    .where(eq(parentStudentLinks.studentUserId, studentId))
    .limit(1);
  return Boolean(link);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type CreateInviteError = "not_eligible" | "has_parent" | "own_email" | "too_many_pending" | "rate_limited" | "send_failed";
export type CreateInviteResult = { ok: true; inviteId: string; expiresAt: Date } | { ok: false; error: CreateInviteError };

export type CreateInviteOptions = {
  /** Base URL for the link in the email. */
  appUrl: string;
  send: (email: Email) => Promise<void>;
  now?: Date;
};

export function inviteEmail(to: string, displayName: string, link: string): Email {
  // Names are typed by students; keep line breaks and other control characters out of the subject.
  const studentName = displayName.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() || "A student";
  return {
    to,
    subject: `${studentName} invited you to College Compass`,
    text: [
      "Hello,",
      "",
      `${studentName} uses College Compass to explore careers and plan for college or training.`,
      "They invited you, as their parent or guardian, to link your account to theirs.",
      "",
      "As a linked parent, you can:",
      "- see their progress: activities, goals, roadmap, classes and college list",
      "- manage your family's plan and billing",
      "- export or delete their account",
      "",
      "Their conversations with the AI counselor stay private to them.",
      "",
      "Accept the invitation here:",
      link,
      "",
      `The link works for ${INVITE_TTL_DAYS} days. If you don't know ${studentName}, you can ignore this email.`,
      "We didn't save your email address, and we won't write to you again about this.",
    ].join("\n"),
  };
}

/**
 * Invites a parent or guardian by email. Only students who own their account (13+, signed up on
 * their own) and have no linked parent can invite. At most 3 invitations wait at once and 5 are
 * sent a day. The email address is used to send and then forgotten; only the token's hash is kept.
 */
export async function createInvite(
  db: Db,
  studentId: string,
  parentEmail: string,
  opts: CreateInviteOptions,
): Promise<CreateInviteResult> {
  const now = opts.now ?? new Date();
  const to = parentEmail.trim().toLowerCase();
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);

  const created = await db.transaction(async (tx) => {
    // Lock the student so two quick submissions can't both slip under the limits.
    const [student] = await tx
      .select({ role: users.role, parentManaged: users.parentManaged, email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, studentId))
      .for("update");
    if (!student || student.role !== "student" || student.parentManaged) return { ok: false as const, error: "not_eligible" as const };
    if (await hasLinkedParent(tx, studentId)) return { ok: false as const, error: "has_parent" as const };
    if (student.email?.toLowerCase() === to) return { ok: false as const, error: "own_email" as const };

    const [{ n }] = await tx
      .select({ n: count() })
      .from(parentInvites)
      .where(and(eq(parentInvites.studentUserId, studentId), pending(now)));
    if (n >= MAX_PENDING_INVITES) return { ok: false as const, error: "too_many_pending" as const };
    if (!(await consumeRateLimit(tx, `parent_invite:student:${studentId}`, MAX_INVITE_SENDS_PER_DAY, DAY_MS, now))) {
      return { ok: false as const, error: "rate_limited" as const };
    }

    const [invite] = await tx
      .insert(parentInvites)
      .values({ studentUserId: studentId, tokenHash: hashToken(token), expiresAt, createdAt: now })
      .returning({ id: parentInvites.id });
    return { ok: true as const, inviteId: invite.id, studentName: student.displayName };
  });
  if (!created.ok) return created;

  const link = new URL(`/invite/${token}`, opts.appUrl).toString();
  try {
    await opts.send(inviteEmail(to, created.studentName, link));
  } catch {
    // Nothing is logged: provider errors can echo the address back.
    await db.delete(parentInvites).where(eq(parentInvites.id, created.inviteId));
    return { ok: false, error: "send_failed" };
  }
  await audit(db, "parent_invite.sent", { actorUserId: studentId, subjectUserId: studentId });
  return { ok: true, inviteId: created.inviteId, expiresAt };
}

export type PendingInvite = { id: string; createdAt: Date; expiresAt: Date };

/** A student's invitations still waiting for an answer, oldest first. */
export async function listPendingInvites(db: Db, studentId: string, now: Date = new Date()): Promise<PendingInvite[]> {
  return db
    .select({ id: parentInvites.id, createdAt: parentInvites.createdAt, expiresAt: parentInvites.expiresAt })
    .from(parentInvites)
    .where(and(eq(parentInvites.studentUserId, studentId), pending(now)))
    .orderBy(asc(parentInvites.createdAt), asc(parentInvites.id));
}

/** Cancels one of the student's own unanswered invitations; its link stops working. */
export async function cancelInvite(db: Db, studentId: string, inviteId: string): Promise<boolean> {
  if (!z.uuid().safeParse(inviteId).success) return false;
  const rows = await db
    .delete(parentInvites)
    .where(and(eq(parentInvites.id, inviteId), eq(parentInvites.studentUserId, studentId), isNull(parentInvites.acceptedAt)))
    .returning({ id: parentInvites.id });
  if (rows.length > 0) await audit(db, "parent_invite.cancelled", { actorUserId: studentId, subjectUserId: studentId });
  return rows.length > 0;
}

export type InviteCardState =
  | { eligible: false }
  | { eligible: true; pending: PendingInvite[]; canSend: boolean };

/**
 * What the student dashboard's invite card shows. Only teens who own their account and have no
 * linked parent see it (children a parent set up already have one).
 */
export async function inviteCardState(db: Db, studentId: string, now: Date = new Date()): Promise<InviteCardState> {
  const [student] = await db
    .select({ role: users.role, parentManaged: users.parentManaged })
    .from(users)
    .where(eq(users.id, studentId));
  if (!student || student.role !== "student" || student.parentManaged || (await hasLinkedParent(db, studentId))) {
    return { eligible: false };
  }
  const invites = await listPendingInvites(db, studentId, now);
  return { eligible: true, pending: invites, canSend: invites.length < MAX_PENDING_INVITES };
}

// ---------------------------------------------------------------------------
// Opening and accepting
// ---------------------------------------------------------------------------

export type InviteLookup =
  | { status: "pending"; inviteId: string; studentId: string; studentName: string; expiresAt: Date }
  | { status: "used"; studentName: string; acceptedByUserId: string | null }
  | { status: "expired" }
  | { status: "not_found" };

/** What an invitation link points to. Cancelled invitations are gone, so they read as not found. */
export async function findInvite(db: Db, token: string, now: Date = new Date()): Promise<InviteLookup> {
  if (typeof token !== "string" || token.length === 0 || token.length > TOKEN_MAX) return { status: "not_found" };
  const [row] = await db
    .select({
      id: parentInvites.id,
      studentId: parentInvites.studentUserId,
      expiresAt: parentInvites.expiresAt,
      acceptedAt: parentInvites.acceptedAt,
      acceptedByUserId: parentInvites.acceptedByUserId,
      studentName: users.displayName,
    })
    .from(parentInvites)
    .innerJoin(users, eq(users.id, parentInvites.studentUserId))
    .where(eq(parentInvites.tokenHash, hashToken(token)));
  if (!row) return { status: "not_found" };
  if (row.acceptedAt) return { status: "used", studentName: row.studentName, acceptedByUserId: row.acceptedByUserId };
  if (row.expiresAt <= now) return { status: "expired" };
  return { status: "pending", inviteId: row.id, studentId: row.studentId, studentName: row.studentName, expiresAt: row.expiresAt };
}

type BillingRow = typeof billingAccounts.$inferSelect;

/** 2 = renews, 1 = live but ends at the period end, 0 = no live subscription. */
function billingRank(b: BillingRow | undefined): number {
  if (!b?.status || !LIVE_STATUSES.includes(b.status)) return 0;
  return b.cancelAtPeriodEnd ? 1 : 2;
}

export type HouseholdMerge = {
  /** The student moved into the parent's household. */
  moved: boolean;
  /** Active access grants moved over (the student was the last one in their old household). */
  grantsMoved: number;
  /** Active access grants copied over (others still live in the old household and keep theirs). */
  grantsCopied: number;
  /**
   * What happened to the old household's billing account:
   * - moved: it's the accepting parent's own, and their household had none;
   * - swapped: it's the accepting parent's own and still going while their household's isn't, so
   *   theirs is parked on the old household instead;
   * - parked: it stays behind on the old household (it belongs to someone else, like a parent who
   *   deleted their account, or the parent's own plan wins), to be closed by the caller;
   * - stayed: others still live in the old household and keep it;
   * - none.
   * A Stripe customer is never handed to an adult who doesn't pay through it.
   */
  billing: "none" | "moved" | "swapped" | "parked" | "stayed";
  /**
   * The end of the time already paid for on a plan left behind (parked, stayed or swapped out),
   * carried into the parent's household as a comp grant so the student keeps it.
   */
  paidUntil?: Date;
  /** The old household was deleted: nobody was left in it and no billing account was parked there. */
  oldHouseholdDeleted: boolean;
  /**
   * The old household, now empty, still holding a parked billing account. The caller hands it to
   * deleteEmptyHousehold (src/lib/privacy.ts), which deletes the Stripe customer (ending its plan;
   * any paid time came along as `paidUntil`) and then the household.
   */
  parkedHouseholdId?: string;
};

const NO_MERGE: HouseholdMerge = { moved: false, grantsMoved: 0, grantsCopied: 0, billing: "none", oldHouseholdDeleted: false };

/**
 * Puts the student into the parent's household. Access grants still active come along. The old
 * household's billing account comes along only when the accepting parent is the one who pays
 * through it; any other plan stays behind and ends, and the time already paid for on it comes along
 * as a grant. Linking is never blocked by a plan in the student's old household: nobody could
 * manage it (students can't reach billing), so it's the old plan that gives way.
 */
async function mergeIntoParentHousehold(
  tx: Tx,
  student: { id: string; householdId: string | null },
  parent: { id: string; householdId: string | null },
  now: Date,
): Promise<HouseholdMerge> {
  const from = student.householdId;
  if (from !== null && from === parent.householdId) return NO_MERGE;

  const [[fromBilling], [toBilling], [{ others }]] = await Promise.all([
    from ? tx.select().from(billingAccounts).where(eq(billingAccounts.householdId, from)) : Promise.resolve([]),
    parent.householdId
      ? tx.select().from(billingAccounts).where(eq(billingAccounts.householdId, parent.householdId))
      : Promise.resolve([]),
    from
      ? tx.select({ others: count() }).from(users).where(and(eq(users.householdId, from), ne(users.id, student.id)))
      : Promise.resolve([{ others: 0 }]),
  ]);
  // The student is the last one in their old household, so it goes (unless billing is parked there).
  const leaving = from !== null && others === 0;

  let target = parent.householdId;
  if (!target) {
    const [created] = await tx.insert(households).values({}).returning({ id: households.id });
    target = created.id;
    await tx.update(users).set({ householdId: target }).where(eq(users.id, parent.id));
  }
  await tx.update(users).set({ householdId: target }).where(eq(users.id, student.id));
  const merge: HouseholdMerge = { ...NO_MERGE, moved: true };
  if (!from) return merge;

  const active = and(eq(accessGrants.householdId, from), or(isNull(accessGrants.endsAt), gt(accessGrants.endsAt, now)));
  if (leaving) {
    const moved = await tx.update(accessGrants).set({ householdId: target }).where(active).returning({ id: accessGrants.id });
    merge.grantsMoved = moved.length;
  } else {
    const grants = await tx.select().from(accessGrants).where(active);
    if (grants.length > 0) {
      await tx.insert(accessGrants).values(grants.map(({ id: _id, householdId: _household, ...grant }) => ({ ...grant, householdId: target })));
    }
    merge.grantsCopied = grants.length;
  }

  if (fromBilling) {
    // Only the parent who pays through a Stripe customer may use it: its card, billing address and
    // receipts are theirs.
    const parentPays = fromBilling.payerUserId === parent.id;
    let leftBehind: BillingRow | undefined = fromBilling;
    if (!leaving) {
      merge.billing = "stayed";
    } else if (parentPays && !toBilling) {
      await tx.update(billingAccounts).set({ householdId: target, updatedAt: now }).where(eq(billingAccounts.householdId, from));
      merge.billing = "moved";
      leftBehind = undefined;
    } else if (parentPays && toBilling && billingRank(fromBilling) > billingRank(toBilling)) {
      // Both are the parent's own: they keep the plan that's still going, and the other is parked.
      await tx.delete(billingAccounts).where(eq(billingAccounts.householdId, target));
      await tx.update(billingAccounts).set({ householdId: target, updatedAt: now }).where(eq(billingAccounts.householdId, from));
      await tx.insert(billingAccounts).values({ ...toBilling, householdId: from, updatedAt: now });
      merge.billing = "swapped";
      leftBehind = toBilling;
    } else {
      merge.billing = "parked";
    }
    // Time already paid for on a plan left behind comes along, so linking never costs the student
    // days of access.
    const paidUntil = leftBehind?.currentPeriodEnd;
    if (leftBehind && paidUntil && subscriptionGrantsAccess(leftBehind.status) && paidUntil > now) {
      await tx.insert(accessGrants).values({ householdId: target, kind: "comp", startsAt: now, endsAt: paidUntil });
      merge.paidUntil = paidUntil;
    }
  }

  if (leaving) {
    const [parked] = await tx
      .select({ id: billingAccounts.householdId })
      .from(billingAccounts)
      .where(eq(billingAccounts.householdId, from));
    if (!parked) {
      // Expired grants go with it.
      await tx.delete(households).where(eq(households.id, from));
      merge.oldHouseholdDeleted = true;
    } else {
      merge.parkedHouseholdId = from;
    }
  }
  return merge;
}

export type AcceptInviteError =
  | "not_found"
  | "expired"
  | "used"
  | "not_parent"
  | "student_has_parent"
  /**
   * No longer returned: a plan in the student's old household never blocks linking (see
   * mergeIntoParentHousehold). Kept only until the invitation page drops its message for it.
   */
  | "both_subscribed";
export type AcceptInviteResult =
  | { ok: true; studentId: string; studentName: string; merge: HouseholdMerge }
  | { ok: false; error: AcceptInviteError };

/**
 * A signed-in parent accepts an invitation: they're linked to the student, and the student joins
 * their household (see mergeIntoParentHousehold). Each link works once; the student's other
 * waiting invitations are cancelled.
 */
export async function acceptInvite(db: Db, token: string, parentUserId: string, now: Date = new Date()): Promise<AcceptInviteResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > TOKEN_MAX) return { ok: false, error: "not_found" };
  const fail = (error: AcceptInviteError) => ({ ok: false as const, error });

  const result = await db.transaction(async (tx) => {
    const [parent] = await tx
      .select({ id: users.id, role: users.role, householdId: users.householdId })
      .from(users)
      .where(eq(users.id, parentUserId))
      .for("update");
    if (!parent || parent.role !== "parent") return fail("not_parent");

    // Locked, so two tabs accepting at once can't both use it.
    const [invite] = await tx
      .select()
      .from(parentInvites)
      .where(eq(parentInvites.tokenHash, hashToken(token)))
      .for("update");
    if (!invite) return fail("not_found");
    if (invite.acceptedAt) return fail("used");
    if (invite.expiresAt <= now) return fail("expired");

    const [student] = await tx
      .select({ id: users.id, role: users.role, displayName: users.displayName, householdId: users.householdId })
      .from(users)
      .where(eq(users.id, invite.studentUserId))
      .for("update");
    if (!student || student.role !== "student") return fail("not_found");
    const [otherParent] = await tx
      .select({ id: parentStudentLinks.parentUserId })
      .from(parentStudentLinks)
      .where(and(eq(parentStudentLinks.studentUserId, student.id), ne(parentStudentLinks.parentUserId, parent.id)))
      .limit(1);
    if (otherParent) return fail("student_has_parent");

    const merge = await mergeIntoParentHousehold(tx, student, parent, now);

    await tx.update(parentInvites).set({ acceptedAt: now, acceptedByUserId: parent.id }).where(eq(parentInvites.id, invite.id));
    await tx.delete(parentInvites).where(and(eq(parentInvites.studentUserId, student.id), isNull(parentInvites.acceptedAt)));
    await tx.insert(parentStudentLinks).values({ parentUserId: parent.id, studentUserId: student.id }).onConflictDoNothing();
    return { ok: true as const, studentId: student.id, studentName: student.displayName, merge };
  });

  if (result.ok) {
    await audit(db, "parent_invite.accepted", {
      actorUserId: parentUserId,
      subjectUserId: result.studentId,
      metadata: {
        householdMoved: result.merge.moved,
        grantsMoved: result.merge.grantsMoved + result.merge.grantsCopied,
        billing: result.merge.billing,
        paidTimeCarried: Boolean(result.merge.paidUntil),
      },
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

/** A student's invitations for their data export. There's no address to include: we never kept it. */
export async function exportParentInvites(db: Db, studentId: string, now: Date = new Date()) {
  const rows = await db
    .select({ createdAt: parentInvites.createdAt, expiresAt: parentInvites.expiresAt, acceptedAt: parentInvites.acceptedAt })
    .from(parentInvites)
    .where(eq(parentInvites.studentUserId, studentId))
    .orderBy(asc(parentInvites.createdAt));
  return rows.map((r) => ({
    ...r,
    status: r.acceptedAt ? ("accepted" as const) : r.expiresAt <= now ? ("expired" as const) : ("pending" as const),
  }));
}
