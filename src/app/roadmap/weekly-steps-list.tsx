"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import {
  type AddStepState,
  type EditStepState,
  addStepAction,
  editStepAction,
  removeStepAction,
  setStepDoneAction,
} from "@/app/actions/roadmap";
import { Button, ButtonLink, Field, FieldError, FormMessage } from "@/components/ui";
import { useFocusFirstInvalid } from "@/components/use-focus-first-invalid";
import { useFormAction } from "@/components/use-form-action";

export type WeeklyStepItem = { id: string; text: string; status: "open" | "done"; milestoneId: string | null };
export type WeeklyStepStats = { stepsCompleted: number; weeksWithProgress: number };
/**
 * Where the empty state points for step ideas: a link to /roadmap, the "Add to this week" buttons
 * below (on the roadmap page), or nowhere (graduates, who have no roadmap milestones).
 */
export type StepIdeas = "roadmap" | "below" | "own";

type Change = { type: "toggle"; id: string; done: boolean } | { type: "remove"; id: string };

function applyChange(steps: WeeklyStepItem[], change: Change): WeeklyStepItem[] {
  if (change.type === "remove") return steps.filter((s) => s.id !== change.id);
  return steps.map((s) => (s.id === change.id ? { ...s, status: change.done ? "done" : "open" } : s));
}

/** Lifetime progress only: nothing here resets or "breaks" when a week is missed. */
function statsText({ stepsCompleted: n, weeksWithProgress: weeks }: WeeklyStepStats) {
  if (n === 0) return "Check off a step when you finish it. Every one counts.";
  const steps = n === 1 ? "1 step" : `${n} steps`;
  return weeks > 1 ? `You've finished ${steps} so far, across ${weeks} different weeks.` : `You've finished ${steps} so far.`;
}

/**
 * This week's steps with checkboxes, edit and remove buttons, and an "add your own" field.
 * Rendered by `WeeklyStepsCard` (src/components/weekly-steps.tsx), which loads the data.
 */
export function WeeklyStepsList({
  steps,
  stats,
  max,
  maxLength,
  ideas,
  headingId,
}: {
  steps: WeeklyStepItem[];
  stats: WeeklyStepStats;
  max: number;
  maxLength: number;
  ideas: StepIdeas;
  headingId: string;
}) {
  const [shown, change] = useOptimistic(steps, applyChange);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState("");

  function toggle(step: WeeklyStepItem, done: boolean) {
    setError(undefined);
    startTransition(async () => {
      change({ type: "toggle", id: step.id, done });
      const res = await setStepDoneAction(step.id, done);
      if (!res.ok) return setError(res.message);
      setStatus(done ? `Nice! “${step.text}” is done.` : `“${step.text}” is back on your list.`);
    });
  }

  function remove(step: WeeklyStepItem) {
    setError(undefined);
    startTransition(async () => {
      change({ type: "remove", id: step.id });
      document.getElementById(headingId)?.focus();
      const res = await removeStepAction(step.id);
      if (!res.ok) return setError(res.message);
      setStatus(`Removed “${step.text}” from this week.`);
    });
  }

  function added(text: string, left: number) {
    setError(undefined);
    // The last step of the week replaces the add form with a note, so move focus to the heading
    // instead of letting it drop to the top of the page.
    if (left <= 0) document.getElementById(headingId)?.focus();
    setStatus(
      left > 0
        ? `Added “${text}” to this week. Room for ${left} more.`
        : `Added “${text}” to this week. That fills this week's list.`,
    );
  }

  const allDone = shown.length > 0 && shown.every((s) => s.status === "done");

  return (
    <div>
      {shown.length === 0 ? (
        <div className="mt-3 space-y-3">
          <p>Pick one to three small things to do this week. Little steps add up to big plans.</p>
          {ideas === "roadmap" ? (
            <ButtonLink href="/roadmap" variant="secondary">
              Find ideas on your roadmap
            </ButtonLink>
          ) : (
            <p className="text-sm text-muted">
              {ideas === "below"
                ? "Tap “Add to this week” on anything below, or write your own."
                : "Add your own steps below for whatever comes next for you."}
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {shown.map((step) => (
            <StepRow
              key={step.id}
              step={step}
              maxLength={maxLength}
              onToggle={toggle}
              onRemove={remove}
              onEdited={(text) => {
                setError(undefined);
                setStatus(`Saved your step: “${text}”.`);
              }}
            />
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}

      {shown.length < max ? (
        <AddStepForm maxLength={maxLength} remaining={max - shown.length} onAdded={added} />
      ) : (
        <p className="mt-3 text-sm text-muted">
          {allDone
            ? `You finished all ${max} steps this week. That's a big deal!`
            : "That's a full week! To swap something in, remove a step you haven't finished yet."}
        </p>
      )}

      <p className="mt-4 text-sm">{statsText(stats)}</p>
      {ideas === "roadmap" && shown.length > 0 && (
        <p className="mt-1 text-sm">
          <Link href="/roadmap" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Open your roadmap
          </Link>
        </p>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}

const rowButton =
  "min-h-11 shrink-0 rounded-lg px-3 text-sm text-muted underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent";

/**
 * One step: its checkbox, then Edit and Remove. Edit swaps the row for a small form, like a course
 * on the plan page, and focus goes back to Edit when it closes. An open step is removed right away;
 * a finished one asks first, since it stops counting toward the steps finished so far.
 */
function StepRow({
  step,
  maxLength,
  onToggle,
  onRemove,
  onEdited,
}: {
  step: WeeklyStepItem;
  maxLength: number;
  onToggle: (step: WeeklyStepItem, done: boolean) => void;
  onRemove: (step: WeeklyStepItem) => void;
  onEdited: (text: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-remove">("view");
  const editRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<"edit" | "remove" | null>(null);
  const done = step.status === "done";

  useEffect(() => {
    if (mode !== "view" || !returnFocusTo.current) return;
    (returnFocusTo.current === "edit" ? editRef : removeRef).current?.focus();
    returnFocusTo.current = null;
  }, [mode]);

  function close(focus: "edit" | "remove") {
    returnFocusTo.current = focus;
    setMode("view");
  }

  if (mode === "edit") {
    return (
      <li>
        <EditStepForm
          step={step}
          maxLength={maxLength}
          onSaved={(text) => {
            onEdited(text);
            close("edit");
          }}
          onCancel={() => close("edit")}
        />
      </li>
    );
  }

  return (
    <li>
      <div className="flex items-start gap-2">
        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => onToggle(step, e.target.checked)}
            className="size-5 shrink-0 accent-accent"
          />
          <span className={`min-w-0 break-words ${done ? "text-muted line-through" : ""}`}>{step.text}</span>
        </label>
        {mode === "view" && (
          <div className="flex shrink-0">
            <button ref={editRef} type="button" onClick={() => setMode("edit")} className={rowButton}>
              Edit<span className="sr-only">: {step.text}</span>
            </button>
            <button
              ref={removeRef}
              type="button"
              onClick={() => (done ? setMode("confirm-remove") : onRemove(step))}
              className={rowButton}
            >
              Remove<span className="sr-only">: {step.text}</span>
            </button>
          </div>
        )}
      </div>
      {mode === "confirm-remove" && <ConfirmRemove step={step} onConfirm={() => onRemove(step)} onCancel={() => close("remove")} />}
    </li>
  );
}

/** Escape closes the form or question it's on, like Cancel or Keep it. */
function onEscape(close: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  };
}

function EditStepForm({
  step,
  maxLength,
  onSaved,
  onCancel,
}: {
  step: WeeklyStepItem;
  maxLength: number;
  /** Called after a successful save with the step's new text. */
  onSaved: (text: string) => void;
  onCancel: () => void;
}) {
  const [state, action, pending, values] = useFormAction<EditStepState>(async (prev, formData) => {
    const res = await editStepAction(prev, formData);
    if (res?.ok) onSaved(String(formData.get("stepText") ?? "").trim());
    return res;
  }, undefined);
  const failed = state?.ok === false ? state : undefined;
  const formRef = useFocusFirstInvalid(state);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = `step-${step.id}-text`;
  const errorId = `${inputId}-error`;
  const textErrors = failed?.errors?.text;

  // Start in the text box with the cursor at the end, ready to fix a typo.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  return (
    <form ref={formRef} action={action} onKeyDown={onEscape(() => !pending && onCancel())} className="space-y-2 py-3">
      <input type="hidden" name="stepId" value={step.id} />
      <FormMessage message={failed?.message} />
      <label htmlFor={inputId} className="block text-sm font-medium">
        Edit step
      </label>
      <input
        ref={inputRef}
        id={inputId}
        name="stepText"
        defaultValue={failed ? values.stepText : step.text}
        maxLength={maxLength}
        required
        autoComplete="off"
        aria-invalid={textErrors?.length ? true : undefined}
        aria-describedby={textErrors?.length ? errorId : undefined}
        className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3 focus-visible:outline-2 focus-visible:outline-accent"
      />
      <FieldError id={errorId} errors={textErrors} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Asks before removing a finished step. Focus starts on the safe choice, so an accidental Enter keeps it. */
function ConfirmRemove({ step, onConfirm, onCancel }: { step: WeeklyStepItem; onConfirm: () => void; onCancel: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const questionId = `step-${step.id}-remove-question`;
  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  return (
    <div role="group" aria-labelledby={questionId} onKeyDown={onEscape(onCancel)} className="mb-3 rounded-lg bg-danger-soft p-3 text-sm">
      <p id={questionId}>
        Remove <strong className="break-words">“{step.text}”</strong>? You finished it, so it won&apos;t count toward your
        finished steps anymore.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="danger" onClick={onConfirm}>
          Yes, remove it
        </Button>
        <Button ref={keepRef} type="button" variant="secondary" onClick={onCancel}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function AddStepForm({
  maxLength,
  remaining,
  onAdded,
}: {
  maxLength: number;
  remaining: number;
  /** Called after a successful add with the step's text and how many slots are left. */
  onAdded: (text: string, left: number) => void;
}) {
  const [state, action, pending, values] = useFormAction<AddStepState>(async (prev, formData) => {
    const res = await addStepAction(prev, formData);
    if (res?.ok) onAdded(String(formData.get("stepText") ?? "").trim(), remaining - 1);
    return res;
  }, undefined);
  const failed = state?.ok === false ? state : undefined;

  return (
    <form action={action} className="mt-4 space-y-2">
      <FormMessage message={failed?.message} />
      <Field
        label="Add your own step"
        name="stepText"
        hint={`Something small you can do this week, like “Look up one summer program.” ${
          remaining === 1 ? "Room for 1 more." : `Room for ${remaining} more.`
        }`}
        maxLength={maxLength}
        required
        autoComplete="off"
        defaultValue={failed ? values.stepText : ""}
        errors={failed?.errors?.text}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        Add step
      </Button>
    </form>
  );
}
