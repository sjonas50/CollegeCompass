import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { startAssessmentAction } from "@/app/actions/discover";
import { OnetToolsAttribution } from "@/components/attribution";
import { Button, ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import {
  ACCURACY_SCALE,
  INSTRUMENTS,
  INTEREST_ITEMS,
  LIKE_SCALE,
  PERSONALITY_ITEMS,
  WORK_VALUES,
  WORK_VALUE_INFO,
  isInstrumentId,
} from "@/lib/assessments/instruments";
import { instrumentStatuses, startOrResumeAttempt } from "@/lib/assessments/service";
import { requireUser } from "@/lib/auth/dal";
import { Questionnaire } from "../questionnaire";
import { ValuesSort } from "../values-sort";

export const metadata: Metadata = { title: "Discover" };

const INTRO = {
  interests: {
    lead: "Would you like doing each of these activities? Don't worry about how much school or training it would take, or how much money you'd make. Just go with your gut.",
    why: "Your answers show which of six interest areas fit you best, and we match those to real careers.",
  },
  personality: {
    lead: "How well does each statement describe you right now? There are no right or wrong answers.",
    why: "This shows your strengths and how you like to work. It helps explain why certain careers might fit.",
  },
  values: {
    lead: "What matters most to you in a future job?",
    why: "Your top values fine-tune your career matches.",
  },
} as const;

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function InstrumentPage({ params }: PageProps<"/discover/[instrument]">) {
  const student = await requireUser(["student"]);
  const { instrument } = await params;
  if (!isInstrumentId(instrument)) notFound();

  const db = await getDb();
  const info = INSTRUMENTS[instrument];
  const status = (await instrumentStatuses(db, student.id))[instrument];

  if (status.state === "in_progress") {
    const res = await startOrResumeAttempt(db, student.id, instrument);
    if (!res.ok) notFound();
    const { attempt } = res;
    return (
      <>
        <PageHeading title={info.title} lead={INTRO[instrument].lead} />
        {instrument === "values" ? (
          <ValuesSort attemptId={attempt.id} values={WORK_VALUES.map((v) => ({ id: v, ...WORK_VALUE_INFO[v] }))} />
        ) : (
          <Questionnaire
            attemptId={attempt.id}
            items={instrument === "interests" ? INTEREST_ITEMS : PERSONALITY_ITEMS}
            options={instrument === "interests" ? LIKE_SCALE : ACCURACY_SCALE}
            prompt={instrument === "interests" ? "Would you like to…" : "How well does this describe you?"}
            initial={attempt.responses}
          />
        )}
        {instrument === "interests" && (
          <div className="mt-8">
            <OnetToolsAttribution />
          </div>
        )}
      </>
    );
  }

  const canStart = status.state === "not_started" || status.retakeAfter <= new Date();
  return (
    <>
      <PageHeading title={info.title} lead={info.tagline} />
      <Card className="space-y-4">
        <p>{INTRO[instrument].why}</p>
        {status.state === "done" && (
          <p className="text-sm text-muted">
            You finished this on {formatDate(status.completedAt)}.
            {!canStart && <> Interests and personality change as you grow — you can retake it after {formatDate(status.retakeAfter)}.</>}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {canStart && (
            <form action={startAssessmentAction}>
              <input type="hidden" name="instrument" value={instrument} />
              <Button type="submit">{status.state === "done" ? "Retake" : "Start"}</Button>
            </form>
          )}
          {status.state === "done" && (
            <ButtonLink href="/discover/results" variant="secondary">
              See my results
            </ButtonLink>
          )}
        </div>
      </Card>
      <p className="mt-4 text-sm">
        <Link href="/dashboard" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to dashboard
        </Link>
      </p>
    </>
  );
}
