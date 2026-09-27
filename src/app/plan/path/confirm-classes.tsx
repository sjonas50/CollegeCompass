"use client";

import { useId, useRef, useState, useTransition } from "react";
import { confirmCourseTypeAction } from "@/app/actions/path";
import { Button } from "@/components/ui";
import { announcePath, focusPath } from "./announcer";
import { afterAction } from "./suggestion-actions";

// "Confirm your classes" at the top of "Your path" (confirm first, engine/confirm.ts): each class
// typed without its kind, with the planner's best guess as one tap ("Algebra II?" Yes) or "Something
// else…" to pick the kind from the list. Confirming stores the kind (course_type_id) as the
// student's choice. At most six at once, grouped by year; the rest come up as these are confirmed.

export type ConfirmRow = {
  courseId: string;
  /** The student's own name for the class (their screen only). */
  name: string;
  grade: number;
  gradeLabel: string;
  /** The one-tap guess, or null when the name gives no good guess (the list opens instead). */
  guess: { typeId: string; title: string } | null;
  /** Kinds of class for its subject and level. */
  options: { value: string; label: string }[];
  /** Requirements that wait on it. */
  decides: number;
};

export const CONFIRM_HEADING_ID = "path-confirm";

function ConfirmOne({ row }: { row: ConfirmRow }) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [choosing, setChoosing] = useState(row.guess === null);
  const [picked, setPicked] = useState(row.guess?.typeId ?? "");
  const selectRef = useRef<HTMLSelectElement>(null);

  function save(typeId: string) {
    setError(undefined);
    startTransition(async () => {
      afterAction(await confirmCourseTypeAction(row.courseId, typeId), CONFIRM_HEADING_ID, { setError, announce: announcePath, focus: focusPath });
    });
  }

  const selectId = `${id}-kind`;
  return (
    <li className="rounded-lg bg-background px-3 py-2">
      <p className="text-sm">
        <span className="font-medium">{row.name}</span>
        {row.guess && !choosing && (
          <>
            {" "}
            <span className="text-muted">·</span> {row.guess.title}?
          </>
        )}
      </p>
      {!choosing && row.guess ? (
        <div className="mt-1 flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => save(row.guess!.typeId)}>
            Yes<span className="sr-only">, {row.name} is {row.guess.title}</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setPicked("");
              setChoosing(true);
              // The list opens where the button was: move focus into it.
              requestAnimationFrame(() => selectRef.current?.focus());
            }}
          >
            Something else…<span className="sr-only"> for {row.name}</span>
          </Button>
        </div>
      ) : (
        <form
          className="mt-1 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (picked) save(picked);
          }}
        >
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor={selectId} className="block text-sm">
              What kind of class is {row.name}?
            </label>
            <select
              ref={selectRef}
              id={selectId}
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-accent"
            >
              <option value="">Choose a kind of class</option>
              {row.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending || !picked}>
            Save<span className="sr-only"> the kind of {row.name}</span>
          </Button>
          {row.guess && (
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setChoosing(false)}>
              Back
            </Button>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

/** The card, for the student: at most six classes at once, grouped by year. */
export function ConfirmClasses({ rows, more, mode }: { rows: ConfirmRow[]; more: number; mode: "student" | "parent" }) {
  if (!rows.length) return null;
  const years = [...new Set(rows.map((r) => r.grade))].sort((a, b) => a - b);
  const waiting = rows.some((r) => r.decides > 0);
  return (
    <section aria-labelledby={CONFIRM_HEADING_ID} className="space-y-3 rounded-xl border border-accent bg-surface p-4 print:hidden">
      <div>
        <h3 id={CONFIRM_HEADING_ID} tabIndex={-1} className="text-lg font-medium focus:outline-none">
          Confirm your classes
        </h3>
        <p className="text-sm text-muted">
          {mode === "parent"
            ? "We guessed what kind of class these are from their names. Your child can confirm them on their Plan page; until then, the requirements they decide wait on them."
            : `We guessed what kind of class these are from their names. Until you confirm them, your path doesn't count them for a specific requirement or say one is missing${waiting ? ", and some requirements wait on them" : ""}.`}
        </p>
      </div>
      {years.map((grade) => {
        const inYear = rows.filter((r) => r.grade === grade);
        const headingId = `${CONFIRM_HEADING_ID}-${grade}`;
        return (
          <div key={grade} role="group" aria-labelledby={headingId}>
            <h4 id={headingId} className="text-sm font-medium">
              {inYear[0].gradeLabel}
            </h4>
            <ul className="mt-1 space-y-2">
              {inYear.map((row) =>
                mode === "student" ? (
                  <ConfirmOne key={row.courseId} row={row} />
                ) : (
                  <li key={row.courseId} className="rounded-lg bg-background px-3 py-2 text-sm">
                    <span className="font-medium">{row.name}</span>
                    {row.guess && <span className="text-muted"> · we guessed {row.guess.title}</span>}
                  </li>
                ),
              )}
            </ul>
          </div>
        );
      })}
      {more > 0 && (
        <p className="text-sm text-muted">
          {more} more {more === 1 ? "class" : "classes"} after these.
        </p>
      )}
    </section>
  );
}
