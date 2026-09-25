"use client";

import type { Item, Option } from "@/app/discover/question-list";
import { ButtonLink, Card } from "@/components/ui";
import { isFinished } from "@/lib/assessments/anonymous";
import { FreeQuiz } from "../free-quiz";
import { useSavedAssessment } from "../saved-store";

/**
 * The strengths add-on comes after the free interest quiz: its answers are saved and added to an
 * account together with the quiz, so without a finished quiz on this device there's nothing to add
 * them to.
 */
export function StrengthsQuiz({ items, options }: { items: Item[]; options: Option[] }) {
  const quiz = useSavedAssessment();
  if (quiz === undefined) return <p className="animate-pulse text-muted">Loading…</p>;
  if (!isFinished(quiz)) {
    return (
      <Card className="space-y-4">
        <p>The strengths questions come after the free interest quiz. Take the quiz first, then come back here.</p>
        <ButtonLink href="/try">Take the free quiz</ButtonLink>
      </Card>
    );
  }
  return <FreeQuiz instrument="personality" items={items} options={options} />;
}
