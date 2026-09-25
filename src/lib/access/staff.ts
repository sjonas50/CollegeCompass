import { and, eq, or, sql } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { accessGrants, households, users } from "@/db/schema";
import { assertAdmin } from "../admin/access";
import { audit } from "../audit";
import { DAY_MS } from "./entitlement";

// Staff give a family full access without payment: "comp" (complimentary, like a pilot family) or
// "sponsored" (someone else pays, like a school or program). Only `npm run access:grant` calls this.

export const STAFF_GRANT_KINDS = ["comp", "sponsored"] as const;
export type StaffGrantKind = (typeof STAFF_GRANT_KINDS)[number];

export type StaffGrantError = "household_not_found" | "ended";
export type StaffGrantResult =
  /** `forStudent`: the grant was made for the student named by email or username (see findHousehold). */
  | { ok: true; householdId: string; endsAt: Date | null; forStudent: boolean }
  | { ok: false; error: StaffGrantError };

/**
 * The household a staff member means: its id, or the email or username of a student in it (then
 * `studentId` is that student's). Returns null when nothing matches.
 */
export async function findHousehold(db: Db, ref: string): Promise<{ householdId: string; studentId: string | null } | null> {
  const value = ref.trim();
  if (!value) return null;
  if (z.uuid().safeParse(value).success) {
    const [household] = await db.select({ id: households.id }).from(households).where(eq(households.id, value));
    return household ? { householdId: household.id, studentId: null } : null;
  }
  const lower = value.toLowerCase();
  const [student] = await db
    .select({ id: users.id, householdId: users.householdId })
    .from(users)
    .where(and(eq(users.role, "student"), or(sql`lower(${users.email}) = ${lower}`, sql`lower(${users.username}) = ${lower}`)))
    .limit(1);
  return student?.householdId ? { householdId: student.householdId, studentId: student.id } : null;
}

/**
 * Gives a household full access as staff, from now until `endsAt` (null: no end). The actor must be
 * a staff admin, checked in the database. The grant records who gave it and, when `household` named
 * a student (by email or username), that it's for that student: if they later leave the household,
 * it goes with them. The audit entry keeps only the kind and length: no names, emails or household
 * ids.
 */
export async function grantStaffAccess(
  db: Db,
  actorId: string,
  input: { household: string; kind: StaffGrantKind; endsAt: Date | null },
  now = new Date(),
): Promise<StaffGrantResult> {
  await assertAdmin(db, actorId);
  if (!STAFF_GRANT_KINDS.includes(input.kind)) throw new Error("Unknown grant kind");
  if (input.endsAt && input.endsAt.getTime() <= now.getTime()) return { ok: false, error: "ended" };
  const target = await findHousehold(db, input.household);
  if (!target) return { ok: false, error: "household_not_found" };
  const { householdId, studentId } = target;

  await db
    .insert(accessGrants)
    .values({ householdId, kind: input.kind, startsAt: now, endsAt: input.endsAt, grantedByUserId: actorId, forUserId: studentId });
  await audit(db, "access.granted_by_staff", {
    actorUserId: actorId,
    metadata: input.endsAt
      ? { kind: input.kind, days: Math.ceil((input.endsAt.getTime() - now.getTime()) / DAY_MS) }
      : { kind: input.kind, noEnd: true },
  });
  return { ok: true, householdId, endsAt: input.endsAt, forStudent: studentId !== null };
}

/** A staff admin's id from their email, or null. */
export async function staffIdByEmail(db: Db, email: string): Promise<string | null> {
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), sql`lower(${users.email}) = ${email.trim().toLowerCase()}`));
  return admin?.id ?? null;
}

// ---------------------------------------------------------------------------
// The access:grant script's arguments
// ---------------------------------------------------------------------------

export const GRANT_ACCESS_USAGE =
  "Usage: npm run access:grant -- --by staff@example.com --household <household id, or a student's email or username> --kind comp|sponsored --until YYYY-MM-DD|none\n" +
  "--by is your staff account's email. --until is the last day of access (a UTC calendar day, so it ends that evening in the US), or none for no end date.";

export type GrantAccessArgs =
  | { ok: true; by: string; household: string; kind: StaffGrantKind; endsAt: Date | null }
  | { ok: false; message: string };

/**
 * The end of access for `--until`: the end of that UTC calendar day (the start of the next one),
 * or null for "none". Returns undefined for anything that isn't a real date.
 */
export function parseUntil(value: string): Date | null | undefined {
  if (value.trim().toLowerCase() === "none") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return new Date(date.getTime() + DAY_MS);
}

/** Reads `--by`, `--household`, `--kind` and `--until` (as `--flag value` or `--flag=value`). */
export function parseGrantAccessArgs(argv: readonly string[]): GrantAccessArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { ok: false, message: GRANT_ACCESS_USAGE };
    const match = /^--(by|household|kind|until)(?:=(.*))?$/.exec(arg);
    if (!match) return { ok: false, message: `Unknown argument: ${arg}\n${GRANT_ACCESS_USAGE}` };
    const value = match[2] ?? argv[++i];
    if (value === undefined || value.startsWith("--")) return { ok: false, message: `--${match[1]} needs a value.\n${GRANT_ACCESS_USAGE}` };
    values[match[1]] = value;
  }
  const { by, household, kind, until } = values;
  if (!by?.trim() || !household?.trim() || !kind || !until) return { ok: false, message: GRANT_ACCESS_USAGE };
  if (!(STAFF_GRANT_KINDS as readonly string[]).includes(kind)) return { ok: false, message: `--kind must be comp or sponsored.\n${GRANT_ACCESS_USAGE}` };
  const endsAt = parseUntil(until);
  if (endsAt === undefined) return { ok: false, message: `--until must be a date like 2027-06-30, or none.\n${GRANT_ACCESS_USAGE}` };
  return { ok: true, by: by.trim(), household: household.trim(), kind: kind as StaffGrantKind, endsAt };
}
