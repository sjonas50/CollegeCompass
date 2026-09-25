"use client";

import { useState, useTransition } from "react";
import { type PathActionResult, acceptSuggestionAction, dismissSuggestionAction, restoreSuggestionsAction } from "@/app/actions/path";
import { Button } from "@/components/ui";
import { announcePath, focusPath } from "./announcer";

export type AlternativeChoice = { key: string; label: string };

function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  function run(action: () => Promise<PathActionResult>, focusAfter: string) {
    setError(undefined);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.message);
        announcePath(res.message);
        return;
      }
      if (res.message) announcePath(res.message);
      focusPath(focusAfter);
    });
  }
  return { pending, error, run };
}

function ErrorLine({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 basis-full text-sm text-danger">
      {error}
    </p>
  );
}

/**
 * Add / Not for me on one suggestion, each one tap. The student owns their plan: adding makes it
 * their class, and nothing is added without a tap. `focusAfter` is the year heading, since the
 * suggestion leaves the list.
 */
export function SuggestionActions({ suggestionKey, title, focusAfter }: { suggestionKey: string; title: string; focusAfter: string }) {
  const { pending, error, run } = useAction();
  const forTitle = <span className="sr-only">: {title}</span>;
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button type="button" disabled={pending} onClick={() => run(() => acceptSuggestionAction(suggestionKey), focusAfter)}>
        Add{forTitle}
      </Button>
      <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => dismissSuggestionAction(suggestionKey), focusAfter)}>
        Not for me{forTitle}
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}

/** "Other choices": other classes that meet the same need, each one tap to add instead. */
export function OtherChoices({ title, alternatives, focusAfter }: { title: string; alternatives: AlternativeChoice[]; focusAfter: string }) {
  const { pending, error, run } = useAction();
  return (
    <details className="text-sm open:basis-full print:hidden">
      <summary className="min-h-11 cursor-pointer content-center font-medium underline-offset-2 hover:underline">
        Other choices ({alternatives.length})<span className="sr-only"> for {title}</span>
      </summary>
      <ul className="mt-1 space-y-2">
        {alternatives.map((alt) => (
          <li key={alt.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-1">
            <span>{alt.label}</span>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => acceptSuggestionAction(alt.key), focusAfter)}>
              Add<span className="sr-only">: {alt.label}</span> instead
            </Button>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
    </details>
  );
}

/** Brings back suggestions the student said "Not for me" to. */
export function RestoreSuggestions({ count }: { count: number }) {
  const { pending, error, run } = useAction();
  return (
    <div className="print:hidden">
      <Button type="button" variant="secondary" disabled={pending} onClick={() => run(() => restoreSuggestionsAction(), "path-heading")}>
        Bring back {count} {count === 1 ? "suggestion" : "suggestions"} you set aside
      </Button>
      <ErrorLine error={error} />
    </div>
  );
}
