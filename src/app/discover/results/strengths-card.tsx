import Link from "next/link";
import { ButtonLink, Card } from "@/components/ui";
import { strengthsFor, traitNames } from "@/lib/assessments/descriptions";
import type { BigFive } from "@/lib/assessments/instruments";
import type { StrengthsInMatches } from "@/lib/matching/service";
import { UpdateMatchesButton } from "../update-matches";

/**
 * The student's strengths on the results page, below their interest areas, or an invitation to
 * find them. `matches`: what the strengths do to the matches on the page, naming only the ones
 * that count (see strengthsInMatches).
 */
export function StrengthsCard({ traits, matches }: { traits: Record<BigFive, number> | undefined; matches: StrengthsInMatches | null }) {
  return (
    <Card>
      <h2 className="font-medium">Your strengths</h2>
      {traits ? (
        <>
          <ul className="mt-3 space-y-3 text-sm">
            {strengthsFor(traits).map((s) => (
              <li key={s.trait}>
                <span className="font-medium">
                  {s.name}: {s.label}.
                </span>{" "}
                <span className="text-muted">{s.text}</span>
              </li>
            ))}
          </ul>
          {matches?.state === "boosted" && (
            <p className="mt-3 text-sm text-muted">
              Your matches give a small boost to careers that call for your {traitNames(matches.counted)}. Your interests count the most.
            </p>
          )}
          {matches?.state === "stale" && (
            <div className="mt-3 space-y-3 text-sm">
              <p className="text-muted">
                These matches were made before your strengths counted. Update them to give a small boost to careers that call for your{" "}
                {traitNames(matches.counted)}.
              </p>
              <UpdateMatchesButton variant="secondary" />
            </div>
          )}
          {matches?.state === "unchanged" && (
            <p className="mt-3 text-sm text-muted">Your answers didn&apos;t change your matches. Your interests decide them.</p>
          )}
          <p className="mt-2 text-sm">
            <Link href="/discover/personality" className="inline-flex min-h-11 items-center underline underline-offset-2">
              What your strengths mean for school and work
            </Link>
          </p>
        </>
      ) : (
        <div className="mt-2 space-y-3 text-sm text-muted">
          <p>Take the personality activity to see your strengths, what they mean for school and work, and careers that call for them.</p>
          <ButtonLink href="/discover/personality" variant="secondary">
            Find my strengths (3 min)
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}
