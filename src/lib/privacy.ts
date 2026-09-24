import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import {
  aiUsage,
  assessmentAttempts,
  assessmentResponses,
  assessmentResults,
  careerMatches,
  collegeList,
  consentRecords,
  counselorConversations,
  counselorMemory,
  counselorMessages,
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
import { isLinkedParent } from "./accounts";
import { audit } from "./audit";

/**
 * Everything we hold about a student, for a parent's (or the student's own) export request.
 * Excludes the password hash and session tokens.
 */
export async function exportStudentData(db: Db, requesterId: string, studentId: string) {
  if (requesterId !== studentId && !(await isLinkedParent(db, requesterId, studentId))) {
    return null;
  }
  const [profile] = await db
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
    })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));
  if (!profile) return null;

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
    assessments: attempts.map((a) => ({
      ...a,
      responses: Object.fromEntries(responses.filter((r) => r.attemptId === a.id).map((r) => [r.itemId, r.value])),
      scores: results.find((r) => r.attemptId === a.id)?.scores ?? null,
    })),
    careerMatches: runs.map((r) => ({ ...r, matches: matches.filter((m) => m.runId === r.id) })),
    northStars: goals,
    ...planning,
    collegeList: listRows.map(({ userId: _userId, ...entry }) => entry),
  };
}

/**
 * Permanently deletes a student and everything tied to them. Sessions, AI usage and safety
 * events cascade; consent records and audit entries keep no link back to the child.
 */
export async function deleteStudent(db: Db, requesterId: string, studentId: string) {
  if (requesterId !== studentId && !(await isLinkedParent(db, requesterId, studentId))) {
    return false;
  }
  const deleted = await db
    .delete(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")))
    .returning({ id: users.id });
  if (deleted.length === 0) return false;
  await audit(db, "student.deleted", { actorUserId: requesterId === studentId ? null : requesterId });
  return true;
}

/**
 * Deletes a parent account. Children the parent created under COPPA consent go with it;
 * teens who own their own accounts are only unlinked.
 */
export async function deleteParentAccount(db: Db, parentId: string) {
  const children = await db
    .select({ id: users.id, parentManaged: users.parentManaged })
    .from(parentStudentLinks)
    .innerJoin(users, eq(parentStudentLinks.studentUserId, users.id))
    .where(eq(parentStudentLinks.parentUserId, parentId));
  const managedIds = children.filter((c) => c.parentManaged).map((c) => c.id);

  await db.transaction(async (tx) => {
    if (managedIds.length > 0) await tx.delete(users).where(inArray(users.id, managedIds));
    await tx.delete(users).where(and(eq(users.id, parentId), eq(users.role, "parent")));
  });
  await audit(db, "parent.deleted", { metadata: { childrenDeleted: managedIds.length } });
  return { childrenDeleted: managedIds.length };
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
