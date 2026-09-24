import { and, asc, eq, inArray } from "drizzle-orm";
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
import { endPlanWithoutParent } from "./billing/checkout";
import { runOrQueueCleanup } from "./billing/cleanup";
import { type Stripe, getStripe } from "./billing/stripe";

/**
 * Everything we hold about a student, for a parent's (or the student's own) export request.
 * Excludes the password hash and session tokens.
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

  const [consents, usage, safety, attempts, responses, results, runs, matches, goals] = await Promise.all([
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
  // Phase 4: the household's access (shared by everyone in it): trial, free access and any plan.
  const householdAccess = await exportHouseholdAccess(db, householdId);
  // Phase 3: colleges and programs on the student's list, with deadlines, checklist, aid offers and notes.
  const listRows = await db
    .select()
    .from(collegeList)
    .where(eq(collegeList.userId, studentId))
    .orderBy(asc(collegeList.createdAt), asc(collegeList.id));

  await audit(db, "student.exported", { actorUserId: requesterId, subjectUserId: studentId });
  return {
    exportedAt: new Date().toISOString(),
    profile,
    consentRecords: consents,
    aiUsage: usage,
    safetyEvents: safety,
    parentInvites: await exportParentInvites(db, studentId),
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
}

/**
 * How deletion reaches Stripe. Defaults to the configured client (none without STRIPE_SECRET_KEY);
 * tests pass one with a fake HTTP layer.
 */
export type DeletionDeps = { stripe?: Stripe | null };

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
  const deleted = await db
    .delete(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")))
    .returning({ id: users.id, householdId: users.householdId });
  if (deleted.length === 0) return false;
  await audit(db, "student.deleted", { actorUserId: requesterId === studentId ? null : requesterId });
  await deleteEmptyHousehold(db, deleted[0].householdId, deps);
  return true;
}

/**
 * Deletes a parent account. Children the parent created under COPPA consent go with it;
 * teens who own their own accounts are only unlinked. A household with teens left in it keeps its
 * access, and a plan the parent paid for runs to the end of its paid period without renewing (see
 * endPlanWithoutParent); an empty household is deleted.
 */
export async function deleteParentAccount(db: Db, parentId: string, deps: DeletionDeps = {}) {
  const children = await db
    .select({ id: users.id, parentManaged: users.parentManaged })
    .from(parentStudentLinks)
    .innerJoin(users, eq(parentStudentLinks.studentUserId, users.id))
    .where(eq(parentStudentLinks.parentUserId, parentId));
  const managedIds = children.filter((c) => c.parentManaged).map((c) => c.id);

  const removed = await db.transaction(async (tx) => {
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

/** Phase 2 data: courses, roadmap progress, weekly steps, counselor conversations and memory. */
async function exportPlanningData(db: Db, studentId: string) {
  const [courses, milestones, steps, conversations, messages, memory, reminders] = await Promise.all([
    db.select().from(studentCourses).where(eq(studentCourses.userId, studentId)),
    db
      .select({ milestoneId: studentMilestones.milestoneId, status: studentMilestones.status, updatedAt: studentMilestones.updatedAt })
      .from(studentMilestones)
      .where(eq(studentMilestones.userId, studentId)),
    db.select().from(weeklySteps).where(eq(weeklySteps.userId, studentId)),
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
    db.select({ weekStart: reminderSends.weekStart, claimedAt: reminderSends.claimedAt, sentAt: reminderSends.sentAt }).from(reminderSends).where(eq(reminderSends.userId, studentId)),
  ]);
  return {
    courses: courses.map(({ userId: _userId, ...c }) => c),
    roadmapProgress: milestones,
    weeklySteps: steps.map(({ userId: _userId, ...s }) => s),
    counselorConversations: conversations.map(({ userId: _userId, ...c }) => ({
      ...c,
      messages: messages.filter((m) => m.conversationId === c.id),
    })),
    counselorMemory: memory[0]?.notes ?? [],
    reminderEmails: reminders,
  };
}
