"use client";

import Link from "next/link";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { explainMatchesAction } from "@/app/actions/discover";
import { Button, FormMessage } from "@/components/ui";
import type { MatchExplanation } from "@/db/schema";
import { type ExplanationResult, requestExplanation } from "./load-explanation";

/** The explanation so far (null while it's being written), and a way to ask again after a failure. */
type ExplanationState = { result: ExplanationResult | null; retry: () => void };

export const ExplanationContext = createContext<ExplanationState>({ result: null, retry: () => {} });

/**
 * Shows the stored explanation, or asks the server to write one on first view. The whole page shares
 * one request: the overview and each career list read the explanation from here. If the request
 * fails, the overview says so and offers to try again, instead of waiting forever.
 */
export function ExplanationProvider({
  runId,
  initial,
  children,
}: {
  runId: string;
  initial: MatchExplanation | null;
  children: ReactNode;
}) {
  const [tries, setTries] = useState(0);
  const [loaded, setLoaded] = useState<{ tries: number; result: ExplanationResult } | null>(null);
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    requestExplanation(runId, explainMatchesAction).then((result) => {
      if (!cancelled) setLoaded({ tries, result });
    });
    return () => {
      cancelled = true;
    };
  }, [runId, initial, tries]);
  const result: ExplanationResult | null = initial ? { ok: true, explanation: initial } : loaded?.tries === tries ? loaded.result : null;
  return <ExplanationContext value={{ result, retry: () => setTries((n) => n + 1) }}>{children}</ExplanationContext>;
}

export function ExplanationOverview() {
  const { result, retry } = useContext(ExplanationContext);
  if (!result) {
    return <p className="animate-pulse text-muted">Writing a summary of your results…</p>;
  }
  if (!result.ok) {
    return (
      <div className="space-y-3">
        <FormMessage message="We couldn't write a summary of your results just now. Your matches are below, and you can try again." />
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }
  return <p className="text-lg leading-relaxed">{result.explanation.overview}</p>;
}

export function CareerReasons({ careers }: { careers: { code: string; title: string; href: string; label: string }[] }) {
  const { result } = useContext(ExplanationContext);
  const why = new Map(result?.ok ? result.explanation.careers.map((c) => [c.code, c.why]) : []);
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {careers.map((c) => (
        <li key={c.code}>
          <Link href={c.href} className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent">
            <span className="flex items-start justify-between gap-2">
              <span className="font-medium">{c.title}</span>
              <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs">{c.label}</span>
            </span>
            {why.get(c.code) && <span className="mt-2 block text-sm text-muted">{why.get(c.code)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
