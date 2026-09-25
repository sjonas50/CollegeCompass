"use client";

import { useRouter } from "next/navigation";
import { startTransition, useId, useState } from "react";
import { countFreeFinishAction } from "@/app/actions/try";
import {
  type Item,
  type Option,
  QuestionList,
  UnansweredHint,
  questionRange,
  showQuestion,
  usePageTurns,
} from "@/app/discover/question-list";
import { Button, ButtonLink, Card } from "@/components/ui";
import { type FreeInstrument, answeredCount, isComplete, savedWhen } from "@/lib/assessments/anonymous";
import {
  forgetSavedAssessment,
  forgetSavedStrengths,
  markFinishCounted,
  recordSavedAnswer,
  useSaved,
} from "./saved-store";

/** What differs between the free interest quiz and its strengths add-on. */
const ACTIVITY: Record<
  FreeInstrument,
  {
    pageSize: number;
    prompt: string;
    finish: string;
    results: string;
    startOverConfirm: string;
    finishedBefore: (when: string | null) => string;
  }
> = {
  interests: {
    pageSize: 6,
    prompt: "Would you like to…",
    finish: "See my results",
    results: "/try/results",
    startOverConfirm: "Erase your answers on this device and start over?",
    // Maybe not this visitor's: a shared family or library computer keeps the last person's quiz.
    finishedBefore: (when) =>
      `Someone already finished the quiz on this device${when ? ` ${when}` : ""}. If that was you, your answers are still here. If not, start over to take it yourself.`,
  },
  personality: {
    pageSize: 5,
    prompt: "How well does this describe you?",
    finish: "See my strengths",
    results: "/try/results#strengths",
    startOverConfirm: "Erase your strengths answers on this device and start over?",
    finishedBefore: (when) =>
      `The strengths questions were already answered on this device${when ? ` ${when}` : ""}. If that was you, your answers are still here.`,
  },
};

/**
 * The free interest quiz (`interests`) or its strengths add-on (`personality`), in the same paged
 * style as the signed-in questionnaire. Every answer is saved in this browser the moment it's given;
 * nothing is sent to the server. Finishing is counted once, anonymously (see countFreeFinishAction).
 */
export function FreeQuiz({ instrument = "interests", items, options }: { instrument?: FreeInstrument; items: Item[]; options: Option[] }) {
  const copy = ACTIVITY[instrument];
  const router = useRouter();
  const saved = useSaved(instrument);
  const loaded = saved !== undefined;
  const answers = saved?.answers ?? {};
  const pageSize = copy.pageSize;
  const pages = Math.ceil(items.length / pageSize);
  const hintId = useId();

  const [page, setPage] = useState(0);
  const { list, turned, announcement } = usePageTurns(questionRange(page, pageSize, items.length));
  // Once the browser's copy is read: pick up where the visitor left off, and remember whether
  // they had already finished (then they choose between their results and starting over).
  const [resumed, setResumed] = useState<{ finished: boolean } | null>(null);
  if (loaded && !resumed) {
    const firstUnanswered = items.findIndex((i) => answers[i.id] === undefined);
    setResumed({ finished: isComplete(saved) });
    setPage(firstUnanswered < 0 ? pages - 1 : Math.floor(firstUnanswered / pageSize));
  }

  function startOver() {
    if (!window.confirm(copy.startOverConfirm)) return;
    // Starting the quiz over erases the strengths too: they belong to the same person.
    if (instrument === "interests") forgetSavedAssessment();
    else forgetSavedStrengths();
    setResumed({ finished: false });
    setPage(0);
    turned();
  }

  if (resumed?.finished && isComplete(saved)) {
    return (
      <Card className="space-y-4">
        <p>{copy.finishedBefore(savedWhen(saved.savedAt))}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={copy.results}>{copy.finish}</ButtonLink>
          <Button variant="secondary" onClick={startOver}>
            Start over
          </Button>
        </div>
      </Card>
    );
  }

  const pageItems = items.slice(page * pageSize, (page + 1) * pageSize);
  const unanswered = pageItems.filter((i) => answers[i.id] === undefined).length;
  const answered = answeredCount(saved);
  const isLast = page === pages - 1;

  function next() {
    if (isLast && isComplete(saved)) {
      // Counted once for these answers: the mark stays with them, so a reload or a second press
      // doesn't count again. Only which activity was finished is sent.
      if (markFinishCounted(instrument)) {
        startTransition(async () => {
          await countFreeFinishAction(instrument).catch(() => {});
        });
      }
      router.push(copy.results);
      return;
    }
    // Normally the next page; after starting over in another tab, the first page with gaps.
    const firstUnanswered = items.findIndex((i) => answers[i.id] === undefined);
    setPage(isLast ? Math.floor(Math.max(firstUnanswered, 0) / pageSize) : page + 1);
    turned();
  }

  function back() {
    setPage(page - 1);
    turned();
  }

  return (
    <div>
      <div className="mb-4">
        <div className="flex justify-between text-sm text-muted">
          <span>{copy.prompt}</span>
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
        onAnswer={(itemId, value) => recordSavedAnswer(instrument, itemId, value)}
      />

      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          {page > 0 && (
            <Button variant="secondary" onClick={back}>
              Back
            </Button>
          )}
          <Button onClick={next} disabled={!loaded || unanswered > 0} aria-describedby={loaded && unanswered > 0 ? hintId : undefined}>
            {isLast ? copy.finish : "Next"}
          </Button>
        </div>
        {loaded && (
          <UnansweredHint
            id={hintId}
            count={unanswered}
            onShow={() => showQuestion(list.current, pageItems.findIndex((i) => answers[i.id] === undefined))}
          />
        )}
        <p className="text-sm text-muted">
          Your answers are saved only in this browser as you go, so you can stop and come back.
          {answered > 0 && (
            <>
              {" "}
              <button type="button" onClick={startOver} className="min-h-11 underline underline-offset-2">
                Start over
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
