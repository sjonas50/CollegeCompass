import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { households, users } from "@/db/schema";
import { env } from "@/env";
import { findHousehold, staffIdByEmail } from "../access/staff";
import { assertAdmin } from "../admin/access";
import { audit } from "../audit";

// The class planner's "Your path" is in beta. It shows (on /plan, its print view and a parent's
// read-only path) only for households staff mark with `npm run beta:planner`, for staff, or for
// everyone when PLANNER_PATH=everyone. Everyone else keeps today's checklist and course ideas. The
// free /graduation pages and the state and school settings aren't part of it.

/**
 * Whether "Your path" shows for this account's household: a student's own, or the child a parent is
 * looking at (pass the child's id). Staff (admin) accounts preview it.
 */
export async function plannerPathEnabled(db: Db, userId: string): Promise<boolean> {
  if (env().PLANNER_PATH === "everyone") return true;
  const [row] = await db
    .select({ role: users.role, beta: households.plannerBeta })
    .from(users)
    .leftJoin(households, eq(households.id, users.householdId))
    .where(eq(users.id, userId));
  if (!row) return false;
  return row.role === "admin" || row.beta === true;
}

export type SetPlannerBetaResult = { ok: true; householdId: string; on: boolean } | { ok: false; error: "household_not_found" };

/**
 * Marks a household for the beta (or takes it out), as staff: the actor must be an admin, checked
 * in the database. `household` is a household id, or a student's email or username. Audited as
 * planner.beta_set_by_staff with only on or off: no names, emails or ids.
 */
export async function setPlannerBeta(db: Db, actorId: string, input: { household: string; on: boolean }): Promise<SetPlannerBetaResult> {
  await assertAdmin(db, actorId);
  const target = await findHousehold(db, input.household);
  if (!target) return { ok: false, error: "household_not_found" };
  await db.update(households).set({ plannerBeta: input.on }).where(eq(households.id, target.householdId));
  await audit(db, "planner.beta_set_by_staff", { actorUserId: actorId, metadata: { on: input.on } });
  return { ok: true, householdId: target.householdId, on: input.on };
}

// ---------------------------------------------------------------------------
// The beta:planner script's arguments
// ---------------------------------------------------------------------------

export const BETA_PLANNER_USAGE =
  "Usage: npm run beta:planner -- --by staff@example.com --household <household id, or a student's email or username> [--off]\n" +
  "--by is your staff account's email. Without --off the household sees \"Your path\"; with --off it goes back to the checklist.";

export type BetaPlannerArgs = { ok: true; by: string; household: string; on: boolean } | { ok: false; message: string };

/** Reads `--by`, `--household` (as `--flag value` or `--flag=value`) and `--off`. */
export function parseBetaPlannerArgs(argv: readonly string[]): BetaPlannerArgs {
  const values: Record<string, string> = {};
  let on = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { ok: false, message: BETA_PLANNER_USAGE };
    if (arg === "--off") {
      on = false;
      continue;
    }
    const match = /^--(by|household)(?:=(.*))?$/.exec(arg);
    if (!match) return { ok: false, message: `Unknown argument: ${arg}\n${BETA_PLANNER_USAGE}` };
    const value = match[2] ?? argv[++i];
    if (value === undefined || value.startsWith("--")) return { ok: false, message: `--${match[1]} needs a value.\n${BETA_PLANNER_USAGE}` };
    values[match[1]] = value;
  }
  const { by, household } = values;
  if (!by?.trim() || !household?.trim()) return { ok: false, message: BETA_PLANNER_USAGE };
  return { ok: true, by: by.trim(), household: household.trim(), on };
}

/** The script: the staff account from `--by`, then the change. Returns the line to print, or an error. */
export async function runBetaPlanner(db: Db, argv: readonly string[]): Promise<{ ok: boolean; message: string }> {
  const args = parseBetaPlannerArgs(argv);
  if (!args.ok) return { ok: false, message: args.message };
  const actorId = await staffIdByEmail(db, args.by);
  if (!actorId) return { ok: false, message: "No staff account has that email. Create one with npm run admin:create." };
  const result = await setPlannerBeta(db, actorId, { household: args.household, on: args.on });
  if (!result.ok) return { ok: false, message: "No household matches that. Use a household id, or the email or username of a student in it." };
  return {
    ok: true,
    message: result.on
      ? `Household ${result.householdId} now sees "Your path" (the class planner beta).`
      : `Household ${result.householdId} is out of the class planner beta: it sees the checklist and course ideas again.`,
  };
}
