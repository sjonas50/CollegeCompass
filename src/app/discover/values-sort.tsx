"use client";

import { useState, useTransition } from "react";
import { finishAssessmentAction } from "@/app/actions/discover";
import { Button, FormMessage } from "@/components/ui";

type Value = { id: string; name: string; description: string };

/** Tap values in order of importance. Tapping a ranked value removes it (and everything after it). */
export function ValuesSort({ attemptId, values }: { attemptId: string; values: Value[] }) {
  const [order, setOrder] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    const i = order.indexOf(id);
    setOrder(i >= 0 ? order.slice(0, i) : [...order, id]);
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
        Tap these in order, starting with what matters <strong>most</strong> to you in a future job. Tap again to undo.
      </p>
      <ul className="space-y-3">
        {values.map((v) => {
          const rank = order.indexOf(v.id) + 1;
          return (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => toggle(v.id)}
                aria-pressed={rank > 0}
                className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left focus-visible:outline-2 focus-visible:outline-accent ${
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
                  <span className="block text-sm text-muted">{v.description}</span>
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
            <Button variant="secondary" onClick={() => setOrder([])} disabled={pending}>
              Start over
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
