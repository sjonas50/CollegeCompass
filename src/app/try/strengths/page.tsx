import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { ACCURACY_SCALE, PERSONALITY_ITEMS } from "@/lib/assessments/instruments";
import { getCurrentUser } from "@/lib/auth/dal";
import { StrengthsQuiz } from "./strengths-quiz";

export const metadata: Metadata = {
  title: "Your strengths",
  // Part of the free quiz's results, which live in the visitor's browser.
  robots: { index: false },
};

/**
 * The free quiz's optional strengths add-on: the Mini-IPIP's 20 statements (public domain), the
 * same as the signed-in personality activity. Answered and scored in the browser; nothing is sent
 * until the visitor adds their results to an account.
 */
export default async function TryStrengthsPage() {
  // Students answer the same statements in their account.
  const user = await getCurrentUser();
  if (user?.role === "student") redirect("/discover/personality");

  return (
    <>
      <PageHeading
        title="Your strengths"
        lead="How well does each statement describe you right now? There are no right or wrong answers."
      />
      <p className="mb-6 text-sm text-muted">
        20 statements, about 3 minutes. Like the quiz, your answers stay in this browser until you choose to save them to an
        account.
      </p>
      <StrengthsQuiz items={PERSONALITY_ITEMS.map(({ id, text }) => ({ id, text }))} options={ACCURACY_SCALE} />
    </>
  );
}
