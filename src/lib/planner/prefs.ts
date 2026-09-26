import { eq } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { studentPlanPrefs } from "@/db/schema";
import type { CohortOverrides } from "./cohort";
import { CTE_CLUSTERS, LANGUAGES } from "./course-types";
import {
  COHORT_OVERRIDE_REASONS,
  CLASSES_PER_YEAR_RANGE,
  DEFAULT_LIMITS,
  MAX_COLLEGE_LEVEL_PER_YEAR,
  type PlannerChoices,
  type PlannerLimits,
  type SuggestionKey,
} from "./engine-io";
import { FAMILY_IDS, type FamilyId } from "./families";
import { PATH_KINDS, type PathKind, TN_ELECTIVE_FOCUSES, TX_ENDORSEMENTS } from "./rules";

// A student's class-planning choices (student_plan_prefs): what they plan toward, choices a rule
// depends on, their limits and the suggestions they set aside. The JSON is checked field by field
// when read, so a value an older release stored (or anything malformed) is dropped rather than
// trusted, and one bad field never discards the rest. Plans are computed from these on demand.

/** Suggestions a student can set aside; the oldest are forgotten past this. */
export const MAX_DISMISSED = 300;
/** Suggestion keys are short, readable ids ("tx.fhsp.grad/arts/arts.visual/regular"). */
const SUGGESTION_KEY = /^[a-z0-9_.:/#+-]{3,200}$/i;

export function isSuggestionKey(value: unknown): value is SuggestionKey {
  return typeof value === "string" && SUGGESTION_KEY.test(value);
}

export type PlanPrefs = {
  /** The kind of path the student picked; null until they pick (the service infers one). */
  path: PathKind | null;
  /** A major family the student chose to plan around; null means their north stars decide. */
  familyId: FamilyId | null;
  choices: PlannerChoices;
  limits: PlannerLimits;
  cohort: CohortOverrides;
  dismissed: SuggestionKey[];
  updatedAt: Date | null;
};

export const EMPTY_PLAN_PREFS: PlanPrefs = {
  path: null,
  familyId: null,
  choices: {},
  limits: DEFAULT_LIMITS,
  cohort: {},
  dismissed: [],
  updatedAt: null,
};

const CHOICE_FIELDS = {
  txEndorsements: z.array(z.enum(TX_ENDORSEMENTS)).max(TX_ENDORSEMENTS.length),
  txAimDla: z.boolean(),
  txFoundationOnly: z.boolean(),
  tnElectiveFocus: z.enum(TN_ELECTIVE_FOCUSES),
  worldLanguage: z.enum(LANGUAGES),
  ctePathway: z.object({ cluster: z.enum(CTE_CLUSTERS), name: z.string().max(80).optional() }),
  utMath3OptOut: z.boolean(),
  tnWorldLanguageWaiver: z.boolean(),
  tnFineArtsWaiver: z.boolean(),
  txArtsHumanitiesScienceSwap: z.boolean(),
  utMathCompetencyMet: z.boolean(),
} satisfies { [K in keyof Required<PlannerChoices>]: z.ZodType<PlannerChoices[K]> };

const LIMIT_FIELDS = {
  maxCollegeLevelPerYear: z.number().int().min(0).max(MAX_COLLEGE_LEVEL_PER_YEAR),
  classesPerYear: z.number().int().min(CLASSES_PER_YEAR_RANGE.min).max(CLASSES_PER_YEAR_RANGE.max).nullable(),
  allowSummer: z.boolean(),
  allowOnline: z.boolean(),
  allowCollegeCredit: z.boolean(),
  accelerateMath: z.boolean(),
} satisfies { [K in keyof PlannerLimits]: z.ZodType<PlannerLimits[K]> };

const COHORT_OVERRIDE = z.object({ year: z.number().int().min(2000).max(2100), reason: z.enum(COHORT_OVERRIDE_REASONS) });

/** The fields of `raw` that pass their own check; anything else is left out. */
function validFields<T extends Record<string, z.ZodType>>(fields: T, raw: unknown): { [K in keyof T]?: z.output<T[K]> } {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out as { [K in keyof T]?: z.output<T[K]> };
  for (const [key, schema] of Object.entries(fields)) {
    const parsed = schema.safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as { [K in keyof T]?: z.output<T[K]> };
}

export function parseChoices(raw: unknown): PlannerChoices {
  return validFields(CHOICE_FIELDS, raw);
}

export function parseLimits(raw: unknown): PlannerLimits {
  return { ...DEFAULT_LIMITS, ...validFields(LIMIT_FIELDS, raw) };
}

export function parseCohort(raw: unknown): CohortOverrides {
  return validFields({ grade9Entry: COHORT_OVERRIDE, classYear: COHORT_OVERRIDE }, raw);
}

type Row = typeof studentPlanPrefs.$inferSelect;

export function prefsFromRow(row: Row | undefined): PlanPrefs {
  if (!row) return EMPTY_PLAN_PREFS;
  const path = z.enum(PATH_KINDS).safeParse(row.targets?.path);
  const family = z.enum(FAMILY_IDS).safeParse(row.targets?.familyId);
  return {
    path: path.success ? path.data : null,
    familyId: family.success ? family.data : null,
    choices: parseChoices(row.choices),
    limits: parseLimits(row.limits),
    cohort: parseCohort(row.cohort),
    dismissed: (row.dismissed ?? []).filter(isSuggestionKey),
    updatedAt: row.updatedAt,
  };
}

export async function getPlanPrefs(db: Db, userId: string): Promise<PlanPrefs> {
  const [row] = await db.select().from(studentPlanPrefs).where(eq(studentPlanPrefs.userId, userId));
  return prefsFromRow(row);
}

/** A change to the stored prefs. `null` clears a field (a choice back to "not sure yet", a limit or cohort back to the default). */
export type PlanPrefsPatch = {
  path?: PathKind | null;
  familyId?: FamilyId | null;
  choices?: { [K in keyof PlannerChoices]?: PlannerChoices[K] | null };
  limits?: { [K in keyof PlannerLimits]?: PlannerLimits[K] | null };
  /** "You started 9th grade in fall 2026 (class of 2030). Is that right?": a repeated or skipped grade, a move, early graduation. */
  cohort?: { [K in keyof CohortOverrides]?: CohortOverrides[K] | null };
  dismissed?: SuggestionKey[];
};

/** The stored JSON object as it is (defaults are applied when reading, never stored). */
function rawObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

/** `patch` applied to `base`: a value sets the field, `null` removes it, `undefined` leaves it. */
function applyPatch(base: Record<string, unknown>, patch: Record<string, unknown> | undefined): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete out[key];
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Applies a patch to the student's prefs (creating the row on first save) and returns the result. */
export async function updatePlanPrefs(db: Db, userId: string, patch: PlanPrefsPatch, now = new Date()): Promise<PlanPrefs> {
  const [row] = await db.select().from(studentPlanPrefs).where(eq(studentPlanPrefs.userId, userId));
  const current = prefsFromRow(row);
  const choices = applyPatch(current.choices, patch.choices);
  const path = "path" in patch ? patch.path : current.path;
  const familyId = "familyId" in patch ? patch.familyId : current.familyId;
  const next = {
    targets: { ...(path ? { path } : {}), ...(familyId ? { familyId } : {}) },
    // Re-checked on the way in too: only valid values are ever stored.
    choices: parseChoices(choices),
    // Only what the student set is stored, so a later change to a default reaches everyone who
    // never chose (DEFAULT_LIMITS is applied when reading).
    limits: validFields(LIMIT_FIELDS, applyPatch(rawObject(row?.limits), patch.limits)),
    cohort: parseCohort(applyPatch(rawObject(row?.cohort), patch.cohort)),
    dismissed: (patch.dismissed ?? current.dismissed).filter(isSuggestionKey).slice(-MAX_DISMISSED),
    updatedAt: now,
  };
  await db
    .insert(studentPlanPrefs)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: studentPlanPrefs.userId, set: next });
  return getPlanPrefs(db, userId);
}

/** Sets a suggestion aside ("Not for me"). Already set aside: nothing changes. */
export async function addDismissed(db: Db, userId: string, key: SuggestionKey, now = new Date()): Promise<void> {
  const current = await getPlanPrefs(db, userId);
  if (current.dismissed.includes(key)) return;
  await updatePlanPrefs(db, userId, { dismissed: [...current.dismissed, key] }, now);
}

/** Brings back one set-aside suggestion, or all of them. */
export async function removeDismissed(db: Db, userId: string, key: SuggestionKey | "all", now = new Date()): Promise<void> {
  const current = await getPlanPrefs(db, userId);
  const dismissed = key === "all" ? [] : current.dismissed.filter((k) => k !== key);
  if (dismissed.length === current.dismissed.length) return;
  await updatePlanPrefs(db, userId, { dismissed }, now);
}

/** The student's planning choices for their data download (null when they never saved any). */
export async function exportPlanPrefs(db: Db, userId: string) {
  const [row] = await db.select().from(studentPlanPrefs).where(eq(studentPlanPrefs.userId, userId));
  if (!row) return null;
  const { userId: _userId, ...rest } = row;
  return rest;
}
