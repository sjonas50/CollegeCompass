"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { freeMatchesAction } from "@/app/actions/try";
import { Button, ButtonLink, Card, FormMessage } from "@/components/ui";
import { answeredCount, isFinished } from "@/lib/assessments/anonymous";
import type { FreeCareer, FreeMatchesResult } from "@/lib/assessments/import";
import { INTEREST_ITEMS, RIASEC, RIASEC_INFO, type Riasec } from "@/lib/assessments/instruments";
import { type Responses, scoreInterests } from "@/lib/assessments/scoring";
import { PATHWAY_INFO, type Pathway } from "@/lib/matching/match";
import { forgetSavedAssessment, useSavedAssessment } from "../saved-store";
import { freeMatchesProblem, keptFreeMatches, loadFreeMatches } from "./free-matches";
import { type ResultsViewer, SaveResultsCard } from "./save-card";

const PATHWAYS: Pathway[] = ["degree", "training"];

/** The free quiz's results, scored in the browser from the answers saved there. */
export function FreeResults({ viewer }: { viewer: ResultsViewer }) {
  const saved = useSavedAssessment();
  if (saved === undefined) return <p className="animate-pulse text-muted">Loading your results…</p>;
  if (!isFinished(saved)) {
    const answered = answeredCount(saved);
    return (
      <Card className="space-y-4">
        <p>
          {answered > 0
            ? `You've answered ${answered} of ${INTEREST_ITEMS.length}. Finish the quiz to see your results.`
            : "Take the free quiz to see which careers fit your interests."}
        </p>
        <ButtonLink href="/try">{answered > 0 ? "Keep going" : "Take the free quiz"}</ButtonLink>
      </Card>
    );
  }
  return <Results answers={saved.answers} viewer={viewer} />;
}

function Results({ answers, viewer }: { answers: Responses; viewer: ResultsViewer }) {
  const router = useRouter();
  // The same scoring as signed-in students, run here: the answers never leave the browser.
  const { areas, code } = scoreInterests(answers);
  const top = code.split("") as Riasec[];
  const areasKey = RIASEC.map((a) => areas[a]).join(",");
  const { matches, retry } = useFreeMatches(areasKey);

  function takeAgain() {
    if (!window.confirm("Erase these answers from this device and take the quiz again?")) return;
    forgetSavedAssessment();
    router.push("/try");
  }

  return (
    <div className="space-y-8">
      {matches?.ok && <p className="text-lg leading-relaxed">{matches.overview}</p>}

      <Card>
        <h2 className="font-medium">Your interest areas</h2>
        <p className="mt-1 text-sm text-muted">
          Your code is <strong className="text-foreground">{code}</strong>: {top.map((l) => RIASEC_INFO[l].name).join(", ")}.
        </p>
        <ul className="mt-4 space-y-3">
          {RIASEC.map((area) => (
            <li key={area}>
              <div className="flex justify-between text-sm">
                <span className={top.includes(area) ? "font-medium" : ""}>
                  {RIASEC_INFO[area].name} <span className="text-muted">· {RIASEC_INFO[area].short}</span>
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-border" aria-hidden>
                <div
                  className={`h-2 rounded-full ${top.includes(area) ? "bg-accent" : "bg-muted"}`}
                  style={{ width: `${Math.max(4, (areas[area] / 40) * 100)}%` }}
                />
              </div>
              {top.includes(area) && <p className="mt-1 text-sm text-muted">{RIASEC_INFO[area].description}</p>}
            </li>
          ))}
        </ul>
      </Card>

      <div aria-live="polite" className="space-y-8">
        {matches === null && <p className="animate-pulse text-muted">Finding careers that fit you…</p>}
        {matches && !matches.ok && (
          <div className="space-y-3">
            <FormMessage message={freeMatchesProblem(matches.error)} />
            <Button variant="secondary" onClick={retry}>
              Try again
            </Button>
          </div>
        )}
        {matches?.ok &&
          PATHWAYS.map((pathway) => (
            <CareerList key={pathway} pathway={pathway} careers={matches.careers.filter((c) => c.pathway === pathway)} />
          ))}
      </div>

      <SaveResultsCard viewer={viewer} onTakeAgain={takeAgain} />

      <p className="text-sm text-muted">
        Your answers are saved only in this browser. To find careers, we used just your six interest scores, and we
        didn&apos;t keep them. &ldquo;Take it again&rdquo; erases your answers from this browser.
      </p>
    </div>
  );
}

/**
 * Matches from the six area scores (given as "R,I,A,S,E,C"); null while loading. Matches already
 * found in this tab are shown without asking the server again (see ./free-matches).
 */
function useFreeMatches(areasKey: string): { matches: FreeMatchesResult | null; retry: () => void } {
  const [tries, setTries] = useState(0);
  const requestKey = `${areasKey}#${tries}`;
  const [state, setState] = useState<{ key: string; result: FreeMatchesResult } | null>(null);
  const kept = keptFreeMatches(areasKey);
  useEffect(() => {
    if (keptFreeMatches(areasKey)) return;
    let cancelled = false;
    const values = areasKey.split(",").map(Number);
    const scores = Object.fromEntries(RIASEC.map((area, i) => [area, values[i]]));
    startTransition(async () => {
      const result = await loadFreeMatches(areasKey, () => freeMatchesAction(scores));
      if (!cancelled) setState({ key: requestKey, result });
    });
    return () => {
      cancelled = true;
    };
  }, [areasKey, requestKey]);
  return {
    matches: kept ?? (state?.key === requestKey ? state.result : null),
    retry: () => setTries((n) => n + 1),
  };
}

function CareerList({ pathway, careers }: { pathway: Pathway; careers: FreeCareer[] }) {
  if (careers.length === 0) return null;
  return (
    <section>
      <h2 className="text-lg font-medium">{PATHWAY_INFO[pathway].title}</h2>
      <p className="mb-3 text-sm text-muted">{PATHWAY_INFO[pathway].description}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {careers.map((c) => (
          <li key={c.code}>
            <Link href={`/careers/${c.code}`} className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent">
              <span className="flex items-start justify-between gap-2">
                <span className="font-medium">{c.title}</span>
                <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs">{c.fit}</span>
              </span>
              {c.why && <span className="mt-2 block text-sm text-muted">{c.why}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
