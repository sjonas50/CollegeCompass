"use client";

import { useId, useRef, useState, useTransition } from "react";
import { finishAssessmentAction } from "@/app/actions/discover";
import { Button, FormMessage } from "@/components/ui";

type Value = { id: string; name: string; description: string };

/** A value's name for screen readers, with its place once it's ranked: "Support, ranked 1 of 6". */
export function rankedName(name: string, rank: number, total: number): string {
  return rank ? `${name}, ranked ${rank} of ${total}` : name;
}

/** What a tap changed, for screen readers: the new rank, or what was taken back. */
export function rankChange(before: string[], after: string[], names: Record<string, string>, total: number): string {
  const left = total - after.length;
  const toGo = left === 0 ? `All ${total} are ranked.` : `${left} more to rank.`;
  if (after.length > before.length) return `${names[after.at(-1)!]} is number ${after.length}. ${toGo}`;
  const removed = before.slice(after.length);
  if (removed.length === 0) return "";
  const others = removed.length - 1;
  return `Removed ${names[removed[0]]}${others ? ` and the ${others === 1 ? "one" : others} after it` : ""}. ${toGo}`;
}

/** Tap values in order of importance. Tapping a ranked value removes it (and everything after it). */
export function ValuesSort({ attemptId, values }: { attemptId: string; values: Value[] }) {
  const [order, setOrder] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const baseId = useId();
  const list = useRef<HTMLUListElement>(null);
  const names = Object.fromEntries(values.map((v) => [v.id, v.name]));

  function toggle(id: string) {
    const i = order.indexOf(id);
    const next = i >= 0 ? order.slice(0, i) : [...order, id];
    setOrder(next);
    setAnnouncement(rankChange(order, next, names, values.length));
  }

  function startOver() {
    setOrder([]);
    setAnnouncement("Your ranking is cleared. Start with what matters most.");
    // The Start over button goes away with the ranking, so focus goes back to the first value.
    list.current?.querySelector("button")?.focus();
  }

  function submit() {
    const ranks = Object.fromEntries(order.map((id, i) => [id, i + 1]));
    startTransition(async () => {
      const res = await finishAssessmentAction(attemptId, ranks);
      if (res && !res.ok) setError(res.message);
    });
  }

  return (
    <div>
      <p className="mb-4 text-muted">
        Tap these in order, starting with what matters <strong>most</strong> to you in a future job. Tap one again to
        remove it, along with any you picked after it.
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <ul ref={list} className="space-y-3">
        {values.map((v) => {
          const rank = order.indexOf(v.id) + 1;
          const descriptionId = `${baseId}-${v.id}`;
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => toggle(v.id)}
                aria-pressed={rank > 0}
                aria-label={rankedName(v.name, rank, values.length)}
                aria-describedby={descriptionId}
                className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  rank ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-background"
                }`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                    rank ? "border-accent bg-accent text-accent-foreground" : "border-border text-muted"
                  }`}
                  aria-hidden
                >
                  {rank || ""}
                </span>
                <span>
                  <span className="block font-medium">{v.name}</span>
                  <span id={descriptionId} className="block text-sm text-muted">
                    {v.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 space-y-3">
        <FormMessage message={error} />
        <div className="flex gap-2">
          <Button onClick={submit} disabled={order.length !== values.length || pending}>
            {pending ? "Saving…" : "See my results"}
          </Button>
          {order.length > 0 && (
            <Button variant="secondary" onClick={startOver} disabled={pending}>
              Start over
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
