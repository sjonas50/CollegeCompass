"use client";

import { type Ref, useEffect, useRef, useState } from "react";

/*
 * The parts the paged questionnaires share: the signed-in one (./questionnaire.tsx) and the free
 * quiz (/try).
 */

export type Item = { id: string; text: string };
export type Option = { value: number; label: string };

/** Which questions a page shows: "Questions 7–12 of 60". */
export function questionRange(page: number, pageSize: number, total: number): string {
  const first = page * pageSize + 1;
  return `Questions ${first}–${Math.min(total, first + pageSize - 1)} of ${total}`;
}

/** Why Next can't be pressed yet. */
export function unansweredText(count: number): string {
  return count === 1 ? "1 question on this page still needs an answer." : `${count} questions on this page still need an answer.`;
}

type Question = { focus(options?: FocusOptions): void; scrollIntoView(options?: ScrollIntoViewOptions): void };
type QuestionListElement = { querySelectorAll(selector: "fieldset"): ArrayLike<Question> };

/** After a page turn: back to the top, with keyboard focus on the first new question. */
export function showFirstQuestion(list: QuestionListElement | null, win: Pick<Window, "scrollTo">) {
  win.scrollTo({ top: 0 });
  list?.querySelectorAll("fieldset")[0]?.focus({ preventScroll: true });
}

/** Scrolls to a question on this page (by its place on the page) and moves keyboard focus to it. */
export function showQuestion(list: QuestionListElement | null, index: number) {
  const question = list?.querySelectorAll("fieldset")[index];
  question?.scrollIntoView({ block: "center" });
  question?.focus({ preventScroll: true });
}

/**
 * Page turns. The button that turned the page can end up disabled (Next, on a new page with nothing
 * answered) or gone (Back, on the first page), and then the browser drops keyboard focus to the
 * start of the document. So after each turn this scrolls to the top, focuses the first new question
 * (Tab then moves into its answers) and gives screen readers the questions showing, `range`, in
 * `announcement` for a polite live region. Call `turned()` along with each page change.
 */
export function usePageTurns(range: string) {
  const list = useRef<HTMLOListElement>(null);
  const [turns, setTurns] = useState(0);
  useEffect(() => {
    if (turns > 0) showFirstQuestion(list.current, window);
  }, [turns]);
  return { list, turned: () => setTurns((n) => n + 1), announcement: turns > 0 ? range : "" };
}

export function QuestionList({
  listRef,
  items,
  options,
  answers,
  onAnswer,
}: {
  listRef: Ref<HTMLOListElement>;
  items: Item[];
  options: Option[];
  answers: Record<string, number>;
  onAnswer: (itemId: string, value: number) => void;
}) {
  return (
    <ol ref={listRef} className="space-y-4">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-border bg-surface p-4 has-[>fieldset:focus-visible]:outline-2 has-[>fieldset:focus-visible]:outline-offset-2 has-[>fieldset:focus-visible]:outline-accent"
        >
          {/* Focusable only from code, after a page turn or "Go to it" (see usePageTurns). */}
          <fieldset tabIndex={-1} className="outline-hidden">
            <legend className="font-medium">{item.text}</legend>
            <AnswerScale name={item.id} options={options} value={answers[item.id]} onAnswer={(value) => onAnswer(item.id, value)} />
          </fieldset>
        </li>
      ))}
    </ol>
  );
}

/**
 * One question's answers, as native radio buttons named by the scale's own words (arrow keys move
 * between them). From `sm` up, each answer shows its words. On phones the five answers sit in one
 * row of marks at least 44px wide, with the two ends of the scale written underneath and, once
 * one is chosen, its words; the words stay in each answer for screen readers.
 */
export function AnswerScale({
  name,
  options,
  value,
  onAnswer,
}: {
  name: string;
  options: Option[];
  value: number | undefined;
  onAnswer: (value: number) => void;
}) {
  const chosen = options.findIndex((o) => o.value === value);
  const last = options.length - 1;
  return (
    <>
      <div className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2">
        {options.map((opt) => {
          const selected = value === opt.value;
          // Arrow keys move focus and the answer together, so the focused answer is usually the
          // selected one: the ring sits outside it, apart from its filled background.
          return (
            <label
              key={opt.value}
              className={`flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border px-1 text-center text-sm sm:px-2 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
                selected ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-background"
              }`}
            >
              <input type="radio" name={name} value={opt.value} checked={selected} onChange={() => onAnswer(opt.value)} className="sr-only" />
              <span aria-hidden className={`size-4 rounded-full border-2 border-current sm:hidden ${selected ? "bg-current" : "opacity-60"}`} />
              <span className="max-sm:sr-only">{opt.label}</span>
            </label>
          );
        })}
      </div>
      {/* Hidden from screen readers, which read each answer's own words. */}
      <div aria-hidden className="mt-1.5 flex justify-between gap-4 text-xs text-muted sm:hidden">
        <span>{options[0]?.label}</span>
        <span className="text-right">{options[last]?.label}</span>
      </div>
      {chosen >= 0 && (
        <p aria-hidden className="mt-1 text-xs sm:hidden">
          Your answer: <span className="font-medium">{options[chosen].label}</span>
        </p>
      )}
    </>
  );
}

/** Says why Next is off, with a way to the first question on the page that still needs an answer. */
export function UnansweredHint({ id, count, onShow }: { id: string; count: number; onShow: () => void }) {
  if (count === 0) return null;
  return (
    <p id={id} className="text-sm text-muted">
      {unansweredText(count)}{" "}
      <button type="button" onClick={onShow} className="min-h-11 underline underline-offset-2">
        {count === 1 ? "Go to it" : "Go to the first one"}
      </button>
    </p>
  );
}
