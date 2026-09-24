"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { type AddStepState, addStepAction, removeStepAction, setStepDoneAction } from "@/app/actions/roadmap";
import { Button, ButtonLink, Field, FormMessage } from "@/components/ui";
import { useFormAction } from "@/components/use-form-action";

export type WeeklyStepItem = { id: string; text: string; status: "open" | "done"; milestoneId: string | null };
export type WeeklyStepStats = { stepsCompleted: number; weeksWithProgress: number };

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
 * This week's steps with checkboxes, remove buttons and an "add your own" field. Rendered by
 * `WeeklyStepsCard` (src/components/weekly-steps.tsx), which loads the data.
 */
export function WeeklyStepsList({
  steps,
  stats,
  max,
  maxLength,
  linkToRoadmap,
  headingId,
}: {
  steps: WeeklyStepItem[];
  stats: WeeklyStepStats;
  max: number;
  maxLength: number;
  linkToRoadmap: boolean;
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
          {linkToRoadmap ? (
            <ButtonLink href="/roadmap" variant="secondary">
              Find ideas on your roadmap
            </ButtonLink>
          ) : (
            <p className="text-sm text-muted">Tap “Add to this week” on anything below, or write your own.</p>
          )}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {shown.map((step) => {
            const done = step.status === "done";
            return (
              <li key={step.id} className="flex items-start gap-2">
                <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={done}
                    onChange={(e) => toggle(step, e.target.checked)}
                    className="size-5 shrink-0 accent-accent"
                  />
                  <span className={`min-w-0 break-words ${done ? "text-muted line-through" : ""}`}>{step.text}</span>
                </label>
                {/* Finished steps stay: they count toward lifetime progress. Un-check one to remove it. */}
                {!done && (
                  <button
                    type="button"
                    onClick={() => remove(step)}
                    className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-muted underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Remove<span className="sr-only">: {step.text}</span>
                  </button>
                )}
              </li>
            );
          })}
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
      {linkToRoadmap && shown.length > 0 && (
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
