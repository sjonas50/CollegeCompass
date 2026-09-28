"use client";

import { useEffect, useId, useState } from "react";
import { Button, FieldError, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";
import { US_STATES } from "@/lib/colleges/states";
import type { FormState } from "@/lib/forms";
import { isPlannerState } from "@/lib/planner/common";
import { type SavedSchool, savedSchoolLabel, schoolDetails, stateCoverageNote } from "@/lib/schools/labels";
import { searchStatusText } from "@/lib/schools/names";
import type { SchoolOption } from "@/lib/schools/search";

// "Where you go to school": the state and school pickers, in a student's Settings and in each
// child's Settings on the parent page. One form, one Save. Schools are searched as the family
// types (POST /api/schools/search, never in a URL). Two ways out store no school name: "My school
// isn't listed" (with the family's own words, if they like) and "I'd rather not say".

export type SchoolPickerSettings = { homeState: string | null; current: SavedSchool | null; next: SavedSchool | null };

const control =
  "mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-accent";
const choiceCard =
  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2 has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-accent";

type Search = { query: string; state: string; status: "done" | "error" | "limited"; results: SchoolOption[]; truncated: boolean };

/**
 * One school question: search the state's schools, or pick one of the fixed answers. `value` is
 * the checked radio's value ("keep", "ref:<school_ref>", or one of `answers`).
 */
function SchoolChoice({
  id,
  name,
  nameField,
  legend,
  hint,
  searchLabel,
  state,
  value,
  onChange,
  keep,
  answers,
  errors,
  notListedDefault,
  excludeRef,
}: {
  id: string;
  name: "school" | "nextSchool";
  nameField: "notListedName" | "nextNotListedName";
  legend: string;
  hint?: string;
  /** "Find your school", "Find the high school". */
  searchLabel: string;
  state: string;
  value: string;
  onChange: (value: string, school: SchoolOption | null) => void;
  /** The saved answer, offered as "keep", or null. */
  keep: { label: string; detail: string | null } | null;
  answers: { value: string; label: string }[];
  errors?: string[];
  notListedDefault: string;
  /** A school not to offer (the current school, in the next-school question). */
  excludeRef?: string;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<Search | null>(null);
  const [picked, setPicked] = useState<SchoolOption | null>(null);
  const typed = query.trim();

  useEffect(() => {
    if (typed.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/schools/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state, query: typed }),
          signal: controller.signal,
        });
        if (!res.ok) {
          setSearch({ query: typed, state, status: res.status === 429 ? "limited" : "error", results: [], truncated: false });
          return;
        }
        const body = (await res.json()) as { results: SchoolOption[]; truncated?: boolean };
        setSearch({ query: typed, state, status: "done", results: body.results, truncated: body.truncated === true });
      } catch {
        if (!controller.signal.aborted) setSearch({ query: typed, state, status: "error", results: [], truncated: false });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [typed, state]);

  // Only results for what's in the box now (and this state) are shown.
  const current = search && search.query === typed && search.state === state && typed.length >= 2 ? search : null;
  const results = (current?.results ?? []).filter((r) => r.ref !== excludeRef);
  // A school picked from earlier results stays listed (and checked) while the family searches again.
  const pinned = picked && value === `ref:${picked.ref}` && !results.some((r) => r.ref === picked.ref) ? [picked, ...results] : results;
  const statusText =
    typed.length < 2
      ? ""
      : !current
        ? "Searching…"
        : current.status === "limited"
          ? "That's a lot of searches. Wait a few minutes and try again."
          : current.status === "error"
            ? "Search isn't working right now. Try again, or choose one of the answers below."
            : searchStatusText(typed, results.length, current.truncated);

  const select = (v: string, school: SchoolOption | null) => {
    if (school) setPicked(school);
    onChange(v, school);
  };

  return (
    <fieldset aria-describedby={[hint && `${id}-hint`, errors?.length && `${id}-error`].filter(Boolean).join(" ") || undefined}>
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <div className="mt-2 space-y-2">
        {keep && (
          <label className={choiceCard}>
            <input type="radio" name={name} value="keep" checked={value === "keep"} onChange={() => select("keep", null)} className="mt-1 size-5 shrink-0 accent-accent" />
            <span>
              <span className="block font-medium break-words">{keep.label}</span>
              {keep.detail && <span className="block text-sm text-muted">{keep.detail}</span>}
            </span>
          </label>
        )}
        <div>
          <label htmlFor={`${id}-search`} className="block text-sm">
            {keep ? "Or find another school" : searchLabel}
          </label>
          <input
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Enter searches (it's live anyway); it must not submit the settings.
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            maxLength={100}
            autoComplete="off"
            placeholder="School name or city"
            aria-describedby={`${id}-status`}
            className={control}
          />
          <p id={`${id}-status`} role="status" className="mt-1 text-sm text-muted">
            {statusText}
          </p>
        </div>
        {pinned.length > 0 && (
          <ul aria-label="Schools found" className="space-y-2">
            {pinned.map((s) => (
              <li key={s.ref}>
                <label className={choiceCard}>
                  <input
                    type="radio"
                    name={name}
                    value={`ref:${s.ref}`}
                    checked={value === `ref:${s.ref}`}
                    onChange={() => select(`ref:${s.ref}`, s)}
                    className="mt-1 size-5 shrink-0 accent-accent"
                  />
                  <span>
                    <span className="block font-medium break-words">{s.name}</span>
                    <span className="block text-sm text-muted">{schoolDetails(s)}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {answers.map((a) => (
          <div key={a.value}>
            <label className={choiceCard}>
              <input type="radio" name={name} value={a.value} checked={value === a.value} onChange={() => select(a.value, null)} className="mt-1 size-5 shrink-0 accent-accent" />
              <span>{a.label}</span>
            </label>
            {a.value === "not_listed" && value === "not_listed" && (
              <div className="mt-2 ml-8">
                <label htmlFor={`${id}-own-name`} className="block text-sm">
                  School name (optional)
                </label>
                <p id={`${id}-own-name-hint`} className="text-sm text-muted">
                  Only your family sees it. It helps you remember what you picked.
                </p>
                <input
                  id={`${id}-own-name`}
                  name={nameField}
                  defaultValue={notListedDefault}
                  maxLength={120}
                  autoComplete="off"
                  aria-describedby={`${id}-own-name-hint`}
                  className={control}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <FieldError id={`${id}-error`} errors={errors} />
    </fieldset>
  );
}

function keepFor(saved: SavedSchool | null): { label: string; detail: string | null } | null {
  if (!saved) return null;
  return { label: savedSchoolLabel(saved), detail: saved.school ? schoolDetails(saved.school) : null };
}

/**
 * The whole "Where you go to school" form. `childName` words it for a parent ("Maya's school").
 * The high school question shows when the chosen school ends before 12th grade.
 */
export function SchoolSettingsForm({
  action,
  idPrefix,
  studentId,
  childName,
  grade,
  settings,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  idPrefix: string;
  /** On the parent page: which child. */
  studentId?: string;
  childName?: string;
  grade: number | null;
  settings: SchoolPickerSettings;
}) {
  const id = useId();
  const [state, formAction, pending, values] = useFormAction<FormState>(action, undefined);
  const [homeState, setHomeState] = useState(values.state ?? settings.homeState ?? "");
  const sameState = homeState !== "" && homeState === settings.homeState;
  const [schoolValue, setSchoolValue] = useState(settings.current ? "keep" : "");
  const [schoolPicked, setSchoolPicked] = useState<SchoolOption | null>(null);
  const [nextValue, setNextValue] = useState(settings.next ? "keep" : "");

  const whose = childName ? `${childName}'s` : "your";
  const coverage = homeState ? stateCoverageNote(homeState, childName ? "the" : "your") : null;

  // The school the high school question depends on: the one picked now, or the saved one.
  const chosen =
    schoolValue.startsWith("ref:") ? schoolPicked : (schoolValue === "keep" || schoolValue === "") && sameState ? (settings.current?.school ?? null) : null;
  const high = chosen?.gradeHigh ?? null;
  const low = chosen?.gradeLow ?? null;
  const endsEarly = high !== null && high < 12 && (grade === null || grade <= high);
  const startsLater = low !== null && grade !== null && grade <= 12 && low > grade;
  const showNext = homeState !== "" && (endsEarly || (sameState && settings.next !== null));

  return (
    <form action={formAction} aria-labelledby={`${id}-title`} className="space-y-4">
      <div>
        <h3 id={`${id}-title`} className="text-sm font-medium">
          Where {childName ? `${childName} goes` : "you go"} to school
        </h3>
        <p className="text-sm text-muted">It takes a minute, and it&apos;s free.</p>
      </div>
      {studentId && <input type="hidden" name="studentId" value={studentId} />}
      <FormMessage message={state?.message} />
      <div>
        <label htmlFor={`${idPrefix}-state`} className="block text-sm">
          State
        </label>
        <p id={`${idPrefix}-state-hint`} className="text-sm text-muted">
          We use it to show in-state colleges and the state&apos;s financial aid first.
        </p>
        <select
          id={`${idPrefix}-state`}
          name="state"
          value={homeState}
          onChange={(e) => {
            setHomeState(e.target.value);
            // Schools are listed by state: a new state starts the school question over.
            const back = e.target.value === settings.homeState;
            setSchoolValue(back && settings.current ? "keep" : "");
            setNextValue(back && settings.next ? "keep" : "");
          }}
          aria-invalid={state?.errors?.state?.length ? true : undefined}
          aria-describedby={[`${idPrefix}-state-hint`, coverage && `${idPrefix}-state-note`, state?.errors?.state?.length && `${idPrefix}-state-error`]
            .filter(Boolean)
            .join(" ")}
          className={control}
        >
          <option value="">Choose a state</option>
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
              {isPlannerState(s.code) ? " (full class planning)" : ""}
            </option>
          ))}
        </select>
        {coverage && (
          <p id={`${idPrefix}-state-note`} className="mt-1 text-sm">
            {coverage}
          </p>
        )}
        <FieldError id={`${idPrefix}-state-error`} errors={state?.errors?.state} />
      </div>

      {homeState !== "" && (
        <SchoolChoice
          key={`current-${homeState}`}
          id={`${idPrefix}-school`}
          name="school"
          nameField="notListedName"
          searchLabel={childName ? "Find the school" : "Find your school"}
          legend="School"
          hint={`We use ${whose} school only to show its classes. We never share it with the AI counselor or show it to other families.`}
          state={homeState}
          value={schoolValue}
          onChange={(v, school) => {
            setSchoolValue(v);
            setSchoolPicked(school);
          }}
          keep={sameState ? keepFor(settings.current) : null}
          answers={[
            { value: "not_listed", label: `${childName ? "The school" : "My school"} isn't listed` },
            { value: "prefer_not_to_say", label: "I'd rather not say" },
          ]}
          errors={state?.errors?.school}
          notListedDefault={values.notListedName ?? settings.current?.notListedName ?? ""}
        />
      )}
      {startsLater && chosen && (
        <p className="text-sm">
          {chosen.name} starts at grade {low}. If {childName ? `${childName} isn't` : "you're not"} there yet, pick the school{" "}
          {childName ? "they go to" : "you go to"} now. You can add {chosen.name} as the high school {childName ? "they expect" : "you expect"} to go to.
        </p>
      )}

      {showNext && (
        <SchoolChoice
          key={`next-${homeState}`}
          id={`${idPrefix}-next`}
          name="nextSchool"
          nameField="nextNotListedName"
          searchLabel="Find the high school"
          excludeRef={chosen?.ref}
          legend={`Which high school ${childName ? `does ${childName}` : "do you"} expect to go to?`}
          hint={
            chosen && high !== null && high < 12
              ? `${chosen.name} ends at grade ${high}. Knowing the next school helps plan the classes after that. "Not sure yet" is fine.`
              : `"Not sure yet" is fine.`
          }
          state={homeState}
          value={nextValue}
          onChange={(v) => setNextValue(v)}
          keep={sameState ? keepFor(settings.next) : null}
          answers={[
            { value: "not_listed", label: "It isn't listed" },
            { value: "not_sure", label: "Not sure yet" },
          ]}
          notListedDefault={values.nextNotListedName ?? settings.next?.notListedName ?? ""}
        />
      )}

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
