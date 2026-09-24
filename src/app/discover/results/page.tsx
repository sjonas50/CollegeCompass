import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnetDataAttribution, OnetToolsAttribution } from "@/components/attribution";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { displayTrait } from "@/lib/assessments/descriptions";
import { BIG_FIVE, RIASEC, RIASEC_INFO, type Riasec, WORK_VALUE_INFO } from "@/lib/assessments/instruments";
import { latestResult } from "@/lib/assessments/service";
import { requireUser } from "@/lib/auth/dal";
import { PATHWAY_INFO, type Pathway, fitLabel, pathwayFor } from "@/lib/matching/match";
import { latestMatchRun } from "@/lib/matching/service";
import { CareerReasons, ExplanationOverview } from "./explanation";

export const metadata: Metadata = { title: "Your results" };

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

  const top = interests.scores.code.split("") as Riasec[];
  const careersFor = (pathway: Pathway) =>
    run.matches
      .filter((m) => pathwayFor(m.jobZone) === pathway)
      .map((m) => ({ code: m.occupationCode, title: m.title, href: `/careers/${m.occupationCode}`, label: fitLabel(m.score) }));

  return (
    <div className="space-y-8">
      <PageHeading title="Your direction, for now" />
      <ExplanationOverview initial={run.explanation} />

      <Card>
        <h2 className="font-medium">Your interest areas</h2>
        <p className="mt-1 text-sm text-muted">
          Your code is <strong className="text-foreground">{interests.scores.code}</strong>:{" "}
          {top.map((l) => RIASEC_INFO[l].name).join(", ")}.
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
                  style={{ width: `${Math.max(4, (interests.scores.areas[area] / 40) * 100)}%` }}
                />
              </div>
              {top.includes(area) && <p className="mt-1 text-sm text-muted">{RIASEC_INFO[area].description}</p>}
            </li>
          ))}
        </ul>
      </Card>

      {(["degree", "training"] as const).map((pathway) => (
        <section key={pathway}>
          <h2 className="text-lg font-medium">{PATHWAY_INFO[pathway].title}</h2>
          <p className="mb-3 text-sm text-muted">{PATHWAY_INFO[pathway].description}</p>
          <CareerReasons initial={run.explanation} careers={careersFor(pathway)} />
        </section>
      ))}

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
