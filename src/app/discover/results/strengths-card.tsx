import Link from "next/link";
import { ButtonLink, Card } from "@/components/ui";
import { strengthsFor } from "@/lib/assessments/descriptions";
import type { BigFive } from "@/lib/assessments/instruments";

/**
 * The student's strengths on the results page, below their interest areas, or an invitation to
 * find them. `usedInMatches`: whether the matches on the page count them (see runUsedPersonality).
 */
export function StrengthsCard({ traits, usedInMatches }: { traits: Record<BigFive, number> | undefined; usedInMatches: boolean }) {
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
          {usedInMatches && (
            <p className="mt-3 text-sm text-muted">
              Your matches give a small boost to careers that especially call for these strengths. Your interests count the most.
            </p>
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
            Find my strengths (5 min)
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}
