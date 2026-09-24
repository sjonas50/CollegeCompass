"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink, Card } from "@/components/ui";
import { answeredCount, isFinished, savedWhen } from "@/lib/assessments/anonymous";
import { forgetSavedAssessment, recordAnswer, useSavedAssessment } from "./saved-store";

type Item = { id: string; text: string };
type Option = { value: number; label: string };

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

  const [page, setPage] = useState(0);
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
    window.scrollTo({ top: 0 });
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
  const pageComplete = pageItems.every((i) => answers[i.id] !== undefined);
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
    window.scrollTo({ top: 0 });
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
                        onChange={() => recordAnswer(item.id, opt.value)}
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
        <div className="flex flex-wrap gap-2">
          {page > 0 && (
            <Button variant="secondary" onClick={() => setPage(page - 1)}>
              Back
            </Button>
          )}
          <Button onClick={next} disabled={!loaded || !pageComplete}>
            {isLast ? "See my results" : "Next"}
          </Button>
        </div>
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
