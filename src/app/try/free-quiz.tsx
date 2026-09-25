"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
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
import { answeredCount, isFinished, savedWhen } from "@/lib/assessments/anonymous";
import { forgetSavedAssessment, recordAnswer, useSavedAssessment } from "./saved-store";

const PAGE_SIZE = 6;

/**
 * The free interest quiz, in the same paged style as the signed-in questionnaire. Every answer is
 * saved in this browser the moment it's given; nothing is sent to the server.
 */
export function FreeQuiz({ items, options }: { items: Item[]; options: Option[] }) {
  const router = useRouter();
  const saved = useSavedAssessment();
  const loaded = saved !== undefined;
  const answers = saved?.answers ?? {};
  const pages = Math.ceil(items.length / PAGE_SIZE);
  const hintId = useId();

  const [page, setPage] = useState(0);
  const { list, turned, announcement } = usePageTurns(questionRange(page, PAGE_SIZE, items.length));
  // Once the browser's copy is read: pick up where the visitor left off, and remember whether
  // they had already finished (then they choose between their results and starting over).
  const [resumed, setResumed] = useState<{ finished: boolean } | null>(null);
  if (loaded && !resumed) {
    const firstUnanswered = items.findIndex((i) => answers[i.id] === undefined);
    setResumed({ finished: isFinished(saved) });
    setPage(firstUnanswered < 0 ? pages - 1 : Math.floor(firstUnanswered / PAGE_SIZE));
  }

  function startOver() {
    if (!window.confirm("Erase your answers on this device and start over?")) return;
    forgetSavedAssessment();
    setResumed({ finished: false });
    setPage(0);
    turned();
  }

  if (resumed?.finished && isFinished(saved)) {
    // Maybe not this visitor's: a shared family or library computer keeps the last person's quiz.
    const when = savedWhen(saved.savedAt);
    return (
      <Card className="space-y-4">
        <p>
          Someone already finished the quiz on this device{when ? ` ${when}` : ""}. If that was you, your answers are
          still here. If not, start over to take it yourself.
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/try/results">See my results</ButtonLink>
          <Button variant="secondary" onClick={startOver}>
            Start over
          </Button>
        </div>
      </Card>
    );
  }

  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const unanswered = pageItems.filter((i) => answers[i.id] === undefined).length;
  const answered = answeredCount(saved);
  const isLast = page === pages - 1;

  function next() {
    if (isLast && isFinished(saved)) {
      router.push("/try/results");
      return;
    }
    // Normally the next page; after starting over in another tab, the first page with gaps.
    const firstUnanswered = items.findIndex((i) => answers[i.id] === undefined);
    setPage(isLast ? Math.floor(Math.max(firstUnanswered, 0) / PAGE_SIZE) : page + 1);
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
          <span>Would you like to…</span>
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

      <QuestionList listRef={list} items={pageItems} options={options} answers={answers} onAnswer={recordAnswer} />

      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          {page > 0 && (
            <Button variant="secondary" onClick={back}>
              Back
            </Button>
          )}
          <Button onClick={next} disabled={!loaded || unanswered > 0} aria-describedby={loaded && unanswered > 0 ? hintId : undefined}>
            {isLast ? "See my results" : "Next"}
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
