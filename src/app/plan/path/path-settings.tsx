"use client";

import { useId, useState } from "react";
import { type PathSettingsState, savePathSettingsAction } from "@/app/actions/path";
import { Button, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import type { PlannerState } from "@/lib/planner/common";
import { LANGUAGE_NAMES, LANGUAGES } from "@/lib/planner/course-types";
import { COHORT_OVERRIDE_REASONS, MAX_COLLEGE_LEVEL_PER_YEAR } from "@/lib/planner/engine-io";
import { MAJOR_FAMILIES } from "@/lib/planner/families";
import { PATH_KINDS, TN_ELECTIVE_FOCUSES, TX_ENDORSEMENTS } from "@/lib/planner/rules";
import { COHORT_REASON_LABELS, PATH_LABELS, TN_FOCUS_LABELS, TX_ENDORSEMENT_LABELS } from "@/lib/planner/view";
import { announcePath, focusPath } from "./announcer";

// The path's settings and the choices a rule depends on. Every control is labeled, values survive
// a failed save (useFormAction), and each save is announced once.

export type PathSettingsValues = {
  /** The stored kind of path, or "" while it follows the student's goals. */
  path: string;
  pathInferred: boolean;
  /** What the goals point to (shown on "Let my goals decide"). */
  inferredPath: string;
  familyId: string;
  maxCollegeLevelPerYear: number;
  accelerateMath: boolean;
  txEndorsement: string;
  /** Shown checked when the student chose it, or by default on the degree path. */
  txAimDla: boolean;
  tnElectiveFocus: string;
  worldLanguage: string;
  /** "You started 9th grade in fall 2026 (class of 2030)": the years used, the years from the grade, and why they differ. */
  grade9EntryYear: number | null;
  classYear: number | null;
  grade9EntryDefault: number | null;
  classYearDefault: number | null;
  cohortReason: string;
};

const select =
  "mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-base focus-visible:outline-2 focus-visible:outline-accent";

/**
 * Saves and announces the result from the action itself: a decision's card disappears once it's
 * made, so an effect in it would never run. `focusAfter` gets focus after a save that may remove
 * the form (falling back to the path's heading).
 */
function useSave(focusAfter?: string) {
  const [state, action, pending, values] = useFormAction<PathSettingsState>(async (prev, formData) => {
    const res = await savePathSettingsAction(prev, formData);
    if (res?.ok && res.message) {
      announcePath(res.message);
      if (focusAfter) setTimeout(() => focusPath(focusAfter), 300);
    }
    return res;
  }, undefined);
  return { state, action, pending, values };
}

export function EndorsementSelect({ id, value, describedBy }: { id: string; value: string; describedBy?: string }) {
  return (
    <select id={id} name="txEndorsement" defaultValue={value} aria-describedby={describedBy} className={select}>
      <option value="">Not sure yet</option>
      {TX_ENDORSEMENTS.map((e) => (
        <option key={e} value={e}>
          {TX_ENDORSEMENT_LABELS[e]}
        </option>
      ))}
    </select>
  );
}

export function FocusSelect({ id, value, describedBy }: { id: string; value: string; describedBy?: string }) {
  return (
    <select id={id} name="tnElectiveFocus" defaultValue={value} aria-describedby={describedBy} className={select}>
      <option value="">Not sure yet</option>
      {TN_ELECTIVE_FOCUSES.map((f) => (
        <option key={f} value={f}>
          {TN_FOCUS_LABELS[f]}
        </option>
      ))}
    </select>
  );
}

export function LanguageSelect({ id, value }: { id: string; value: string }) {
  return (
    <select id={id} name="worldLanguage" defaultValue={value} className={select}>
      <option value="">Not sure yet</option>
      {LANGUAGES.map((l) => (
        <option key={l} value={l}>
          {LANGUAGE_NAMES[l]}
        </option>
      ))}
    </select>
  );
}

export function FamilySelect({ id, value, northStarNote, describedBy }: { id: string; value: string; northStarNote: string; describedBy?: string }) {
  return (
    <select id={id} name="familyId" defaultValue={value} aria-describedby={describedBy} className={select}>
      <option value="">{northStarNote}</option>
      {MAJOR_FAMILIES.map((f) => (
        <option key={f.id} value={f.id}>
          {f.title}
        </option>
      ))}
    </select>
  );
}

/** A pending decision's one-question form ("Name your Texas endorsement"). */
export function DecisionForm({ field, label, value }: { field: "txEndorsement" | "tnElectiveFocus" | "worldLanguage" | "familyId"; label: string; value: string }) {
  const id = useId();
  const { state, action, pending, values } = useSave("path-decisions");
  const current = values[field] ?? value;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2 print:hidden">
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {field === "txEndorsement" && <EndorsementSelect key={current} id={id} value={current} />}
        {field === "tnElectiveFocus" && <FocusSelect key={current} id={id} value={current} />}
        {field === "worldLanguage" && <LanguageSelect key={current} id={id} value={current} />}
        {field === "familyId" && <FamilySelect key={current} id={id} value={current} northStarNote="Use my north star careers" />}
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        Save
      </Button>
      {state && !state.ok && <FormMessage message={state.message} />}
    </form>
  );
}

/**
 * "What your path plans for": the kind of path, the family, limits, state choices and the
 * student's class year. Only what the student changes is saved (`touched`), so a default they never
 * picked (the inferred path, the DLA on the degree path, the college-level limit) keeps following
 * the goals and any later change to the default.
 */
export function PathSettings({ state: plannerState, initial }: { state: PlannerState; initial: PathSettingsValues }) {
  const ids = useId();
  const { state, action, pending, values } = useSave();
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const touch = (name: string) => setTouched((t) => (t.has(name) ? t : new Set(t).add(name)));
  const v = (name: keyof PathSettingsValues) => (values[name] !== undefined ? values[name] : String(initial[name] ?? ""));
  const checked = (name: "accelerateMath" | "txAimDla") => (values[`${name}:present`] !== undefined ? values[name] === "on" : initial[name]);
  const years = (around: number | null) => (around === null ? [] : [around - 2, around - 1, around, around + 1, around + 2]);
  return (
    <form
      action={action}
      className="space-y-5"
      onChange={(e) => {
        const name = (e.target as unknown as { name?: string }).name?.replace(/:present$/, "");
        if (name) touch(name);
      }}
    >
      <input type="hidden" name="touched" value={[...touched].join(",")} />
      <fieldset>
        <legend className="font-medium">What are you planning for after high school?</legend>
        <div className="mt-2 space-y-1">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="radio" name="path" value="" defaultChecked={v("path") === ""} className="size-5 shrink-0" />
            <span>
              Let my goals decide
              {initial.inferredPath && (
                <span className="block text-muted">
                  Right now that&apos;s: {PATH_LABELS[initial.inferredPath as keyof typeof PATH_LABELS] ?? initial.inferredPath}
                </span>
              )}
            </span>
          </label>
          {PATH_KINDS.map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-3 text-sm">
              <input type="radio" name="path" value={p} defaultChecked={v("path") === p} className="size-5 shrink-0" />
              {PATH_LABELS[p]}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${ids}-family`} className="block font-medium">
          Plan around this kind of major or program
        </label>
        <p id={`${ids}-family-hint`} className="text-sm text-muted">
          We usually pick this from your north star careers.
        </p>
        <FamilySelect id={`${ids}-family`} value={v("familyId")} northStarNote="Use my north star careers" describedBy={`${ids}-family-hint`} />
      </div>

      <div>
        <label htmlFor={`${ids}-max`} className="block font-medium">
          At most how many AP, IB or college-credit classes in one year?
        </label>
        <p id={`${ids}-max-hint`} className="text-sm text-muted">
          We never suggest more than this. Three is plenty for most students; strong work in the subjects that matter for
          your goals counts for more than the number of advanced classes.
        </p>
        <select
          id={`${ids}-max`}
          name="maxCollegeLevelPerYear"
          defaultValue={v("maxCollegeLevelPerYear")}
          aria-describedby={`${ids}-max-hint`}
          className={`${select} sm:w-40`}
        >
          {Array.from({ length: MAX_COLLEGE_LEVEL_PER_YEAR + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div>
        <input type="hidden" name="accelerateMath:present" value="1" />
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" name="accelerateMath" defaultChecked={checked("accelerateMath")} className="mt-0.5 size-5 shrink-0" />
          <span>
            <span className="font-medium">Show ways to move ahead in math</span>
            <span className="block text-muted">Like two math classes in one year or a summer class. Only after a B or better in your last math class.</span>
          </span>
        </label>
      </div>

      {plannerState === "TX" && (
        <>
          <div>
            <label htmlFor={`${ids}-endorsement`} className="block font-medium">
              Your Texas endorsement
            </label>
            <p id={`${ids}-endorsement-hint`} className="text-sm text-muted">
              You name one when you start 9th grade and can switch anytime.
            </p>
            <EndorsementSelect id={`${ids}-endorsement`} value={v("txEndorsement")} describedBy={`${ids}-endorsement-hint`} />
          </div>
          <div>
            <input type="hidden" name="txAimDla:present" value="1" />
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input type="checkbox" name="txAimDla" defaultChecked={checked("txAimDla")} className="mt-0.5 size-5 shrink-0" />
              <span>
                <span className="font-medium">Plan for the Distinguished Level of Achievement</span>
                <span className="block text-muted">
                  The course route to automatic admission at Texas public universities. There&apos;s also a test-score route.
                </span>
              </span>
            </label>
          </div>
        </>
      )}

      {plannerState === "TN" && (
        <div>
          <label htmlFor={`${ids}-focus`} className="block font-medium">
            Your Tennessee elective focus
          </label>
          <p id={`${ids}-focus-hint`} className="text-sm text-muted">
            Three credits in one area, chosen by the end of 10th grade.
          </p>
          <FocusSelect id={`${ids}-focus`} value={v("tnElectiveFocus")} describedBy={`${ids}-focus-hint`} />
        </div>
      )}

      <div>
        <label htmlFor={`${ids}-language`} className="block font-medium">
          World language
        </label>
        <LanguageSelect id={`${ids}-language`} value={v("worldLanguage")} />
      </div>

      {initial.grade9EntryYear !== null && initial.classYear !== null && (
        <fieldset className="space-y-2">
          <legend className="font-medium">
            You started 9th grade in fall {initial.grade9EntryYear} (class of {initial.classYear}). Is that right?
          </legend>
          <input type="hidden" name="grade9EntryDefault" value={String(initial.grade9EntryDefault ?? "")} />
          <input type="hidden" name="classYearDefault" value={String(initial.classYearDefault ?? "")} />
          <p id={`${ids}-cohort-hint`} className="text-sm text-muted">
            Rules depend on the year you started high school. Change these only if you repeated or skipped a grade, moved, or
            are graduating early.
          </p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label htmlFor={`${ids}-entry`} className="block text-sm font-medium">
                Started 9th grade in fall
              </label>
              <select id={`${ids}-entry`} name="grade9EntryYear" defaultValue={v("grade9EntryYear")} aria-describedby={`${ids}-cohort-hint`} className={`${select} sm:w-40`}>
                {years(initial.grade9EntryDefault).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-class`} className="block text-sm font-medium">
                Class of
              </label>
              <select id={`${ids}-class`} name="classYear" defaultValue={v("classYear")} aria-describedby={`${ids}-cohort-hint`} className={`${select} sm:w-40`}>
                {years(initial.classYearDefault).map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-1 basis-56">
              <label htmlFor={`${ids}-reason`} className="block text-sm font-medium">
                Why is it different?
              </label>
              <select id={`${ids}-reason`} name="cohortReason" defaultValue={v("cohortReason")} aria-describedby={`${ids}-cohort-hint`} className={select}>
                <option value="">It isn&apos;t different</option>
                {COHORT_OVERRIDE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {COHORT_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          Save choices
        </Button>
        {state?.ok && <p className="text-sm text-muted">{state.message}</p>}
      </div>
      {state && !state.ok && <FormMessage message={state.message} />}
    </form>
  );
}
