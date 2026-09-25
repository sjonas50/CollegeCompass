"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { freeMatchesAction } from "@/app/actions/try";
import { InterestAreasCard } from "@/app/discover/results/interest-areas";
import { Button, ButtonLink, Card, FormMessage, PageHeading } from "@/components/ui";
import { type SavedAssessment, answeredCount, isComplete, isFinished } from "@/lib/assessments/anonymous";
import type { FreeCareer, FreeMatchesResult } from "@/lib/assessments/import";
import { INTEREST_ITEMS, RIASEC } from "@/lib/assessments/instruments";
import { type Responses, scoreInterests } from "@/lib/assessments/scoring";
import { PATHWAY_INFO, type Pathway } from "@/lib/matching/match";
import { forgetSavedAssessment, useSavedAssessment, useSavedStrengths } from "../saved-store";
import { freeMatchesProblem, keptFreeMatches, loadFreeMatches } from "./free-matches";
import { type ResultsViewer, SaveResultsCard } from "./save-card";
import { StrengthsCard } from "./strengths-card";

const PATHWAYS: Pathway[] = ["degree", "training"];

/**
 * The page heading. Until this browser's copy is read, it expects results, which are what bring most
 * visitors here; without a finished quiz (after "Take it again", say) there's no direction to show.
 */
export function resultsHeading(saved: SavedAssessment | null | undefined): string {
  return saved === undefined || isFinished(saved) ? "Your direction, for now" : "Your quiz results";
}

/** The free quiz's results, scored in the browser from the answers saved there. */
export function FreeResults({ viewer, trialDays }: { viewer: ResultsViewer; trialDays?: number }) {
  const saved = useSavedAssessment();
  const heading = <PageHeading title={resultsHeading(saved)} />;
  if (saved === undefined) {
    return (
      <>
        {heading}
        <p className="animate-pulse text-muted">Loading your results…</p>
      </>
    );
  }
  if (!isFinished(saved)) {
    const answered = answeredCount(saved);
    return (
      <>
        {heading}
        <Card className="space-y-4">
          <p>
            {answered > 0
              ? `You've answered ${answered} of ${INTEREST_ITEMS.length}. Finish the quiz to see your results.`
              : "Take the free quiz to see which careers fit your interests."}
          </p>
          <ButtonLink href="/try">{answered > 0 ? "Keep going" : "Take the free quiz"}</ButtonLink>
        </Card>
      </>
    );
  }
  return (
    <>
      {heading}
      <Results answers={saved.answers} viewer={viewer} trialDays={trialDays} />
    </>
  );
}

export function Results({ answers, viewer, trialDays }: { answers: Responses; viewer: ResultsViewer; trialDays?: number }) {
  const router = useRouter();
  const strengths = useSavedStrengths();
  // The same scoring as signed-in students, run here: the answers never leave the browser.
  const { areas } = scoreInterests(answers);
  const areasKey = RIASEC.map((a) => areas[a]).join(",");
  const { matches, retry } = useFreeMatches(areasKey);

  function takeAgain() {
    if (!window.confirm("Erase your answers from this device and take the quiz again?")) return;
    // The strengths answers go too: they belong to the same person.
    forgetSavedAssessment();
    router.push("/try");
  }

  return (
    <div className="space-y-8">
      {matches?.ok && <p className="text-lg leading-relaxed">{matches.overview}</p>}

      <InterestAreasCard
        areas={areas}
        whenNoLead={
          <>
            <p>Explore careers from different areas to see what clicks, or take the quiz again and go with your gut on each activity.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={takeAgain}>
                Take it again
              </Button>
              <ButtonLink href="/careers" variant="secondary">
                Browse all careers
              </ButtonLink>
            </div>
          </>
        }
      />

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

      <StrengthsCard saved={strengths} />

      <SaveResultsCard viewer={viewer} onTakeAgain={takeAgain} strengths={isComplete(strengths)} trialDays={trialDays} />

      <p className="text-sm text-muted">
        Your answers, including any strengths answers, are saved only in this browser. To find careers, we used just your
        six interest scores, and we didn&apos;t keep them. We count how many people finish the quiz, but not who.
        &ldquo;Take it again&rdquo; erases your answers from this browser.
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

export function CareerList({ pathway, careers }: { pathway: Pathway; careers: FreeCareer[] }) {
  if (careers.length === 0) return null;
  return (
    <section>
      <h2 className="text-lg font-medium">{PATHWAY_INFO[pathway].title}</h2>
      <p className="mb-3 text-sm text-muted">{PATHWAY_INFO[pathway].description}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {careers.map((c) => (
          <li key={c.code}>
            {/* The career page links back here. */}
            <Link
              href={`/careers/${c.code}?from=quiz`}
              className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent"
            >
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
