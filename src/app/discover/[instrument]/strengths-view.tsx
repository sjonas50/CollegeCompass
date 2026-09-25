import Link from "next/link";
import { startAssessmentAction } from "@/app/actions/discover";
import { Button, ButtonLink, Card, PageHeading } from "@/components/ui";
import { strengthsFor, traitNames } from "@/lib/assessments/descriptions";
import type { BigFive } from "@/lib/assessments/instruments";
import type { StrengthsInMatches } from "@/lib/matching/service";
import { UpdateMatchesButton } from "../update-matches";

/**
 * What the student's strengths do to their matches, naming only the strengths that count (see
 * strengthsInMatches). Never promises a boost the code won't give.
 */
function matchesText({ state, counted }: StrengthsInMatches): string {
  const boost = `careers that call for your ${traitNames(counted)}`;
  switch (state) {
    case "boosted":
      return `Your matches now give a small boost to ${boost}. Your interests still count the most, and a lower score never pushes a career down.`;
    case "stale":
      return `Your matches were made before your strengths counted. Update them to give a small boost to ${boost}. Your interests still count the most, and a lower score never pushes a career down.`;
    case "unchanged":
      return "Your answers didn't change your matches. Your interests decide them.";
    case "none":
      return counted.length
        ? `Finish the interests activity to get career matches. They'll give a small boost to ${boost}, but your interests count the most.`
        : "Finish the interests activity to get career matches. Your interests will decide them.";
  }
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * The personality results: five strengths, each framed as a strength at every level, what they can
 * mean at school and at work, and how they're used for career matches. "Staying calm" comes last,
 * worded gently, and never changes which careers are suggested.
 */
export function StrengthsView({
  traits,
  completedAt,
  retakeAfter,
  matches,
}: {
  traits: Record<BigFive, number>;
  completedAt: Date;
  retakeAfter: Date;
  matches: StrengthsInMatches;
}) {
  const strengths = strengthsFor(traits);
  const canRetake = retakeAfter <= new Date();
  return (
    <>
      <PageHeading
        title="Your strengths"
        lead="Every trait comes with its own strengths. These describe how you see yourself right now. They don't limit what you can do or become."
      />
      <ol className="space-y-4">
        {strengths.map((s) => (
          <li key={s.trait}>
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-lg font-medium">{s.name}</h2>
                <span className="rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-foreground">{s.label}</span>
              </div>
              <p className="mt-2">{s.text}</p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium">At school</dt>
                  <dd className="text-muted">{s.school}</dd>
                </div>
                <div>
                  <dt className="font-medium">At work</dt>
                  <dd className="text-muted">{s.work}</dd>
                </div>
              </dl>
            </Card>
          </li>
        ))}
      </ol>

      <Card className="mt-6 space-y-3">
        <h2 className="font-medium">Your strengths and your career matches</h2>
        <p className="text-sm">{matchesText(matches)}</p>
        <p className="text-sm text-muted">Staying calm never changes which careers we suggest to you.</p>
        <div className="flex flex-wrap gap-2">
          {matches.state === "none" ? (
            <ButtonLink href="/discover/interests">Go to interests</ButtonLink>
          ) : matches.state === "stale" ? (
            <>
              <UpdateMatchesButton />
              <ButtonLink href="/discover/results" variant="secondary">
                See my career matches
              </ButtonLink>
            </>
          ) : (
            <ButtonLink href="/discover/results">{matches.state === "boosted" ? "See my updated matches" : "See my career matches"}</ButtonLink>
          )}
        </div>
      </Card>

      <Card className="mt-4 space-y-3">
        <p className="text-sm text-muted">
          You finished this on {formatDate(completedAt)}.
          {!canRetake && <> How you see yourself can change as you grow — you can retake it after {formatDate(retakeAfter)}.</>}
        </p>
        {canRetake && (
          <form action={startAssessmentAction}>
            <input type="hidden" name="instrument" value="personality" />
            <Button type="submit" variant="secondary">
              Retake
            </Button>
          </form>
        )}
      </Card>
      <p className="mt-4 text-sm">
        <Link href="/dashboard" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to dashboard
        </Link>
      </p>
    </>
  );
}
