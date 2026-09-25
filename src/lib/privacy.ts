import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import {
  aiUsage,
  assessmentAttempts,
  assessmentResponses,
  assessmentResults,
  billingAccounts,
  careerMatches,
  collegeList,
  consentRecords,
  counselorConversations,
  counselorMemory,
  counselorMessages,
  households,
  matchRuns,
  northStarGoals,
  parentInvites,
  parentStudentLinks,
  reminderSends,
  safetyEvents,
  studentCourses,
  studentMilestones,
  users,
  weeklySteps,
} from "@/db/schema";
import { exportHouseholdAccess } from "./access/service";
import { exportParentInvites } from "./invites";
import { isLinkedParent } from "./accounts";
import { audit } from "./audit";
import { verifyPassword } from "./auth/password";
import { endPlanWithoutParent } from "./billing/checkout";
import { runOrQueueCleanup } from "./billing/cleanup";
import { type Stripe, getStripe } from "./billing/stripe";
import { consumeRateLimit } from "./rate-limit";

/**
 * AI features whose usage records show when a student talked with the AI counselor (each message
 * is safety-checked before the counselor answers).
 */
const COUNSELOR_AI_FEATURES: readonly string[] = ["counselor", "safety", "safety_backup"];

/** Written into a linked parent's copy of a teen's data, in place of the parts left out. */
export const PARENT_COPY_NOTE =
  "This teen has their own account, so their chats with the AI counselor stay private to them. " +
  "This copy leaves out those chats, the counselor's notes about them, any safety flags, " +
  "and the record of when they used the counselor.";

/**
 * Everything we hold about a student, for the student's own export request or a linked parent's.
 * Excludes the password hash and session tokens.
 *
 * Who asks matters. The student's own copy is complete. A linked parent's copy of a teen who owns
 * their account (not parentManaged) leaves out counselor conversations (messages and the saved
 * context), memory notes, safety events and counselor usage records, which stay private to the
 * teen; `notIncluded` says so in the file. A parent's copy of a child they set up under 13 (with
 * COPPA consent) is complete: parents may review what was collected from a child under 13.
 */
export async function exportStudentData(db: Db, requesterId: string, studentId: string) {
  if (requesterId !== studentId && !(await isLinkedParent(db, requesterId, studentId))) {
    return null;
  }
  const [student] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      username: users.username,
      birthDate: users.birthDate,
      grade: users.grade,
      gradeSchoolYear: users.gradeSchoolYear,
      remindersEnabled: users.remindersEnabled,
      parentManaged: users.parentManaged,
      createdAt: users.createdAt,
      householdId: users.householdId,
    })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));
  if (!student) return null;
  const { householdId, ...profile } = student;
  const complete = requesterId === studentId || student.parentManaged;

  const [consents, usage, attempts, responses, results, runs, matches, goals] = await Promise.all([
    db
      .select({
        method: consentRecords.method,
        policyVersion: consentRecords.policyVersion,
        grantedAt: consentRecords.grantedAt,
        revokedAt: consentRecords.revokedAt,
      })
      .from(consentRecords)
      .where(eq(consentRecords.studentUserId, studentId)),
    db
      .select({
        feature: aiUsage.feature,
        model: aiUsage.model,
        inputTokens: aiUsage.inputTokens,
        outputTokens: aiUsage.outputTokens,
        createdAt: aiUsage.createdAt,
      })
      .from(aiUsage)
      .where(eq(aiUsage.userId, studentId)),
    db
      .select({
        id: assessmentAttempts.id,
        instrument: assessmentAttempts.instrument,
        instrumentVersion: assessmentAttempts.instrumentVersion,
        startedAt: assessmentAttempts.startedAt,
        completedAt: assessmentAttempts.completedAt,
      })
      .from(assessmentAttempts)
      .where(eq(assessmentAttempts.userId, studentId)),
    db
      .select({ attemptId: assessmentResponses.attemptId, itemId: assessmentResponses.itemId, value: assessmentResponses.value })
      .from(assessmentResponses)
      .innerJoin(assessmentAttempts, eq(assessmentAttempts.id, assessmentResponses.attemptId))
      .where(eq(assessmentAttempts.userId, studentId)),
    db
      .select({ attemptId: assessmentResults.attemptId, scores: assessmentResults.scores, createdAt: assessmentResults.createdAt })
      .from(assessmentResults)
      .innerJoin(assessmentAttempts, eq(assessmentAttempts.id, assessmentResults.attemptId))
      .where(eq(assessmentAttempts.userId, studentId)),
    db
      .select({ id: matchRuns.id, explanation: matchRuns.explanation, createdAt: matchRuns.createdAt })
      .from(matchRuns)
      .where(eq(matchRuns.userId, studentId)),
    db
      .select({ runId: careerMatches.runId, rank: careerMatches.rank, title: careerMatches.title, score: careerMatches.score })
      .from(careerMatches)
      .innerJoin(matchRuns, eq(matchRuns.id, careerMatches.runId))
      .where(eq(matchRuns.userId, studentId)),
    db
      .select({ title: northStarGoals.title, createdAt: northStarGoals.createdAt })
      .from(northStarGoals)
      .where(eq(northStarGoals.userId, studentId)),
  ]);

  const planning = await exportPlanningData(db, studentId);
  // Phase 4: the household's access (shared by everyone in it): trial, free access and any plan,
  // and which grants were given for this student.
  const householdAccess = await exportHouseholdAccess(db, householdId, undefined, studentId);
  // Phase 3: colleges and programs on the student's list, with deadlines, checklist, aid offers and notes.
  const listRows = await db
    .select()
    .from(collegeList)
    .where(eq(collegeList.userId, studentId))
    .orderBy(asc(collegeList.createdAt), asc(collegeList.id));

  const shared = {
    profile,
    consentRecords: consents,
    // The addresses the student typed are only in their own copy (see exportParentInvites).
    parentInvites: await exportParentInvites(db, studentId, undefined, { withAddresses: requesterId === studentId }),
    assessments: attempts.map((a) => ({
      ...a,
      responses: Object.fromEntries(responses.filter((r) => r.attemptId === a.id).map((r) => [r.itemId, r.value])),
      scores: results.find((r) => r.attemptId === a.id)?.scores ?? null,
    })),
    careerMatches: runs.map((r) => ({ ...r, matches: matches.filter((m) => m.runId === r.id) })),
    northStars: goals,
    ...planning,
    collegeList: listRows.map(({ userId: _userId, ...entry }) => entry),
    householdAccess,
  };
  // The private parts are only read for a copy that includes them.
  const counselor = complete ? await exportCounselorData(db, studentId) : null;

  await audit(db, "student.exported", { actorUserId: requesterId, subjectUserId: studentId, metadata: { complete } });
  const exportedAt = new Date().toISOString();
  if (!counselor) {
    return {
      exportedAt,
      notIncluded: PARENT_COPY_NOTE,
      ...shared,
      aiUsage: usage.filter((u) => !COUNSELOR_AI_FEATURES.includes(u.feature)),
    };
  }
  return { exportedAt, ...shared, aiUsage: usage, ...counselor };
}

/**
 * How deletion reaches Stripe. Defaults to the configured client (none without STRIPE_SECRET_KEY);
 * tests pass one with a fake HTTP layer.
 */
export type DeletionDeps = { stripe?: Stripe | null };

/** Safety events nobody has reviewed yet, read before their students are deleted. */
async function unreviewedSafetyEvents(db: Db, studentIds: string[]) {
  if (!studentIds.length) return [];
  return db
    .select({ id: safetyEvents.id, severity: safetyEvents.severity, createdAt: safetyEvents.createdAt })
    .from(safetyEvents)
    .where(and(inArray(safetyEvents.userId, studentIds), isNull(safetyEvents.reviewedAt)));
}

/**
 * Once the students are gone, notes each safety event deleted before anyone reviewed it (id,
 * severity and when it was flagged; nothing about the student), so staff review numbers stay whole.
 */
async function auditDeletedUnreviewed(db: Db, events: Awaited<ReturnType<typeof unreviewedSafetyEvents>>) {
  for (const e of events) {
    await audit(db, "safety.deleted_unreviewed", { metadata: { eventId: e.id, severity: e.severity, flaggedAt: e.createdAt.toISOString() } });
  }
}

/**
 * Permanently deletes a student and everything tied to them. Sessions and safety events cascade;
 * AI usage rows (token counts and cost, no content) stay for spend history with no link back to the
 * child, as do consent records and audit entries. If the
 * student was the last person in their household, the household goes too (see deleteEmptyHousehold).
 */
export async function deleteStudent(db: Db, requesterId: string, studentId: string, deps: DeletionDeps = {}) {
  if (requesterId !== studentId && !(await isLinkedParent(db, requesterId, studentId))) {
    return false;
  }
  const unreviewed = await unreviewedSafetyEvents(db, [studentId]);
  const deleted = await db
    .delete(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")))
    .returning({ id: users.id, householdId: users.householdId });
  if (deleted.length === 0) return false;
  await audit(db, "student.deleted", { actorUserId: requesterId === studentId ? null : requesterId });
  await auditDeletedUnreviewed(db, unreviewed);
  await deleteEmptyHousehold(db, deleted[0].householdId, deps);
  return true;
}

export type DeleteOwnAccountError = "not_found" | "parent_managed" | "rate_limited" | "wrong_password";

/** Password tries for deleting one's own account, per account. */
export const DELETE_OWN_ACCOUNT_LIMIT = { count: 5, windowMs: 15 * 60_000 };

/**
 * A student deleting their own account, with everything in it (see deleteStudent). Only teens who
 * own their account can: a child a parent set up under 13 (parentManaged) is deleted by that
 * parent. The password is asked again because a family or library computer may be left signed
 * in, and tries are limited like sign-in.
 */
export async function deleteOwnStudentAccount(
  db: Db,
  studentId: string,
  password: string,
  deps: DeletionDeps & { now?: Date } = {},
): Promise<{ ok: true } | { ok: false; error: DeleteOwnAccountError }> {
  const [student] = await db
    .select({ passwordHash: users.passwordHash, parentManaged: users.parentManaged })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));
  if (!student) return { ok: false, error: "not_found" };
  if (student.parentManaged) return { ok: false, error: "parent_managed" };
  const { count, windowMs } = DELETE_OWN_ACCOUNT_LIMIT;
  if (!(await consumeRateLimit(db, `delete-account:${studentId}`, count, windowMs, deps.now))) {
    return { ok: false, error: "rate_limited" };
  }
  if (!(await verifyPassword(student.passwordHash, password))) return { ok: false, error: "wrong_password" };
  const deleted = await deleteStudent(db, studentId, studentId, { stripe: deps.stripe });
  return deleted ? { ok: true } : { ok: false, error: "not_found" };
}

/**
 * Deletes a parent account. Children the parent created under COPPA consent go with it;
 * teens who own their own accounts are only unlinked. A household with teens left in it keeps its
 * access, and a plan the parent paid for runs to the end of its paid period without renewing (see
 * endPlanWithoutParent); an empty household is deleted. The teens keep the invitations this parent
 * accepted, without the addresses they were sent to.
 */
export async function deleteParentAccount(db: Db, parentId: string, deps: DeletionDeps = {}) {
  const children = await db
    .select({ id: users.id, parentManaged: users.parentManaged })
    .from(parentStudentLinks)
    .innerJoin(users, eq(parentStudentLinks.studentUserId, users.id))
    .where(eq(parentStudentLinks.parentUserId, parentId));
  const managedIds = children.filter((c) => c.parentManaged).map((c) => c.id);
  const unreviewed = await unreviewedSafetyEvents(db, managedIds);

  const removed = await db.transaction(async (tx) => {
    // Invitations this parent accepted stay in the teens' records, but not the addresses they went to.
    await tx.update(parentInvites).set({ sentTo: null }).where(eq(parentInvites.acceptedByUserId, parentId));
    const kids =
      managedIds.length > 0
        ? await tx.delete(users).where(inArray(users.id, managedIds)).returning({ householdId: users.householdId })
        : [];
    const parent = await tx
      .delete(users)
      .where(and(eq(users.id, parentId), eq(users.role, "parent")))
      .returning({ householdId: users.householdId });
    return [...parent, ...kids];
  });
  await audit(db, "parent.deleted", { metadata: { childrenDeleted: managedIds.length } });
  if (removed.length > 0) await auditDeletedUnreviewed(db, unreviewed);
  for (const householdId of new Set(removed.map((r) => r.householdId))) {
    if (!householdId) continue;
    const deleted = await deleteEmptyHousehold(db, householdId, deps);
    // Teens remain but no parent: a renewing plan ends when its paid period does, and one that has
    // already ended is closed now.
    if (!deleted) await endPlanWithoutParent(db, deps.stripe === undefined ? getStripe() : deps.stripe, householdId);
  }
  return { childrenDeleted: managedIds.length };
}

/**
 * Deletes a household nobody belongs to anymore. Its access grants and billing account cascade.
 * Its Stripe customer is deleted first, which cancels any subscription so the family isn't billed
 * again. If Stripe can't be reached, the error's name is logged, the deletion is queued for the
 * daily sweep to retry (stripe_cleanup keeps only the Stripe id), and the local data is deleted
 * anyway. Returns whether the household was deleted.
 */
export async function deleteEmptyHousehold(db: Db, householdId: string | null, deps: DeletionDeps = {}): Promise<boolean> {
  if (!householdId) return false;
  const [member] = await db.select({ id: users.id }).from(users).where(eq(users.householdId, householdId)).limit(1);
  if (member) return false;

  const [billing] = await db
    .select({ stripeCustomerId: billingAccounts.stripeCustomerId })
    .from(billingAccounts)
    .where(eq(billingAccounts.householdId, householdId));
  if (billing) {
    const stripe = deps.stripe === undefined ? getStripe() : deps.stripe;
    const stripeDeleted = await runOrQueueCleanup(db, stripe, { action: "delete_customer", stripeCustomerId: billing.stripeCustomerId });
    await audit(db, "billing.customer_deleted", { metadata: { stripeDeleted } });
  }
  await db.delete(households).where(eq(households.id, householdId));
  return true;
}

/** Phase 2 planning data: courses, roadmap progress, weekly steps and reminder emails. */
async function exportPlanningData(db: Db, studentId: string) {
  const [courses, milestones, steps, reminders] = await Promise.all([
    db.select().from(studentCourses).where(eq(studentCourses.userId, studentId)),
    db
      .select({ milestoneId: studentMilestones.milestoneId, status: studentMilestones.status, updatedAt: studentMilestones.updatedAt })
      .from(studentMilestones)
      .where(eq(studentMilestones.userId, studentId)),
    db.select().from(weeklySteps).where(eq(weeklySteps.userId, studentId)),
    db.select({ weekStart: reminderSends.weekStart, claimedAt: reminderSends.claimedAt, sentAt: reminderSends.sentAt }).from(reminderSends).where(eq(reminderSends.userId, studentId)),
  ]);
  return {
    courses: courses.map(({ userId: _userId, ...c }) => c),
    roadmapProgress: milestones,
    weeklySteps: steps.map(({ userId: _userId, ...s }) => s),
    reminderEmails: reminders,
  };
}

/**
 * What stays private to a teen who owns their account: counselor conversations (with their saved
 * context), memory notes and safety events. Only in the student's own copy, or a parent's copy of
 * a child they set up under 13.
 */
async function exportCounselorData(db: Db, studentId: string) {
  const [safety, conversations, messages, memory] = await Promise.all([
    db
      .select({
        category: safetyEvents.category,
        severity: safetyEvents.severity,
        excerpt: safetyEvents.excerpt,
        createdAt: safetyEvents.createdAt,
        // Whether and how staff reviewed it. Staff notes stay out until counsel decides.
        reviewedAt: safetyEvents.reviewedAt,
        reviewOutcome: safetyEvents.reviewOutcome,
      })
      .from(safetyEvents)
      .where(eq(safetyEvents.userId, studentId)),
    db.select().from(counselorConversations).where(eq(counselorConversations.userId, studentId)),
    db
      .select({
        conversationId: counselorMessages.conversationId,
        role: counselorMessages.role,
        kind: counselorMessages.kind,
        content: counselorMessages.content,
        createdAt: counselorMessages.createdAt,
      })
      .from(counselorMessages)
      .innerJoin(counselorConversations, eq(counselorConversations.id, counselorMessages.conversationId))
      .where(eq(counselorConversations.userId, studentId)),
    db.select({ notes: counselorMemory.notes, updatedAt: counselorMemory.updatedAt }).from(counselorMemory).where(eq(counselorMemory.userId, studentId)),
  ]);
  return {
    safetyEvents: safety,
    counselorConversations: conversations.map(({ userId: _userId, ...c }) => ({
      ...c,
      messages: messages.filter((m) => m.conversationId === c.id),
    })),
    counselorMemory: memory[0]?.notes ?? [],
  };
}
