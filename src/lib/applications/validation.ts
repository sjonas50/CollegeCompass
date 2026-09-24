import * as z from "zod";
import type { AidOffer, ApplicationChecklist, CollegeListStatus, DeadlineType } from "@/db/schema";
import { MAX_AID_AMOUNT } from "./aid";
import { deadlineWindow, isIsoDate } from "./dates";
import { AID_FIELDS, type AidField, CHECKLIST_KEYS, type ChecklistKey, DEADLINE_TYPES, ENTRY_KINDS, type EntryKind, LIST_STATUSES } from "./labels";

// Input rules for the college list. The service functions parse with these, so the server
// actions, the counselor (later) and tests all get the same checks.

export const NAME_MAX = 100;
export const NOTES_MAX = 1000;

export type FieldErrors = Record<string, string[] | undefined>;

/** Zod issues keyed by dotted path ("name", "aidOffer.grants"). */
export function issueErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const isBlank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const blankToNull = (v: unknown) => (isBlank(v) ? null : v);

// ---------------------------------------------------------------------------
// Adding
// ---------------------------------------------------------------------------

const COLLEGE_NOT_FOUND = "We couldn't find that college.";

/** A College Scorecard UNITID, from a number or a form string. */
export const UnitIdSchema = z.coerce
  .number({ error: COLLEGE_NOT_FOUND })
  .int(COLLEGE_NOT_FOUND)
  .positive(COLLEGE_NOT_FOUND)
  .max(2_147_483_647, COLLEGE_NOT_FOUND);

export const CustomEntrySchema = z.object({
  name: z
    .string({ error: "Give it a name." })
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Give it a name.").max(NAME_MAX, `Use ${NAME_MAX} characters or fewer.`)),
  kind: z.enum(ENTRY_KINDS, { error: "Choose a college or a training program." }),
});

export type CustomEntryInput = z.output<typeof CustomEntrySchema>;

export function customEntryFormInput(formData: FormData): Record<string, unknown> {
  const kind = formData.get("kind");
  return { name: formData.get("name") ?? "", kind: typeof kind === "string" ? kind : undefined };
}

// ---------------------------------------------------------------------------
// Updating
// ---------------------------------------------------------------------------

const MONEY_ERROR = `Enter whole dollars from 0 to ${MAX_AID_AMOUNT.toLocaleString("en-US")}, like 12500.`;

/** A whole-dollar amount typed as "12500", "12,500" or "$12,500". Blank means "not on the offer". */
const money = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v ?? null;
    const s = v.replace(/[$,\s]/g, "");
    if (s === "") return null;
    return /^\d+(\.0+)?$/.test(s) ? Number(s) : Number.NaN;
  },
  z.number({ error: MONEY_ERROR }).int(MONEY_ERROR).min(0, MONEY_ERROR).max(MAX_AID_AMOUNT, MONEY_ERROR).nullable(),
);

const aidOfferSchema = z
  .strictObject(
    Object.fromEntries(AID_FIELDS.map((f) => [f, money.optional()])) as Record<AidField, z.ZodOptional<typeof money>>,
    { error: "That aid offer has an amount we don't know." },
  )
  .transform((o): AidOffer | null => {
    const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number")) as AidOffer;
    return Object.keys(kept).length ? kept : null;
  });

const checklistSchema = z.strictObject(
  Object.fromEntries(
    CHECKLIST_KEYS.map((k) => [k, z.boolean({ error: "Checklist items are checked or not." }).optional()]),
  ) as Record<ChecklistKey, z.ZodOptional<z.ZodBoolean>>,
  { error: "That checklist has an item we don't know." },
);

/**
 * Changes to one list entry. Every field is optional; a missing field stays as it is.
 * - `deadlineType`, `deadline`, `notes`: blank or null clears them ("none" also clears the type).
 * - `deadline`: a real date within two years of `today`. `keepDeadline` (the saved date) is always
 *   accepted, so an old deadline doesn't block saving other changes.
 * - `checklist`: the items given are merged into the saved checklist.
 * - `aidOffer`: replaces the saved offer. Blank amounts are left off, and an offer with no
 *   amounts at all (or null) removes it.
 */
export function entryPatchSchema(today: string, keepDeadline?: string | null) {
  const window = deadlineWindow(today);
  return z.strictObject(
    {
      status: z.enum(LIST_STATUSES, { error: "Choose a status from the list." }).optional(),
      deadlineType: z
        .preprocess(
          (v) => (v === "none" ? null : blankToNull(v)),
          z.enum(DEADLINE_TYPES, { error: "Choose a deadline type from the list." }).nullable(),
        )
        .optional(),
      deadline: z
        .preprocess(
          (v) => (typeof v === "string" ? blankToNull(v.trim()) : blankToNull(v)),
          z
            .string({ error: "Enter a date like 2026-11-01." })
            .refine(isIsoDate, { error: "Enter a real date, like 2026-11-01.", abort: true })
            .refine((d) => d === keepDeadline || (d >= window.min && d <= window.max), {
              error: "Pick a date within two years of today.",
            })
            .nullable(),
        )
        .optional(),
      notes: z
        .preprocess(
          (v) => (typeof v === "string" ? blankToNull(v.trim()) : blankToNull(v)),
          z
            .string({ error: "Notes should be text." })
            .max(NOTES_MAX, `Keep notes to ${NOTES_MAX.toLocaleString("en-US")} characters or fewer.`)
            .nullable(),
        )
        .optional(),
      checklist: checklistSchema.optional(),
      aidOffer: aidOfferSchema.nullable().optional(),
    },
    { error: "We couldn't save that change." },
  );
}

export type EntryPatch = {
  status?: CollegeListStatus;
  deadlineType?: DeadlineType | null;
  deadline?: string | null;
  notes?: string | null;
  checklist?: ApplicationChecklist;
  aidOffer?: AidOffer | null;
};

/**
 * Maps the entry form to `entryPatchSchema` input. Sections the form didn't include are left
 * out (so they aren't cleared); unchecked boxes are sent as false.
 */
export function entryFormInput(formData: FormData): Record<string, unknown> {
  const text = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : undefined;
  };
  const input: Record<string, unknown> = {};
  for (const key of ["status", "deadlineType", "deadline", "notes"] as const) {
    const v = text(key);
    if (v !== undefined) input[key] = v;
  }
  if (formData.has("has_checklist")) {
    input.checklist = Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, formData.get(`check_${k}`) === "on"]));
  }
  if (formData.has("has_aid")) {
    input.aidOffer = Object.fromEntries(AID_FIELDS.map((f) => [f, text(`aid_${f}`) ?? ""]));
  }
  return input;
}

/** Form field name for a patch error key ("aidOffer.grants" → "aid_grants"). */
export function formFieldFor(errorKey: string): string {
  if (errorKey.startsWith("aidOffer.")) return `aid_${errorKey.slice("aidOffer.".length)}`;
  if (errorKey.startsWith("checklist.")) return `check_${errorKey.slice("checklist.".length)}`;
  return errorKey;
}

/** Patch errors keyed by form field name. */
export function formErrors(errors: FieldErrors): FieldErrors {
  const out: FieldErrors = {};
  for (const [key, messages] of Object.entries(errors)) {
    const field = formFieldFor(key);
    out[field] = [...(out[field] ?? []), ...(messages ?? [])];
  }
  return out;
}

export type { EntryKind };
