import { and, eq, or, sql } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { accessGrants, consentRecords, households, parentStudentLinks, users } from "@/db/schema";
import { auditTrialStarted, trialGrant } from "./access/service";
import { audit } from "./audit";
import { MAX_GRADE, MIN_GRADE, currentGrade, isAllowedGrade, isPlausibleStudentBirthDate, isUnder13, schoolYearOf } from "./auth/age";
import { hashPassword, verifyPassword } from "./auth/password";
import { CONSENT_POLICY_VERSION, type ConsentVerification } from "./consent/verifier";
import { forgetSavedContexts } from "./counselor/saved-context";

// ---------------------------------------------------------------------------
// Input schemas (shared by server actions and tests)
// ---------------------------------------------------------------------------

const displayName = z.string().trim().min(1, "Enter a first name or nickname.").max(40);
const email = z.email("Enter a valid email address.").trim().toLowerCase().max(254);
const password = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use 128 characters or fewer.");
// 6 is accepted only in June/July, as "the grade you just finished" (see gradeQuestion).
const grade = z.coerce
  .number()
  .int()
  .min(MIN_GRADE - 1, `Grades ${MIN_GRADE}–${MAX_GRADE} only.`)
  .max(MAX_GRADE, `Grades ${MIN_GRADE}–${MAX_GRADE} only.`);
const birthDate = z
  .string()
  .refine((v) => isPlausibleStudentBirthDate(v), "Enter a valid birth date.");
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,30}$/, "3–30 letters, numbers, dots, dashes or underscores.")
  // Keep usernames from looking like emails or containing real names in an obvious format.
  .refine((v) => !v.includes("@"), "Usernames can't contain @.");

export const StudentSignupSchema = z.object({ displayName, email, password, birthDate, grade });
export const ParentSignupSchema = z.object({ displayName, email, password });
export const ChildAccountSchema = z.object({ displayName, username, password, birthDate, grade });
export const LoginSchema = z.object({
  identifier: z.string().trim().toLowerCase().min(1, "Enter your email or username."),
  password: z.string().min(1, "Enter your password."),
});

export type AccountError = "email_taken" | "username_taken" | "under_13" | "consent_required" | "invalid_grade";
type Result<T> = { ok: true; value: T } | { ok: false; error: AccountError };

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

async function emailTaken(db: Db, value: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${value.toLowerCase()}`);
  return Boolean(row);
}

async function usernameTaken(db: Db, value: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${value.toLowerCase()}`);
  return Boolean(row);
}

/** Self-signup for students 13 and older. Under-13s must go through a parent. */
export async function registerStudent(
  db: Db,
  input: z.infer<typeof StudentSignupSchema>,
  today = new Date(),
): Promise<Result<{ userId: string }>> {
  if (isUnder13(input.birthDate, today)) return { ok: false, error: "under_13" };
  if (!isAllowedGrade(input.grade, today)) return { ok: false, error: "invalid_grade" };
  if (await emailTaken(db, input.email)) return { ok: false, error: "email_taken" };

  const passwordHash = await hashPassword(input.password);
  const userId = await db.transaction(async (tx) => {
    const [household] = await tx.insert(households).values({}).returning();
    const [user] = await tx
      .insert(users)
      .values({
        role: "student",
        householdId: household.id,
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        birthDate: input.birthDate,
        grade: input.grade,
        gradeSchoolYear: schoolYearOf(today),
      })
      .returning({ id: users.id });
    // Every new household starts with a free trial, timed from the household's creation.
    await tx.insert(accessGrants).values(trialGrant(household.id, household.createdAt));
    return user.id;
  });
  await audit(db, "account.created", { subjectUserId: userId, metadata: { role: "student" } });
  await auditTrialStarted(db, userId);
  return { ok: true, value: { userId } };
}

export async function registerParent(
  db: Db,
  input: z.infer<typeof ParentSignupSchema>,
): Promise<Result<{ userId: string }>> {
  if (await emailTaken(db, input.email)) return { ok: false, error: "email_taken" };

  const passwordHash = await hashPassword(input.password);
  const userId = await db.transaction(async (tx) => {
    const [household] = await tx.insert(households).values({}).returning();
    const [user] = await tx
      .insert(users)
      .values({
        role: "parent",
        householdId: household.id,
        email: input.email,
        passwordHash,
        displayName: input.displayName,
      })
      .returning({ id: users.id });
    await tx.insert(accessGrants).values(trialGrant(household.id, household.createdAt));
    return user.id;
  });
  await audit(db, "account.created", { subjectUserId: userId, metadata: { role: "parent" } });
  await auditTrialStarted(db, userId);
  return { ok: true, value: { userId } };
}

/**
 * A parent creates a student account in their household. Children under 13 require a
 * completed verifiable-consent check; the resulting consent record is stored with the account.
 */
export async function createChildAccount(
  db: Db,
  parentUserId: string,
  input: z.infer<typeof ChildAccountSchema>,
  consent: ConsentVerification | null,
  today = new Date(),
): Promise<Result<{ userId: string }>> {
  const under13 = isUnder13(input.birthDate, today);
  if (under13 && !consent) return { ok: false, error: "consent_required" };
  if (!isAllowedGrade(input.grade, today)) return { ok: false, error: "invalid_grade" };
  if (await usernameTaken(db, input.username)) return { ok: false, error: "username_taken" };

  const [parent] = await db
    .select({ householdId: users.householdId })
    .from(users)
    .where(and(eq(users.id, parentUserId), eq(users.role, "parent")));
  if (!parent?.householdId) throw new Error("Parent account not found");

  const passwordHash = await hashPassword(input.password);
  const userId = await db.transaction(async (tx) => {
    const [child] = await tx
      .insert(users)
      .values({
        role: "student",
        householdId: parent.householdId,
        username: input.username,
        passwordHash,
        displayName: input.displayName,
        birthDate: input.birthDate,
        grade: input.grade,
        gradeSchoolYear: schoolYearOf(today),
        parentManaged: under13,
      })
      .returning({ id: users.id });
    await tx.insert(parentStudentLinks).values({ parentUserId, studentUserId: child.id });
    if (consent) {
      await tx.insert(consentRecords).values({
        parentUserId,
        studentUserId: child.id,
        method: consent.method,
        verificationRef: consent.verificationRef,
        policyVersion: CONSENT_POLICY_VERSION,
      });
    }
    return child.id;
  });

  await audit(db, "student.created_by_parent", {
    actorUserId: parentUserId,
    subjectUserId: userId,
    metadata: { under13 },
  });
  if (consent) {
    await audit(db, "consent.granted", {
      actorUserId: parentUserId,
      subjectUserId: userId,
      metadata: { method: consent.method },
    });
  }
  return { ok: true, value: { userId } };
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

// Verified against when no account matches, so response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | undefined;

export async function authenticate(
  db: Db,
  input: z.infer<typeof LoginSchema>,
): Promise<{ userId: string } | null> {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(
      or(
        sql`lower(${users.email}) = ${input.identifier}`,
        sql`lower(${users.username}) = ${input.identifier}`,
      ),
    );

  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(await dummyHash, input.password);
    await audit(db, "auth.login_failed");
    return null;
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await audit(db, "auth.login_failed", { subjectUserId: user.id });
    return null;
  }
  await audit(db, "auth.login", { actorUserId: user.id });
  return { userId: user.id };
}

// ---------------------------------------------------------------------------
// Authorization helpers
// ---------------------------------------------------------------------------

export async function isLinkedParent(db: Db, parentUserId: string, studentUserId: string) {
  const [link] = await db
    .select({ studentUserId: parentStudentLinks.studentUserId })
    .from(parentStudentLinks)
    .where(
      and(
        eq(parentStudentLinks.parentUserId, parentUserId),
        eq(parentStudentLinks.studentUserId, studentUserId),
      ),
    );
  return Boolean(link);
}

export async function listChildren(db: Db, parentUserId: string, now = new Date()) {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      grade: users.grade,
      gradeSchoolYear: users.gradeSchoolYear,
      email: users.email,
      birthDate: users.birthDate,
      parentManaged: users.parentManaged,
      remindersEnabled: users.remindersEnabled,
      createdAt: users.createdAt,
    })
    .from(parentStudentLinks)
    .innerJoin(users, eq(parentStudentLinks.studentUserId, users.id))
    .where(eq(parentStudentLinks.parentUserId, parentUserId))
    .orderBy(users.createdAt);
  return rows.map(({ gradeSchoolYear, ...r }) => ({ ...r, grade: currentGrade({ grade: r.grade, gradeSchoolYear }, now) }));
}

/**
 * Lets a student (or their parent) correct the grade, e.g. after skipping or repeating a year.
 * `forSchoolYear` is the school year the grade question referred to when the form was shown: a
 * form loaded on July 31 ("Grade you just finished") and saved on August 1 still describes the year
 * that just ended, so the grade is stored against that year and advances normally.
 */
export async function setStudentGrade(db: Db, studentId: string, grade: number, today = new Date(), forSchoolYear = schoolYearOf(today)) {
  const thisYear = schoolYearOf(today);
  const valid =
    forSchoolYear === thisYear
      ? isAllowedGrade(grade, today)
      : forSchoolYear === thisYear - 1 && Number.isInteger(grade) && grade >= MIN_GRADE - 1 && grade <= MAX_GRADE;
  if (!valid) return false;
  const updated = await db
    .update(users)
    .set({ grade, gradeSchoolYear: forSchoolYear })
    .where(and(eq(users.id, studentId), eq(users.role, "student")))
    .returning({ id: users.id });
  if (updated.length > 0) await forgetSavedContexts(db, studentId);
  return updated.length > 0;
}
