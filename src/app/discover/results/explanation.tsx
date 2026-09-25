"use client";

import Link from "next/link";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { explainMatchesAction } from "@/app/actions/discover";
import type { MatchExplanation } from "@/db/schema";
import { loadExplanation } from "./load-explanation";

const Explanation = createContext<MatchExplanation | null>(null);

/**
 * Shows the stored explanation, or asks the server to write one on first view. The whole page shares
 * one request: the overview and each career list read the explanation from here.
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
  const [explanation, setExplanation] = useState(initial);
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    loadExplanation(runId, explainMatchesAction).then((e) => {
      if (!cancelled) setExplanation(e);
    });
    return () => {
      cancelled = true;
    };
  }, [runId, initial]);
  return <Explanation value={explanation}>{children}</Explanation>;
}

export function ExplanationOverview() {
  const explanation = useContext(Explanation);
  if (!explanation) {
    return <p className="animate-pulse text-muted">Writing a summary of your results…</p>;
  }
  return <p className="text-lg leading-relaxed">{explanation.overview}</p>;
}

export function CareerReasons({ careers }: { careers: { code: string; title: string; href: string; label: string }[] }) {
  const explanation = useContext(Explanation);
  const why = new Map(explanation?.careers.map((c) => [c.code, c.why]));
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
