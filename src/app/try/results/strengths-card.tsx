"use client";

import { useRouter } from "next/navigation";
import { Button, ButtonLink, Card } from "@/components/ui";
import { type SavedStrengths, answeredCount, isComplete } from "@/lib/assessments/anonymous";
import { displayTrait } from "@/lib/assessments/descriptions";
import { BIG_FIVE, PERSONALITY_ITEMS } from "@/lib/assessments/instruments";
import { scorePersonality } from "@/lib/assessments/scoring";
import { forgetSavedStrengths } from "../saved-store";

/**
 * The strengths add-on on the free results: an offer until it's taken, then the strengths, scored
 * here in the browser with the same code as signed-in students. `saved` is undefined until the
 * browser's copy is read.
 */
export function StrengthsCard({ saved }: { saved: SavedStrengths | null | undefined }) {
  if (saved === undefined) return null;
  return (
    // The strengths activity comes back here, to this card.
    <div id="strengths" className="scroll-mt-6">
      {isComplete(saved) ? <YourStrengths saved={saved} /> : <StrengthsOffer answered={answeredCount(saved)} />}
    </div>
  );
}

function StrengthsOffer({ answered }: { answered: number }) {
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-medium">See your strengths too?</h2>
      <p className="text-sm">
        20 statements, about 3 minutes. You&apos;ll see strengths like how you work with people and how you get things
        done. Like the quiz, your answers stay in this browser.
      </p>
      {answered > 0 && (
        <p className="text-sm text-muted">
          You&apos;ve answered {answered} of {PERSONALITY_ITEMS.length}.
        </p>
      )}
      <ButtonLink href="/try/strengths">{answered > 0 ? "Keep going" : "See my strengths"}</ButtonLink>
    </Card>
  );
}

export function YourStrengths({ saved }: { saved: SavedStrengths }) {
  const router = useRouter();
  const { traits } = scorePersonality(saved.answers);

  function answerAgain() {
    if (!window.confirm("Erase your strengths answers from this device and answer them again?")) return;
    forgetSavedStrengths();
    router.push("/try/strengths");
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Your strengths</h2>
        <p className="mt-1 text-sm text-muted">Everyone has a different mix, and each one is a strength in the right place.</p>
      </div>
      <ul className="space-y-3 text-sm">
        {BIG_FIVE.map((t) => {
          const d = displayTrait(t, traits[t]);
          return (
            <li key={t}>
              <span className="font-medium">{d.name}.</span> <span className="text-muted">{d.text}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">This is how you see yourself right now, not a label. It can change as you grow.</p>
      <Button variant="secondary" onClick={answerAgain}>
        Answer them again
      </Button>
    </Card>
  );
}
