"use client";

import { useState, useTransition } from "react";
import { finishAssessmentAction, saveAnswersAction } from "@/app/actions/discover";
import { Button, FormMessage } from "@/components/ui";

type Item = { id: string; text: string };
type Option = { value: number; label: string };

const PAGE_SIZE = 6;

/**
 * Paged questionnaire. Each page is saved before moving on, so students can stop and pick up
 * later; the last page completes and scores the attempt.
 */
export function Questionnaire({
  attemptId,
  items,
  options,
  prompt,
  initial,
}: {
  attemptId: string;
  items: Item[];
  options: Option[];
  prompt: string;
  initial: Record<string, number>;
}) {
  const pages = Math.ceil(items.length / PAGE_SIZE);
  const firstUnanswered = items.findIndex((i) => initial[i.id] === undefined);
  const [page, setPage] = useState(firstUnanswered < 0 ? pages - 1 : Math.floor(firstUnanswered / PAGE_SIZE));
  const [answers, setAnswers] = useState<Record<string, number>>(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageComplete = pageItems.every((i) => answers[i.id] !== undefined);
  const answered = items.filter((i) => answers[i.id] !== undefined).length;
  const isLast = page === pages - 1;

  function next() {
    const pageAnswers = Object.fromEntries(pageItems.map((i) => [i.id, answers[i.id]]));
    setError(undefined);
    startTransition(async () => {
      if (isLast) {
        const res = await finishAssessmentAction(attemptId, pageAnswers);
        if (res && !res.ok) setError(res.message);
        return;
      }
      const res = await saveAnswersAction(attemptId, pageAnswers);
      if (!res.ok) return setError("We couldn't save your answers. Please try again.");
      setPage(page + 1);
      window.scrollTo({ top: 0 });
    });
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex justify-between text-sm text-muted">
          <span>{prompt}</span>
          <span>
            {answered} of {items.length}
          </span>
        </div>
        <div className="mt-2 h-2 rounded-full bg-border" aria-hidden>
          <div className="h-2 rounded-full bg-accent transition-all" style={{ width: `${(answered / items.length) * 100}%` }} />
        </div>
      </div>

      <ol className="space-y-4">
        {pageItems.map((item) => (
          <li key={item.id} className="rounded-xl border border-border bg-surface p-4">
            <fieldset>
              <legend className="font-medium">{item.text}</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {options.map((opt) => {
                  const selected = answers[item.id] === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm focus-within:outline-2 focus-within:outline-accent ${
                        selected ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-background"
                      }`}
                    >
                      <input
                        type="radio"
                        name={item.id}
                        value={opt.value}
                        checked={selected}
                        onChange={() => setAnswers((a) => ({ ...a, [item.id]: opt.value }))}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>

      <div className="mt-6 space-y-3">
        <FormMessage message={error} />
        <div className="flex gap-2">
          {page > 0 && (
            <Button variant="secondary" onClick={() => setPage(page - 1)} disabled={pending}>
              Back
            </Button>
          )}
          <Button onClick={next} disabled={!pageComplete || pending}>
            {pending ? "Saving…" : isLast ? "See my results" : "Next"}
          </Button>
        </div>
        <p className="text-sm text-muted">Your answers save as you go, so you can stop and come back anytime.</p>
      </div>
    </div>
  );
}
