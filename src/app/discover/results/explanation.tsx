"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { explainMatchesAction } from "@/app/actions/discover";
import type { MatchExplanation } from "@/db/schema";

/** Shows the stored explanation, or asks the server to write one on first view. */
export function useExplanation(initial: MatchExplanation | null) {
  const [explanation, setExplanation] = useState(initial);
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    explainMatchesAction().then((e) => {
      if (!cancelled) setExplanation(e);
    });
    return () => {
      cancelled = true;
    };
  }, [initial]);
  return explanation;
}

export function ExplanationOverview({ initial }: { initial: MatchExplanation | null }) {
  const explanation = useExplanation(initial);
  if (!explanation) {
    return <p className="animate-pulse text-muted">Writing a summary of your results…</p>;
  }
  return <p className="text-lg leading-relaxed">{explanation.overview}</p>;
}

export function CareerReasons({
  initial,
  careers,
}: {
  initial: MatchExplanation | null;
  careers: { code: string; title: string; href: string; label: string }[];
}) {
  const explanation = useExplanation(initial);
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
