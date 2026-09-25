"use client";

import { useId, useState, useTransition } from "react";
import { finishAssessmentAction, saveAnswersAction } from "@/app/actions/discover";
import { Button, FormMessage } from "@/components/ui";
import { type Item, type Option, QuestionList, UnansweredHint, questionRange, showQuestion, usePageTurns } from "./question-list";

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
  const { list, turned, announcement } = usePageTurns(questionRange(page, PAGE_SIZE, items.length));
  const hintId = useId();

  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const unanswered = pageItems.filter((i) => answers[i.id] === undefined).length;
  const answered = items.filter((i) => answers[i.id] !== undefined).length;
  const isLast = page === pages - 1;

  function next() {
    if (pending) return;
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
      turned();
    });
  }

  function back() {
    setPage(page - 1);
    turned();
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
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>

      <QuestionList
        listRef={list}
        items={pageItems}
        options={options}
        answers={answers}
        onAnswer={(itemId, value) => setAnswers((a) => ({ ...a, [itemId]: value }))}
      />

      <div className="mt-6 space-y-3">
        <FormMessage message={error} />
        <PageButtons
          back={page > 0 ? back : undefined}
          next={next}
          nextLabel={isLast ? "See my results" : "Next"}
          unanswered={unanswered}
          hintId={hintId}
          pending={pending}
        />
        <UnansweredHint
          id={hintId}
          count={unanswered}
          onShow={() => showQuestion(list.current, pageItems.findIndex((i) => answers[i.id] === undefined))}
        />
        <p className="text-sm text-muted">Your answers save as you go, so you can stop and come back anytime.</p>
      </div>
    </div>
  );
}

/**
 * Back and Next. While a page saves, Next stays focusable (aria-disabled, and `next` ignores it)
 * rather than disabled: a disabled button drops keyboard focus to the start of the page, and if the
 * save fails focus is still on Next, under the error, to try again. On success the page turn moves
 * focus to the first new question (see usePageTurns).
 */
export function PageButtons({
  back,
  next,
  nextLabel,
  unanswered,
  hintId,
  pending,
}: {
  back?: () => void;
  next: () => void;
  nextLabel: string;
  unanswered: number;
  hintId: string;
  pending: boolean;
}) {
  return (
    <div className="flex gap-2">
      {back && (
        <Button variant="secondary" onClick={back} disabled={pending}>
          Back
        </Button>
      )}
      <Button
        onClick={next}
        disabled={unanswered > 0}
        aria-disabled={pending || undefined}
        aria-describedby={unanswered > 0 ? hintId : undefined}
        className="aria-disabled:cursor-wait aria-disabled:opacity-60"
      >
        {pending ? "Saving…" : nextLabel}
      </Button>
    </div>
  );
}
