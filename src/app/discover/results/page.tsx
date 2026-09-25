import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { OnetDataAttribution, OnetToolsAttribution } from "@/components/attribution";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { displayTrait } from "@/lib/assessments/descriptions";
import { BIG_FIVE, WORK_VALUE_INFO } from "@/lib/assessments/instruments";
import { interestPattern, noAreaStandsOut } from "@/lib/assessments/interest-pattern";
import { latestResult, nextRetakeDate } from "@/lib/assessments/service";
import { requireUser } from "@/lib/auth/dal";
import { explainLatestMatches, storedExplanation } from "@/lib/matching/explain";
import { PATHWAY_INFO, type Pathway, fitLabel, pathwayFor } from "@/lib/matching/match";
import { latestMatchRun } from "@/lib/matching/service";
import { CareerReasons, ExplanationOverview, ExplanationProvider } from "./explanation";
import { InterestAreasCard } from "./interest-areas";

export const metadata: Metadata = { title: "Your results" };

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function ResultsPage() {
  const student = await requireUser(["student"]);
  const db = await getDb();
  const [interests, personality, values, run] = await Promise.all([
    latestResult(db, student.id, "interests"),
    latestResult(db, student.id, "personality"),
    latestResult(db, student.id, "values"),
    latestMatchRun(db, student.id),
  ]);
  if (!interests || !run) redirect("/discover/interests");

  const pattern = interestPattern(interests.scores.areas);
  const noLead = noAreaStandsOut(pattern);
  // With no area ahead it's always the template (written here, no AI), even over an explanation
  // stored before that rule. Otherwise the stored one, unless it was written from interest facts
  // that have changed since (see storedExplanation); without one, the client asks for one.
  const explanation = noLead ? await explainLatestMatches(db, student.id) : storedExplanation(run.explanation, pattern);
  const retakeAfter = nextRetakeDate(interests.completedAt);
  const careersFor = (pathway: Pathway) =>
    run.matches
      .filter((m) => pathwayFor(m.jobZone) === pathway)
      .map((m) => ({ code: m.occupationCode, title: m.title, href: `/careers/${m.occupationCode}`, label: fitLabel(m.score, { noLead }) }));

  return (
    <div className="space-y-8">
      <PageHeading title="Your direction, for now" />
      {/* Keyed by run, so new matches start from their own stored explanation. */}
      <ExplanationProvider key={run.id} runId={run.id} initial={explanation}>
        <ExplanationOverview />

        <InterestAreasCard
          areas={interests.scores.areas}
          whenNoLead={
            <>
              <p>
                Explore careers from different areas to see what clicks.{" "}
                {retakeAfter <= new Date() ? (
                  <>
                    You can also{" "}
                    <Link href="/discover/interests" className="underline underline-offset-2">
                      take the interests activity again
                    </Link>{" "}
                    and go with your gut on each one.
                  </>
                ) : (
                  <>You can take the interests activity again after {formatDate(retakeAfter)}.</>
                )}
              </p>
              <ButtonLink href="/careers" variant="secondary">
                Browse all careers
              </ButtonLink>
            </>
          }
        />

        {(["degree", "training"] as const).map((pathway) => (
          <section key={pathway}>
            <h2 className="text-lg font-medium">{PATHWAY_INFO[pathway].title}</h2>
            <p className="mb-3 text-sm text-muted">{PATHWAY_INFO[pathway].description}</p>
            <CareerReasons careers={careersFor(pathway)} />
          </section>
        ))}
      </ExplanationProvider>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-medium">Your strengths</h2>
          {personality ? (
            <ul className="mt-3 space-y-3 text-sm">
              {BIG_FIVE.map((t) => {
                const d = displayTrait(t, personality.scores.traits[t]);
                return (
                  <li key={t}>
                    <span className="font-medium">{d.name}.</span> <span className="text-muted">{d.text}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-2 space-y-3 text-sm text-muted">
              <p>Take the personality assessment to see your strengths and how you like to work.</p>
              <ButtonLink href="/discover/personality" variant="secondary">Take it (5 min)</ButtonLink>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="font-medium">What matters to you</h2>
          {values ? (
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              {values.scores.ranking.slice(0, 3).map((v) => (
                <li key={v}>
                  <span className="font-medium">{WORK_VALUE_INFO[v].name}</span>{" "}
                  <span className="text-muted">— {WORK_VALUE_INFO[v].description}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-2 space-y-3 text-sm text-muted">
              <p>Rank what matters most to you in a job to fine-tune your matches.</p>
              <ButtonLink href="/discover/values" variant="secondary">Rank them (2 min)</ButtonLink>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-1 border-t border-border pt-4">
        <OnetToolsAttribution />
        <OnetDataAttribution />
      </div>
    </div>
  );
}
